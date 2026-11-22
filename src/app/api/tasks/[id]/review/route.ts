import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase-admin";
import { requireAgent } from "@/lib/server/auth";
import { HttpError, check, handle, optStr, readBody, str } from "@/lib/server/http";
import { logEvent, parseTaskId, transitionOwnTask } from "@/lib/server/tasks";

// POST /api/tasks/:id/review { pr_url, branch, summary? }: -> in_review. The agent is freed to
// claim again; the task keeps its scope lock until it is done (merged).
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const agent = await requireAgent(req);
  const id = parseTaskId((await ctx.params).id);
  const body = await readBody(req);
  const pr_url = str(body, "pr_url", { max: 500 });
  const branch = str(body, "branch", { max: 200 });
  const summary = optStr(body, "summary", { max: 4000 }) ?? null;
  if (!/^https?:\/\//.test(pr_url)) throw new HttpError(400, `"pr_url" must be an http(s) URL`);

  const task = await transitionOwnTask(agent, id, ["claimed", "in_progress"], {
    status: "in_review", pr_url, branch, result_summary: summary,
  });
  check(
    await getSupabaseAdmin().from("agents").update({ status: "idle", current_task_id: null, note: null })
      .eq("id", agent.id),
    "agent release",
  );
  await logEvent({ type: "pr_opened", task_id: id, agent_id: agent.id, message: task.title, data: { pr_url, branch } });
  return NextResponse.json({ ok: true });
});
