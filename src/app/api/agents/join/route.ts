import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import type { AgentRole, AgentTool, JoinResponse } from "@/types/api";
import { col, getDb } from "@/lib/server/firebase-admin";
import { hashToken, newToken, safeEqual } from "@/lib/server/auth";
import { HttpError, handle, optStr, readBody, str } from "@/lib/server/http";

const TOOLS: AgentTool[] = ["claude", "codex", "antigravity", "other"];

// POST /api/agents/join: register (or re-register) an agent and issue a fresh token.
export const POST = handle(async (req: Request) => {
  const body = await readBody(req);
  const code = str(body, "code");
  const participantName = str(body, "participant", { max: 50 });
  const name = str(body, "name", { max: 80 });
  const machine = optStr(body, "machine", { max: 120 }) ?? null;
  const model = optStr(body, "model", { max: 80 }) ?? null;
  const tool = (optStr(body, "tool") ?? "other") as AgentTool;
  const role = (optStr(body, "role") ?? "worker") as AgentRole;
  if (!TOOLS.includes(tool)) throw new HttpError(400, `"tool" must be one of ${TOOLS.join(", ")}`);
  if (role !== "worker" && role !== "orchestrator") {
    throw new HttpError(400, `"role" must be "worker" or "orchestrator"`);
  }

  const expected = process.env.TEAM_JOIN_CODE;
  if (!expected) throw new HttpError(500, "TEAM_JOIN_CODE is not configured");
  if (!safeEqual(code, expected)) throw new HttpError(403, "Wrong join code");

  const token = newToken();
  const result = await getDb().runTransaction(async (tx) => {
    const [pSnap, aSnap] = await Promise.all([
      tx.get(col.participants().where("name", "==", participantName).limit(1)),
      tx.get(col.agents().where("name", "==", name).limit(1)),
    ]);
    const existingAgent = aSnap.docs[0];
    const oldTokens = existingAgent
      ? await tx.get(col.agentTokens().where("agent_id", "==", existingAgent.id))
      : null;

    const now = Timestamp.now();
    let participantId = pSnap.docs[0]?.id;
    if (!participantId) {
      participantId = randomUUID();
      tx.create(col.participants().doc(participantId), {
        name: participantName, email: null, color: null, points: 0, tasks_done: 0, created_at: now,
      });
    }
    if (existingAgent && existingAgent.get("participant_id") !== participantId) {
      throw new HttpError(409, `Agent name "${name}" belongs to another participant`);
    }

    const fields = { participant_id: participantId, name, machine, tool, model, role, last_heartbeat: now };
    let agentId: string;
    if (existingAgent) {
      // Rejoin: the old token stops working; status and any held task are left as they are.
      agentId = existingAgent.id;
      tx.update(existingAgent.ref, fields);
      oldTokens?.docs.forEach((d) => tx.delete(d.ref));
    } else {
      agentId = randomUUID();
      tx.create(col.agents().doc(agentId), {
        ...fields, status: "idle", current_task_id: null, note: null, created_at: now,
      });
    }
    tx.create(col.agentTokens().doc(hashToken(token)), { agent_id: agentId, created_at: now });
    return { agent_id: agentId, participant_id: participantId };
  });

  return NextResponse.json<JoinResponse>({ ...result, token });
});
