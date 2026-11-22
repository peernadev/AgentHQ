import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { col, getDb } from "@/lib/server/firebase-admin";
import { HttpError, handle, optStr, readBody } from "@/lib/server/http";
import { requireTeamUser } from "@/lib/server/team-auth";
import { addEvent, parseTaskId, readMission, writeMissionStatus } from "@/lib/server/tasks";

// POST /api/tasks/:id/done { summary? }: dashboard, after the PR is merged. in_review -> done.
// Releases the scope lock (dependents become claimable) and bumps the participant's tasks_done.
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireTeamUser(req);
  const id = parseTaskId((await ctx.params).id);
  const summary = optStr(await readBody(req, { optional: true }), "summary", { max: 4000 });

  await getDb().runTransaction(async (tx) => {
    const ref = col.tasks().doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, "Task not found");
    if (snap.get("status") !== "in_review") {
      throw new HttpError(409, `Task is "${snap.get("status")}"; only in_review tasks can be marked done`);
    }
    const agentId = snap.get("agent_id") as string | null;
    const agent = agentId ? await tx.get(col.agents().doc(agentId)) : null;
    const participantId = agent?.get("participant_id") as string | undefined;
    const participant = participantId ? await tx.get(col.participants().doc(participantId)) : null;
    const mission = await readMission(tx, snap.get("mission_id"));

    const now = Timestamp.now();
    tx.update(ref, {
      status: "done", completed_at: now, updated_at: now, lease_expires_at: null,
      ...(summary ? { result_summary: summary } : {}),
    });
    tx.set(col.scopeRegistry(), { locks: { [id]: FieldValue.delete() }, updated_at: now }, { merge: true });
    writeMissionStatus(tx, mission, { [id]: "done" }, now);
    if (participant?.exists) tx.update(participant.ref, { tasks_done: FieldValue.increment(1) });
    addEvent(tx, {
      type: "done", task_id: id, agent_id: agentId, mission_id: snap.get("mission_id") ?? null,
      message: snap.get("title"), data: { by: user.email },
    }, now);
  });
  return NextResponse.json({ ok: true });
});
