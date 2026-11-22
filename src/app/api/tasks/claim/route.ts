import type { ClaimResponse } from "@/types/api";
import { requireAgent } from "@/lib/server/auth";
import { sinceLastClaim } from "@/lib/server/briefing";
import { claimNextTask } from "@/lib/server/claim";
import { HttpError, handle } from "@/lib/server/http";
import { agentJson } from "@/lib/server/messages";

// POST /api/tasks/claim: atomically claim the best available task (SPEC §6).
// The returned task includes attempt_id; send it with every later call about this task.
export const POST = handle(async (req: Request) => {
  const agent = await requireAgent(req);
  if (agent.role !== "worker") throw new HttpError(403, "Only worker agents can claim tasks");
  const res = await claimNextTask(agent.id);
  if (res.task) {
    // Best effort, after the transaction: a failed briefing never loses the claim.
    res.since_last_claim = await sinceLastClaim(agent.id, res.task.id).catch((err) => {
      console.error("since_last_claim failed", err);
      return [];
    });
  }
  return agentJson<ClaimResponse>(agent.id, res);
});
