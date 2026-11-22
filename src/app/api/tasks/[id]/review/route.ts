import { NextResponse } from "next/server";
import type { CheckResults } from "@/types/api";
import { requireAgent } from "@/lib/server/auth";
import { col } from "@/lib/server/firebase-admin";
import { HttpError, handle, optStr, readBody, str } from "@/lib/server/http";
import { ACTIVE, addEvent, mutateOwnTask, parseTaskId } from "@/lib/server/tasks";

function parseChecks(v: unknown): CheckResults {
  const c = v as Record<string, unknown> | null;
  if (!c || typeof c !== "object" || !["lint", "typecheck", "build"].every((k) => typeof c[k] === "boolean")) {
    throw new HttpError(400, `"checks" must be { lint, typecheck, build } booleans`);
  }
  return { lint: c.lint as boolean, typecheck: c.typecheck as boolean, build: c.build as boolean };
}

// POST /api/tasks/:id/review { attempt_id, pr_url, branch, head_sha, checks, summary? }: -> in_review.
// The agent is freed to claim again; the task keeps its scope lock until it is done (merged).
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const agent = await requireAgent(req);
  const id = parseTaskId((await ctx.params).id);
  const body = await readBody(req);
  const attemptId = str(body, "attempt_id", { max: 64 });
  const pr_url = str(body, "pr_url", { max: 500 });
  const branch = str(body, "branch", { max: 200 });
  const head_sha = str(body, "head_sha", { max: 40 }).toLowerCase();
  const checks = parseChecks(body.checks);
  const summary = optStr(body, "summary", { max: 4000 }) ?? null;
  if (!/^https?:\/\//.test(pr_url)) throw new HttpError(400, `"pr_url" must be an http(s) URL`);
  if (!/^[0-9a-f]{7,40}$/.test(head_sha)) throw new HttpError(400, `"head_sha" must be a git SHA`);

  await mutateOwnTask(agent, id, attemptId, ACTIVE, (tx, task, now) => {
    tx.update(col.agents().doc(agent.id), { status: "idle", current_task_id: null, note: null });
    addEvent(tx, {
      type: "pr_opened", task_id: id, agent_id: agent.id, mission_id: task.mission_id ?? null,
      message: task.title, data: { pr_url, branch, head_sha, checks },
    }, now);
    // The lease ends here; the lock in meta/scopeRegistry stays until done.
    // A new head SHA voids any earlier Gemini review.
    return {
      status: "in_review", pr_url, branch, head_sha, checks, review: null, result_summary: summary,
      lease_expires_at: null,
    };
  });
  return NextResponse.json({ ok: true });
});
