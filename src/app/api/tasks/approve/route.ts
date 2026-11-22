import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { col, getDb } from "@/lib/server/firebase-admin";
import { HttpError, handle, readBody } from "@/lib/server/http";
import { requireTeamUser } from "@/lib/server/team-auth";
import { addEvent, parseTaskId } from "@/lib/server/tasks";

// POST /api/tasks/approve { ids }: dashboard (team member). draft -> queued, all or nothing.
export const POST = handle(async (req: Request) => {
  const user = await requireTeamUser(req);
  const { ids: raw } = await readBody(req);
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100 || raw.some((x) => typeof x !== "string")) {
    throw new HttpError(400, `"ids" must be a list of 1-100 task ids`);
  }
  const ids = [...new Set(raw.map((x: string) => parseTaskId(x)))];

  await getDb().runTransaction(async (tx) => {
    const snaps = await tx.getAll(...ids.map((id) => col.tasks().doc(id)));
    const missing = snaps.filter((s) => !s.exists).map((s) => s.id);
    if (missing.length) throw new HttpError(404, `Tasks not found: ${missing.join(", ")}`);
    const notDraft = snaps.filter((s) => s.get("status") !== "draft").map((s) => s.id);
    if (notDraft.length) throw new HttpError(409, `Not drafts (already approved or started): ${notDraft.join(", ")}`);

    const now = Timestamp.now();
    for (const s of snaps) {
      tx.update(s.ref, { status: "queued", updated_at: now });
      addEvent(tx, {
        type: "approved", task_id: s.id, mission_id: s.get("mission_id") ?? null,
        message: s.get("title"), data: { by: user.email },
      }, now);
    }
  });
  return NextResponse.json({ ok: true });
});
