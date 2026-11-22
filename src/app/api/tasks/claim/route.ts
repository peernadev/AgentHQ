import { NextResponse } from "next/server";
import type { ClaimResponse } from "@/types/api";
import { requireAgent } from "@/lib/server/auth";
import { claimNextTask } from "@/lib/server/claim";
import { HttpError, handle } from "@/lib/server/http";

// POST /api/tasks/claim: atomically claim the best available task (SPEC §6).
// The returned task includes attempt_id; send it with every later call about this task.
export const POST = handle(async (req: Request) => {
  const agent = await requireAgent(req);
  if (agent.role !== "worker") throw new HttpError(403, "Only worker agents can claim tasks");
  return NextResponse.json<ClaimResponse>(await claimNextTask(agent.id));
});
