import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import type { RecoverResponse } from "@/types/api";
import { aiProvider } from "@/lib/server/ai-provider";
import { col, getDb } from "@/lib/server/firebase-admin";
import { draftRecovery } from "@/lib/server/google/recovery";
import { HttpError, handle, readBody, str } from "@/lib/server/http";
import { isFresh, newTaskRequest, pendingProposal, recoveryInput, saveRecovery } from "@/lib/server/orchestrator";
import { addEvent, parseTaskId } from "@/lib/server/tasks";
import { assertInProject, requireProjectMember } from "@/lib/server/team-auth";

export const maxDuration = 60; // the Gemini call can take a while

// POST /api/missions/:id/recover { task_id }: dashboard (team member). One smaller fix task (or a
// prerequisite) for a failed task, saved as a draft that a human approves.
// AI_PROVIDER=claude-code: opens a recovery request for an orchestrator agent ({ requested: true });
// it submits the draft with POST /api/tasks/:id/recovery. AI_PROVIDER=gemini: Gemini drafts it now.
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireProjectMember(req);
  const missionId = parseTaskId((await ctx.params).id);
  const taskId = parseTaskId(str(await readBody(req), "task_id", { max: 128 }));

  const snap = await col.tasks().doc(taskId).get();
  assertInProject(snap, user.projectId, "Task not found in this mission");
  if (snap.get("mission_id") !== missionId) throw new HttpError(404, "Task not found in this mission");
  const t = snap.data()!;
  if (t.status !== "failed") throw new HttpError(409, `Task is "${t.status}"; only failed tasks can be recovered`);
  const pending = await pendingProposal(taskId);
  if (pending) throw new HttpError(409, `A recovery draft for this task already exists: ${pending}`);

  if (aiProvider() === "claude-code") {
    await getDb().runTransaction(async (tx) => {
      const cur = await tx.get(snap.ref);
      const now = Timestamp.now();
      if (cur.get("status") !== "failed") throw new HttpError(409, "The task changed; try again");
      const open = cur.get("orchestrator_request");
      if (open?.kind === "recovery" && isFresh(open, now)) {
        throw new HttpError(409, `A recovery is already requested${open.claimed_by_name ? ` (${open.claimed_by_name} is on it)` : ""}`);
      }
      tx.update(snap.ref, { orchestrator_request: newTaskRequest("recovery", user.email, now), updated_at: now });
      addEvent(tx, { project_id: user.projectId, type: "recovery_requested", task_id: taskId, mission_id: missionId, message: "Recovery requested from the orchestrator", data: { by: user.email } }, now);
    });
    return NextResponse.json<RecoverResponse>({ requested: true });
  }

  // External call: outside any transaction (AGENTS.md correctness rules).
  const draft = await draftRecovery(await recoveryInput(taskId, t));
  await saveRecovery({
    projectId: user.projectId, missionId, failedId: taskId, kind: draft.kind, task: draft.task, model: draft.model,
    by: user.email, agentId: null, createdBy: "gemini-recovery",
  });
  return NextResponse.json<RecoverResponse>({ task_id: draft.task.id, kind: draft.kind });
});
