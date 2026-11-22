import { FieldValue } from "firebase-admin/firestore";
import { TASK_POINTS, type TaskSize } from "@/types/api";
import { requireAgent } from "@/lib/server/auth";
import { col } from "@/lib/server/firebase-admin";
import { handle, optStr, readBody, str } from "@/lib/server/http";
import { agentJson } from "@/lib/server/messages";
import { ACTIVE, addEvent, mutateOwnTask, parseTaskId } from "@/lib/server/tasks";

// POST /api/tasks/:id/fail { attempt_id, reason, log_excerpt? }: claimed/in_progress -> failed.
// Frees the agent, releases the scope lock and refunds the claim's points. The reason and
// log go on the "failed" event, where the recovery planner reads them.
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const agent = await requireAgent(req);
  const id = parseTaskId((await ctx.params).id);
  const body = await readBody(req);
  const attemptId = str(body, "attempt_id", { max: 64 });
  const reason = str(body, "reason", { max: 1000 });
  const logExcerpt = optStr(body, "log_excerpt", { max: 8000 }) ?? null;

  await mutateOwnTask(agent, id, attemptId, ACTIVE, (tx, task, now) => {
    const pts = TASK_POINTS[task.size as TaskSize] ?? TASK_POINTS.M;
    tx.update(col.agents().doc(agent.id), { status: "idle", current_task_id: null, note: null });
    tx.update(col.participants().doc(agent.participant_id), { points: FieldValue.increment(-pts) });
    tx.set(col.scopeRegistry(), { locks: { [id]: FieldValue.delete() }, updated_at: now }, { merge: true });
    addEvent(tx, {
      type: "failed", task_id: id, agent_id: agent.id, mission_id: task.mission_id ?? null,
      message: reason, data: { reason, log_excerpt: logExcerpt },
    }, now);
    return { status: "failed", lease_expires_at: null };
  });
  return agentJson(agent.id, { ok: true });
});
