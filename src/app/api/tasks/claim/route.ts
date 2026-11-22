import { NextResponse } from "next/server";
import type { ClaimResponse, Task } from "@/types/api";
import { getSupabaseAdmin } from "@/lib/server/supabase-admin";
import { requireAgent } from "@/lib/server/auth";
import { HttpError, checkData, handle } from "@/lib/server/http";

// POST /api/tasks/claim: atomically claim the best available task (see claim_next_task in schema.sql).
export const POST = handle(async (req: Request) => {
  const agent = await requireAgent(req);
  if (agent.role !== "worker") throw new HttpError(403, "Only worker agents can claim tasks");

  const db = getSupabaseAdmin();
  const startedAt = new Date(Date.now() - 5000).toISOString(); // slack for clock skew vs. the DB
  const res = await db.rpc("claim_next_task", { p_agent_id: agent.id });
  if (res.error?.message.includes("already has an active task")) {
    throw new HttpError(409, "Agent already has an active task; finish it with review, done or fail first");
  }
  const rows = checkData(res, "claim") as Task[];
  if (rows.length > 0) return NextResponse.json<ClaimResponse>({ task: rows[0] });

  // The RPC returns no row both for "nothing claimable" and for a fairness skip.
  // Tell them apart by the fairness_skip event it writes in the same transaction.
  const skip = checkData(
    await db.from("events").select("id").eq("agent_id", agent.id).eq("type", "fairness_skip")
      .gte("created_at", startedAt).limit(1),
    "fairness check",
  );
  return NextResponse.json<ClaimResponse>({ task: null, reason: skip.length > 0 ? "fairness" : "no_task" });
});
