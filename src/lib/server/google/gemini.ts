import "server-only";
import { GoogleGenAI, type Content } from "@google/genai";
import { HttpError } from "../http";

// Shared Gemini JSON call with the model fallback chain (planner, reviewer, recovery).
// Never call this inside a Firestore transaction. Output is untrusted: callers validate it.

// Tried in order when a model is overloaded (408/429/5xx) or times out. Flash-Lite last:
// usually the least loaded. Model IDs from the Gemini API model list (Nov 2026).
export const MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.8-flash",
  process.env.GEMINI_FALLBACK_MODEL || "gemini-3.7-flash",
  process.env.GEMINI_LITE_MODEL || "gemini-3.5-flash-lite",
];
const CALL_TIMEOUT_MS = 25_000;
// Gemini rejects request deadlines under 10 s (400 INVALID_ARGUMENT), so every model that gets
// a turn needs at least that much, and that much is kept back for each model not tried yet.
const MIN_CALL_MS = 10_000;
const RESERVE_MS = MIN_CALL_MS;

/** Every model was overloaded or timed out within the budget. */
export class GeminiBusyError extends HttpError {
  constructor() {
    super(503, "Gemini is busy right now; try again in a minute");
  }
}

export const isTransient = (e: unknown) => {
  const s = e instanceof Error ? e.message : String(e);
  // Status names are matched exactly: a 400 whose text mentions a "deadline" is not transient.
  return /\b(408|429|500|502|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED/.test(s)
    || /timed? ?out|\babort(ed)?\b/i.test(s);
};

let client: GoogleGenAI | null = null;
function gemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new HttpError(500, "GEMINI_API_KEY is not configured");
  return (client ??= new GoogleGenAI({ apiKey }));
}

export interface JsonSession {
  /** One structured-JSON call; walks the fallback chain on transient errors. */
  call(contents: Content[]): Promise<string | undefined>;
  /** The model that answered last (the chain stays on it for later calls in this session). */
  readonly model: string;
}

/**
 * A call session with one time budget shared by all its calls and models. `label` names the
 * caller in logs and errors ("planner", "reviewer", ...).
 */
export function jsonSession(opts: {
  label: string; system: string; schema: object; budgetMs: number; temperature?: number;
}): JsonSession {
  const deadline = Date.now() + opts.budgetMs;
  let m = 0; // index into MODELS; stays on the model that answered
  return {
    get model() {
      return MODELS[Math.min(m, MODELS.length - 1)];
    },
    async call(contents) {
      // Our own timeout per call (SDK retries off: its default backoff can run for minutes).
      for (; m < MODELS.length; m++) {
        const model = MODELS[m];
        const left = deadline - Date.now();
        const timeout = Math.min(CALL_TIMEOUT_MS, left - RESERVE_MS * (MODELS.length - 1 - m));
        if (timeout < MIN_CALL_MS) continue; // too little time for this one; give it to the next model
        try {
          const res = await gemini().models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: opts.system,
              responseMimeType: "application/json",
              responseJsonSchema: opts.schema,
              temperature: opts.temperature ?? 0.3,
              httpOptions: { timeout, retryOptions: { attempts: 1 } },
            },
          });
          return res.text;
        } catch (e) {
          console.error(`Gemini ${opts.label} call failed (${model}, timeout ${timeout} ms):`,
            e instanceof Error ? e.message.slice(0, 300) : e);
          if (!isTransient(e)) throw new HttpError(502, `Gemini ${opts.label} call failed`);
        }
      }
      throw new GeminiBusyError();
    },
  };
}

/** Untrusted text for a prompt: fenced so it reads as data, with fence look-alikes defused. */
export function asData(text: string): string {
  return `"""\n${text.replace(/"""/g, '"​""')}\n"""`;
}
