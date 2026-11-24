import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { col, getDb } from "@/lib/server/firebase-admin";
import { HttpError, handle, readBody } from "@/lib/server/http";
import { requireProjectMember } from "@/lib/server/team-auth";
import { addEvent, parseTaskId, readMission, writeMissionStatus } from "@/lib/server/tasks";

// POST /api/tasks/approve { ids }: dashboard (team member). draft -> queued, all or nothing.
export const POST = handle(async (req: Request) => {
  const user = await requireProjectMember(req);
  const { ids: raw } = await readBody(req);
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100 || raw.some((x) => typeof x !== "string")) {
    throw new HttpError(400, `"ids" must be a list of 1-100 task ids`);
  }
  const ids = [...new Set(raw.map((x: string) => parseTaskId(x)))];

  await getDb().runTransaction(async (tx) => {
    const snaps = await tx.getAll(...ids.map((id) => col.tasks().doc(id)));
    const missing = snaps.filter((s) => !s.exists || s.get("project_id") !== user.projectId).map((s) => s.id);
    if (missing.length) throw new HttpError(404, `Tasks not found: ${missing.join(", ")}`);
    const notDraft = snaps.filter((s) => s.get("status") !== "draft").map((s) => s.id);
    if (notDraft.length) throw new HttpError(409, `Not drafts (already approved or started): ${notDraft.join(", ")}`);

    const missionIds = [...new Set(snaps.map((s) => s.get("mission_id") as string | null))].filter(Boolean);
    const missions = await Promise.all(missionIds.map((m) => readMission(tx, m)));

    const now = Timestamp.now();
    const changes = Object.fromEntries(ids.map((id) => [id, "queued"]));
    for (const m of missions) writeMissionStatus(tx, m, changes, now);
    for (const s of snaps) {
      tx.update(s.ref, { status: "queued", updated_at: now });
      addEvent(tx, {
        project_id: user.projectId, type: "approved", task_id: s.id, mission_id: s.get("mission_id") ?? null,
        message: s.get("title"), data: { by: user.email },
      }, now);
    }
  });
  return NextResponse.json({ ok: true });
});
