import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import type { AgentRole, AgentTool, JoinResponse } from "@/types/api";
import { col, getDb } from "@/lib/server/firebase-admin";
import { hashToken, newToken } from "@/lib/server/auth";
import { HttpError, handle, optStr, readBody, str } from "@/lib/server/http";
import { agentJson } from "@/lib/server/messages";

const TOOLS: AgentTool[] = ["claude", "codex", "antigravity", "other"];

// POST /api/agents/join: register (or re-register) an agent in the project whose join code this
// is, and issue a fresh token. The code selects the project (only its sha256 is stored).
// Participants and agent names are per project. With `email`, the participant is linked to the
// project member with that Google email (403 if there is none).
export const POST = handle(async (req: Request) => {
  const body = await readBody(req);
  const code = str(body, "code");
  const participantName = str(body, "participant", { max: 50 });
  const name = str(body, "name", { max: 80 });
  const email = optStr(body, "email", { max: 200 })?.toLowerCase() ?? null;
  const machine = optStr(body, "machine", { max: 120 }) ?? null;
  const model = optStr(body, "model", { max: 80 }) ?? null;
  const tool = (optStr(body, "tool") ?? "other") as AgentTool;
  const role = (optStr(body, "role") ?? "worker") as AgentRole;
  if (!TOOLS.includes(tool)) throw new HttpError(400, `"tool" must be one of ${TOOLS.join(", ")}`);
  if (role !== "worker" && role !== "orchestrator") throw new HttpError(400, `"role" must be "worker" or "orchestrator"`);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, `"email" must be an email address`);

  // Lookup by hash: the code itself is never stored or compared in plain text.
  const projects = await col.projects().where("join_code_hash", "==", hashToken(code)).limit(2).get();
  if (projects.size !== 1) throw new HttpError(403, "Wrong join code");
  const project = projects.docs[0];
  const projectId = project.id;
  if (email && !(await col.memberDoc(projectId, email).get()).exists) {
    throw new HttpError(403, `${email} isn't a member of ${project.get("name")}; ask a project owner to add you on the Team page`);
  }

  const token = newToken();
  const result = await getDb().runTransaction(async (tx) => {
    const [pByEmail, pByName, aSnap] = await Promise.all([
      email ? tx.get(col.participants().where("project_id", "==", projectId).where("email", "==", email).limit(1)) : null,
      tx.get(col.participants().where("project_id", "==", projectId).where("name", "==", participantName).limit(1)),
      tx.get(col.agents().where("project_id", "==", projectId).where("name", "==", name).limit(1)),
    ]);
    const existingAgent = aSnap.docs[0];
    const oldTokens = existingAgent ? await tx.get(col.agentTokens().where("agent_id", "==", existingAgent.id)) : null;

    const now = Timestamp.now();
    const participant = pByEmail?.docs[0] ?? pByName.docs[0];
    let participantId = participant?.id;
    if (!participantId) {
      participantId = randomUUID();
      tx.create(col.participants().doc(participantId), {
        project_id: projectId, name: participantName, email, color: null, points: 0, tasks_done: 0, created_at: now,
      });
    } else if (email && participant!.get("email") !== email) {
      if (participant!.get("email")) throw new HttpError(409, `Participant "${participantName}" is linked to another email`);
      tx.update(participant!.ref, { email });
    }
    if (existingAgent && existingAgent.get("participant_id") !== participantId) {
      throw new HttpError(409, `Agent name "${name}" belongs to another participant in this project`);
    }

    const fields = { project_id: projectId, participant_id: participantId, name, machine, tool, model, role, last_heartbeat: now };
    let agentId: string;
    if (existingAgent) {
      // Rejoin: the old token stops working; status and any held task are left as they are.
      agentId = existingAgent.id;
      tx.update(existingAgent.ref, fields);
      oldTokens?.docs.forEach((d) => tx.delete(d.ref));
    } else {
      agentId = randomUUID();
      tx.create(col.agents().doc(agentId), { ...fields, status: "idle", current_task_id: null, note: null, created_at: now });
    }
    tx.create(col.agentTokens().doc(hashToken(token)), { agent_id: agentId, project_id: projectId, created_at: now });
    return { agent_id: agentId, participant_id: participantId };
  });

  return agentJson<JoinResponse>(result.agent_id, { ...result, token, project_id: projectId, project_name: String(project.get("name")) });
});
