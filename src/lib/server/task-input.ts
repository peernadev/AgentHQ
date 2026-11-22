import "server-only";
import type { CreateTaskInput, TaskSize } from "@/types/api";
import { HttpError, optStr, str } from "./http";
import { parseTaskId } from "./tasks";

// Orchestrator / Gemini output is untrusted: validate everything before it is saved.

const SIZES: TaskSize[] = ["S", "M", "L"];
const MAX_TASKS = 50;

/** A scope entry must be a plain relative path prefix inside the repo. */
function parseScope(v: unknown, at: string): string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 20) {
    throw new HttpError(400, `${at}.scope must be a list of 1-20 path prefixes`);
  }
  return v.map((p, j) => {
    const s = typeof p === "string" ? p.trim() : "";
    const bad = !s || s.length > 200 || s.startsWith("/") || s.includes("\\") || /^[A-Za-z]:/.test(s)
      || s.split("/").some((seg) => seg === ".." || seg === ".");
    if (bad) throw new HttpError(400, `${at}.scope[${j}] must be a relative path inside the repo (no "/", "..", "\\")`);
    return s;
  });
}

function parseStringList(v: unknown, at: string, max: number): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max || v.some((x) => typeof x !== "string" || !x.trim())) {
    throw new HttpError(400, `${at} must be a list of up to ${max} strings`);
  }
  return v.map((x: string) => x.trim());
}

export interface ParsedTask extends Omit<CreateTaskInput, "depends_on"> {
  id: string;
  depends_on: string[]; // resolved: batch ids or existing task ids
  existing_deps: string[]; // the subset that must already exist
}

/** Validates a batch and resolves `key` references. Throws 400 on bad input or dependency cycles. */
export function parseTaskBatch(raw: unknown, newId: () => string): ParsedTask[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TASKS) {
    throw new HttpError(400, `"tasks" must be a list of 1-${MAX_TASKS} tasks`);
  }
  const keyToId = new Map<string, string>();
  const items = raw.map((t, i) => {
    const at = `tasks[${i}]`;
    if (!t || typeof t !== "object" || Array.isArray(t)) throw new HttpError(400, `${at} must be an object`);
    const o = t as Record<string, unknown>;
    const key = optStr(o, "key", { max: 64 });
    const id = newId();
    if (key) {
      if (keyToId.has(key)) throw new HttpError(400, `${at}.key "${key}" is used twice`);
      keyToId.set(key, id);
    }
    const size = (optStr(o, "size") ?? "M") as TaskSize;
    if (!SIZES.includes(size)) throw new HttpError(400, `${at}.size must be S, M or L`);
    const priority = o.priority ?? undefined;
    if (priority !== undefined && (!Number.isInteger(priority) || Math.abs(priority as number) > 1e6)) {
      throw new HttpError(400, `${at}.priority must be an integer`);
    }
    return {
      id, key, at, size, priority: priority as number | undefined,
      title: str(o, "title", { max: 200 }),
      description: str(o, "description", { max: 8000 }),
      acceptance: optStr(o, "acceptance", { max: 4000 }),
      scope: parseScope(o.scope, at),
      rawDeps: parseStringList(o.depends_on, `${at}.depends_on`, 20),
    };
  });

  const batchIds = new Set(items.map((t) => t.id));
  const tasks: ParsedTask[] = items.map(({ rawDeps, at, ...t }) => {
    const deps = rawDeps.map((d) => {
      const id = keyToId.get(d);
      if (id) return id;
      try {
        return parseTaskId(d);
      } catch {
        throw new HttpError(400, `${at}.depends_on "${d}" is not a key in this batch or a task id`);
      }
    });
    if (deps.includes(t.id)) throw new HttpError(400, `${at} depends on itself`);
    return { ...t, depends_on: [...new Set(deps)], existing_deps: deps.filter((d) => !batchIds.has(d)) };
  });

  // Existing tasks can't depend on new ones, so cycles can only be inside the batch.
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") throw new HttpError(400, "depends_on contains a cycle");
    state.set(id, "visiting");
    byId.get(id)!.depends_on.filter((d) => byId.has(d)).forEach(visit);
    state.set(id, "done");
  };
  tasks.forEach((t) => visit(t.id));
  return tasks;
}
