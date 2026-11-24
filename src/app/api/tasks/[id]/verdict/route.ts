import { Timestamp } from "firebase-admin/firestore";
import type { CheckResults, ReviewTaskResponse, TaskReview } from "@/types/api";
import { requireAgent } from "@/lib/server/auth";
import { col, getDb } from "@/lib/server/firebase-admin";
import { fetchPr } from "@/lib/server/google/github";
import { guardReview, parseReview, type ReviewInput } from "@/lib/server/google/reviewer";
import { HttpError, handle, readBody, str } from "@/lib/server/http";
import { agentJson } from "@/lib/server/messages";
import { mayTake } from "@/lib/server/orchestrator";
import { addEvent, parseTaskId } from "@/lib/server/tasks";

const sameSha = (a: string, b: string) => a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a));

// POST /api/tasks/:id/verdict { sha, verdict, notes, evidence }: orchestrator agents only, for an
// in_review task with an open review request (taken via GET /api/plan-requests). Same guards as the
// Gemini reviewer: bound to the head SHA (the PR head on GitHub must still equal it), failed checks
// are never "pass", files outside the task's scope are never "pass". Replaces the rules-only review,
// closes the request, and never changes the task's status: a human still merges.
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const agent = await requireAgent(req);
  if (agent.role !== "orchestrator") throw new HttpError(403, "Only orchestrator agents can submit reviews");
  const taskId = parseTaskId((await ctx.params).id);
  const body = await readBody(req);
  const sha = str(body, "sha", { max: 40 }).toLowerCase();

  const snap = await col.tasks().doc(taskId).get();
  if (!snap.exists || snap.get("project_id") !== agent.project_id) throw new HttpError(404, "Task not found");
  const t = snap.data()!;
  if (t.status !== "in_review") throw new HttpError(409, `Task is "${t.status}"; only in_review tasks can be reviewed`);
  const headSha = String(t.head_sha ?? "");
  if (t.orchestrator_request?.kind !== "review" || t.orchestrator_request.sha !== headSha) {
    throw new HttpError(409, "No review is requested for this task's current head (or it was already submitted)");
  }
  if (!sameSha(sha, headSha)) throw new HttpError(409, `You reviewed ${sha.slice(0, 7)}, but the task's head is ${headSha.slice(0, 7)}; review the new head`);

  let parsed;
  try {
    parsed = parseReview(JSON.stringify({ verdict: body.verdict, notes: body.notes, evidence: body.evidence }));
  } catch (e) {
    throw new HttpError(400, `Review rejected: ${e instanceof Error ? e.message : String(e)}`);
  }
  // External call: outside any transaction (AGENTS.md correctness rules).
  const pr = await fetchPr(String(t.pr_url));
  if (!sameSha(pr.head_sha, headSha)) throw new HttpError(409, `The PR's head moved to ${pr.head_sha.slice(0, 7)}; this review is void`);
  const input: ReviewInput = {
    task: { title: t.title, description: t.description, acceptance: t.acceptance ?? null, scope: t.scope ?? [] },
    head_sha: headSha, checks: t.checks as CheckResults, pr,
  };
  const draft = guardReview({ ...parsed, model: `claude-code (${agent.name})` }, input);

  const now = Timestamp.now();
  const review: TaskReview = { ...draft, sha: headSha, reviewed_at: now.toDate().toISOString() };
  await getDb().runTransaction(async (tx) => {
    const cur = await tx.get(snap.ref);
    const open = cur.get("orchestrator_request");
    if (cur.get("status") !== "in_review" || cur.get("head_sha") !== headSha || open?.kind !== "review" || open.sha !== headSha) {
      throw new HttpError(409, "The task changed while you were reviewing; review discarded");
    }
    if (!mayTake(open, agent.id, now)) throw new HttpError(409, `${open.claimed_by_name ?? "Another orchestrator"} is reviewing this PR`);
    tx.update(snap.ref, { review: { ...review, reviewed_at: now }, orchestrator_request: null, updated_at: now });
    addEvent(tx, {
      project_id: agent.project_id, type: "reviewed", task_id: taskId, mission_id: t.mission_id ?? null, agent_id: agent.id,
      message: `${review.verdict}: ${review.notes}`,
      data: { verdict: review.verdict, sha: headSha, model: review.model, by: agent.name },
    }, now);
  });
  return agentJson<ReviewTaskResponse>(agent.id, { review });
});
