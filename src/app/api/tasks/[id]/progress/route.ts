import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/server/auth";
import { col } from "@/lib/server/firebase-admin";
import { handle, readBody, str } from "@/lib/server/http";
import { ACTIVE, addEvent, leaseFrom, mutateOwnTask, parseTaskId } from "@/lib/server/tasks";

// POST /api/tasks/:id/progress { attempt_id, message }: -> in_progress, renew lease, log progress.
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const agent = await requireAgent(req);
  const id = parseTaskId((await ctx.params).id);
  const body = await readBody(req);
  const attemptId = str(body, "attempt_id", { max: 64 });
  const message = str(body, "message", { max: 500 });

  await mutateOwnTask(agent, id, attemptId, ACTIVE, (tx, task, now) => {
    tx.update(col.agents().doc(agent.id), { status: "working", note: message });
    addEvent(tx, { type: "progress", task_id: id, agent_id: agent.id, mission_id: task.mission_id ?? null, message }, now);
    return { status: "in_progress", lease_expires_at: leaseFrom(now) };
  });
  return NextResponse.json({ ok: true });
});
