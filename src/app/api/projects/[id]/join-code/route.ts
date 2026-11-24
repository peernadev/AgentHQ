import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import type { RotateJoinCodeResponse } from "@/types/api";
import { hashToken } from "@/lib/server/auth";
import { col, getDb } from "@/lib/server/firebase-admin";
import { handle } from "@/lib/server/http";
import { newJoinCode } from "@/lib/server/projects";
import { addEvent } from "@/lib/server/tasks";
import { requireProjectMember } from "@/lib/server/team-auth";

// POST /api/projects/:id/join-code: project owners only. Rotates the join code: the old code stops
// working at once (existing agent tokens are unaffected). Returns the new code once.
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireProjectMember(req, { owner: true, projectId: (await ctx.params).id });
  const joinCode = newJoinCode();
  const now = Timestamp.now();
  await getDb().runTransaction(async (tx) => {
    tx.update(col.projects().doc(user.projectId), { join_code_hash: hashToken(joinCode) });
    addEvent(tx, { project_id: user.projectId, type: "join_code_rotated", message: "Join code rotated", data: { by: user.email } }, now);
  });
  return NextResponse.json<RotateJoinCodeResponse>({ join_code: joinCode });
});
