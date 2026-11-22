import { NextResponse } from "next/server";
import { Timestamp, type Transaction } from "firebase-admin/firestore";
import type { RecoverResponse, TaskSize } from "@/types/api";
import { col, getDb } from "@/lib/server/firebase-admin";
import { draftRecovery } from "@/lib/server/google/recovery";
import { HttpError, handle, readBody, str } from "@/lib/server/http";
import { addEvent, parseTaskId, readDraftContext, writeDraftTasks } from "@/lib/server/tasks";
import { requireTeamUser } from "@/lib/server/team-auth";

export const maxDuration = 60; // the Gemini call can take a while

const OPEN = ["draft", "queued", "claimed", "in_progress", "in_review", "failed"];
const ms = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : 0);

/** A draft that an earlier recovery proposed for this failed task and nobody acted on yet. */
async function pendingProposal(failedId: string, tx?: Transaction): Promise<string | null> {
  const q = col.events().where("task_id", "==", failedId).where("type", "==", "recovery_proposed");
  const events = tx ? await tx.get(q) : await q.get();
  const ids = events.docs.map((e) => e.get("data")?.draft_task_id).filter((x): x is string => typeof x === "string");
  if (!ids.length) return null;
  const refs = ids.map((id) => col.tasks().doc(id));
  const drafts = tx ? await tx.getAll(...refs) : await getDb().getAll(...refs);
  return drafts.find((d) => d.exists && d.get("status") === "draft")?.id ?? null;
}

// POST /api/missions/:id/recover { task_id }: dashboard (team member). Gemini drafts one smaller
// fix task (or a prerequisite) from a failed task's reason and log. Saved as a draft; a human approves.
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireTeamUser(req);
  const missionId = parseTaskId((await ctx.params).id);
  const taskId = parseTaskId(str(await readBody(req), "task_id", { max: 128 }));

  const snap = await col.tasks().doc(taskId).get();
  if (!snap.exists || snap.get("mission_id") !== missionId) throw new HttpError(404, "Task not found in this mission");
  const t = snap.data()!;
  if (t.status !== "failed") throw new HttpError(409, `Task is "${t.status}"; only failed tasks can be recovered`);
  const pending = await pendingProposal(taskId);
  if (pending) throw new HttpError(409, `A recovery draft for this task already exists: ${pending}`);

  const [failEvents, queueSnap, registry] = await Promise.all([
    col.events().where("task_id", "==", taskId).where("type", "==", "failed").get(),
    col.tasks().where("status", "in", OPEN).limit(100).get(),
    col.scopeRegistry().get(),
  ]);
  const last = failEvents.docs.sort((a, b) => ms(b.get("created_at")) - ms(a.get("created_at")))[0];
  const reason = String(last?.get("data")?.reason ?? last?.get("message") ?? "No reason recorded");
  const log = (last?.get("data")?.log_excerpt as string | null | undefined) ?? null;

  // External call: outside any transaction (AGENTS.md correctness rules).
  const draft = await draftRecovery({
    failed: {
      id: taskId, title: t.title, description: t.description, acceptance: t.acceptance ?? null,
      scope: t.scope ?? [], size: (t.size ?? "M") as TaskSize,
    },
    reason, log_excerpt: log,
    queueIds: new Set(queueSnap.docs.map((d) => d.id)),
    locks: registry.get("locks") ?? {},
  });

  await getDb().runTransaction(async (tx) => {
    const [cur, again, draftCtx] = await Promise.all([
      tx.get(snap.ref), pendingProposal(taskId, tx), readDraftContext(tx, [draft.task]),
    ]);
    if (cur.get("status") !== "failed") throw new HttpError(409, "The task changed while Gemini was planning; run recovery again");
    if (again) throw new HttpError(409, `A recovery draft for this task already exists: ${again}`);
    const now = Timestamp.now();
    writeDraftTasks(tx, [draft.task], draftCtx, { missionId, createdBy: "gemini-recovery", agentId: null }, now);
    addEvent(tx, {
      type: "recovery_proposed", task_id: taskId, mission_id: missionId,
      message: `${draft.kind === "fix" ? "Fix" : "Prerequisite"} proposed: ${draft.task.title}`,
      data: { failed_task_id: taskId, draft_task_id: draft.task.id, kind: draft.kind, model: draft.model, by: user.email },
    }, now);
  });
  return NextResponse.json<RecoverResponse>({ task_id: draft.task.id, kind: draft.kind });
});
