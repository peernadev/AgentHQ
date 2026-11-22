import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import type { CheckResults, ReviewTaskResponse, TaskReview } from "@/types/api";
import { col, getDb } from "@/lib/server/firebase-admin";
import { fetchPr } from "@/lib/server/google/github";
import { reviewTask } from "@/lib/server/google/reviewer";
import { HttpError, handle, readBody, str } from "@/lib/server/http";
import { addEvent, parseTaskId } from "@/lib/server/tasks";
import { requireTeamUser } from "@/lib/server/team-auth";

export const maxDuration = 60; // the Gemini call can take a while

const sameSha = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);

// POST /api/missions/:id/review-task { task_id }: dashboard (team member). Gemini reviews an
// in_review task's PR (from GitHub) against its acceptance, bound to the task's head_sha.
// The verdict never changes the task's status: checks must pass and a human still merges.
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireTeamUser(req);
  const missionId = parseTaskId((await ctx.params).id);
  const taskId = parseTaskId(str(await readBody(req), "task_id", { max: 128 }));

  const snap = await col.tasks().doc(taskId).get();
  if (!snap.exists || snap.get("mission_id") !== missionId) throw new HttpError(404, "Task not found in this mission");
  const t = snap.data()!;
  if (t.status !== "in_review") throw new HttpError(409, `Task is "${t.status}"; only in_review tasks can be reviewed`);
  if (!t.pr_url || !t.head_sha || !t.checks) throw new HttpError(409, "Task has no PR evidence yet (pr_url, head_sha, checks)");
  const headSha = String(t.head_sha);

  // External calls: outside any transaction (AGENTS.md correctness rules).
  const pr = await fetchPr(String(t.pr_url));
  if (!sameSha(pr.head_sha, headSha)) {
    throw new HttpError(409, `The PR's head is ${pr.head_sha.slice(0, 7)}, but the task was submitted at ${headSha.slice(0, 7)}. `
      + "The agent must run hq review again before Gemini can review it.");
  }
  const draft = await reviewTask({
    task: { title: t.title, description: t.description, acceptance: t.acceptance ?? null, scope: t.scope ?? [] },
    head_sha: headSha, checks: t.checks as CheckResults, pr,
  });

  const now = Timestamp.now();
  const review: TaskReview = { ...draft, sha: headSha, reviewed_at: now.toDate().toISOString() };
  await getDb().runTransaction(async (tx) => {
    const cur = await tx.get(snap.ref);
    if (cur.get("status") !== "in_review" || cur.get("head_sha") !== headSha) {
      throw new HttpError(409, "The task changed while Gemini was reviewing; review discarded, run it again");
    }
    tx.update(snap.ref, { review: { ...review, reviewed_at: now }, updated_at: now });
    addEvent(tx, {
      type: "reviewed", task_id: taskId, mission_id: missionId,
      message: `${review.verdict}: ${review.notes}`,
      data: { verdict: review.verdict, sha: headSha, model: review.model, by: user.email },
    }, now);
  });
  return NextResponse.json<ReviewTaskResponse>({ review });
});
