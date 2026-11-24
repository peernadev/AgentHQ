import type { RecoverResponse } from "@/types/api";
import { requireAgent } from "@/lib/server/auth";
import { col } from "@/lib/server/firebase-admin";
import { validateRecovery } from "@/lib/server/google/recovery";
import { HttpError, handle, readBody } from "@/lib/server/http";
import { agentJson } from "@/lib/server/messages";
import { mayTake, recoveryInput, saveRecovery } from "@/lib/server/orchestrator";
import { parseTaskId } from "@/lib/server/tasks";

// POST /api/tasks/:id/recovery { kind: "fix" | "prerequisite", task: CreateTaskInput }: orchestrator
// agents only, for a failed task with an open recovery request (taken via GET /api/plan-requests).
// Same validation as Gemini's recovery drafts (schema, real paths, size <= the failed task's, a fix
// stays inside its scope, a prerequisite doesn't overlap held locks), all errors in one 400; one
// pending draft per failed task. Saves the draft for human approval and closes the request.
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const agent = await requireAgent(req);
  if (agent.role !== "orchestrator") throw new HttpError(403, "Only orchestrator agents can submit recoveries");
  const taskId = parseTaskId((await ctx.params).id);
  const body = await readBody(req);

  const snap = await col.tasks().doc(taskId).get();
  if (!snap.exists) throw new HttpError(404, "Task not found");
  const t = snap.data()!;
  if (t.status !== "failed") throw new HttpError(409, `Task is "${t.status}"; only failed tasks can be recovered`);
  if (t.orchestrator_request?.kind !== "recovery") throw new HttpError(409, "No recovery was requested for this task (or it was already submitted)");

  let draft;
  try {
    draft = validateRecovery(JSON.stringify({ kind: body.kind, task: body.task }), await recoveryInput(taskId, t));
  } catch (e) {
    throw new HttpError(400, `Recovery rejected. Fix these and submit again:\n${e instanceof Error ? e.message : String(e)}`);
  }
  await saveRecovery({
    missionId: t.mission_id, failedId: taskId, kind: draft.kind, task: draft.task,
    model: `claude-code (${agent.name})`, by: agent.name, agentId: agent.id, createdBy: agent.name,
    guard: (cur, now) => {
      const open = cur.get("orchestrator_request");
      if (open?.kind !== "recovery") throw new HttpError(409, "The recovery request was closed");
      if (!mayTake(open, agent.id, now)) throw new HttpError(409, `${open.claimed_by_name ?? "Another orchestrator"} is handling this recovery`);
    },
  });
  return agentJson<RecoverResponse>(agent.id, { task_id: draft.task.id, kind: draft.kind });
});
