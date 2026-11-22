import { NextResponse } from "next/server";
import type { AgentRole, JoinResponse } from "@/types/api";
import { getSupabaseAdmin } from "@/lib/server/supabase-admin";
import { hashToken, newToken, safeEqual } from "@/lib/server/auth";
import { HttpError, check, checkData, handle, optStr, readBody, str } from "@/lib/server/http";

// POST /api/agents/join: register (or re-register) an agent and issue a fresh token.
export const POST = handle(async (req: Request) => {
  const body = await readBody(req);
  const code = str(body, "code");
  const participantName = str(body, "participant", { max: 50 });
  const name = str(body, "name", { max: 80 });
  const machine = optStr(body, "machine", { max: 120 }) ?? null;
  const tool = optStr(body, "tool", { max: 50 }) ?? "codex";
  const model = optStr(body, "model", { max: 80 }) ?? null;
  const role = (optStr(body, "role") ?? "worker") as AgentRole;
  if (role !== "worker" && role !== "orchestrator") {
    throw new HttpError(400, `"role" must be "worker" or "orchestrator"`);
  }

  const expected = process.env.TEAM_JOIN_CODE;
  if (!expected) throw new HttpError(500, "TEAM_JOIN_CODE is not configured");
  if (!safeEqual(code, expected)) throw new HttpError(403, "Wrong join code");

  const db = getSupabaseAdmin();
  const participant = checkData(
    await db.from("participants").upsert({ name: participantName }, { onConflict: "name" })
      .select("id").single(),
    "participant upsert",
  );

  const existing = check(
    await db.from("agents").select("id, participant_id").eq("name", name).maybeSingle(),
    "agent lookup",
  );
  if (existing && existing.participant_id !== participant.id) {
    throw new HttpError(409, `Agent name "${name}" belongs to another participant`);
  }

  const fields = {
    participant_id: participant.id, name, machine, tool, model, role,
    last_heartbeat: new Date().toISOString(),
  };
  let agentId: string;
  if (existing) {
    // Rejoin: the old token stops working; status and any held task are left as they are.
    check(await db.from("agents").update(fields).eq("id", existing.id), "agent update");
    agentId = existing.id;
  } else {
    const ins = await db.from("agents").insert(fields).select("id").single();
    if (ins.error?.code === "23505") throw new HttpError(409, `Agent name "${name}" is taken`);
    agentId = checkData(ins, "agent insert").id;
  }

  const token = newToken();
  check(
    await db.from("agent_tokens").upsert({ agent_id: agentId, token_hash: hashToken(token) }, { onConflict: "agent_id" }),
    "token upsert",
  );

  return NextResponse.json<JoinResponse>({ agent_id: agentId, participant_id: participant.id, token });
});
