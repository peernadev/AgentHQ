import "server-only";
import { PLAN_CLAIM_MINUTES, type AiProvider } from "@/types/api";

/**
 * AI_PROVIDER: "claude-code" (default) = an orchestrator agent (Claude Code on a teammate's
 * laptop) drafts plans through /api/plan-requests; the server makes no AI calls for planning.
 * "gemini" = the server calls Gemini (needs GEMINI_API_KEY).
 */
export function aiProvider(): AiProvider {
  return process.env.AI_PROVIDER?.trim().toLowerCase() === "gemini" ? "gemini" : "claude-code";
}

export const PLAN_CLAIM_MS = PLAN_CLAIM_MINUTES * 60 * 1000;
