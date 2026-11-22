import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase-admin";
import { requireAgent } from "@/lib/server/auth";
import { check, handle, readBody, str } from "@/lib/server/http";
import { logEvent, parseTaskId, transitionOwnTask } from "@/lib/server/tasks";

// POST /api/tasks/:id/progress { message }: claimed/in_progress -> in_progress, log a progress event.
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const agent = await requireAgent(req);
  const id = parseTaskId((await ctx.params).id);
  const message = str(await readBody(req), "message", { max: 500 });

  await transitionOwnTask(agent, id, ["claimed", "in_progress"], { status: "in_progress" });
  check(
    await getSupabaseAdmin().from("agents").update({ status: "working", note: message }).eq("id", agent.id),
    "agent note",
  );
  await logEvent({ type: "progress", task_id: id, agent_id: agent.id, message });
  return NextResponse.json({ ok: true });
});
