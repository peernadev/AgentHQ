import { Timestamp } from "firebase-admin/firestore";
import type { SendMessageResponse } from "@/types/api";
import { requireAgent } from "@/lib/server/auth";
import { col, getDb } from "@/lib/server/firebase-admin";
import { HttpError, handle, optStr, readBody, str } from "@/lib/server/http";
import { agentJson } from "@/lib/server/messages";
import { ACTIVE, addEvent, parseTaskId } from "@/lib/server/tasks";

// A task's "current agent": the one working on it, or the one whose PR is in review.
const HELD = [...ACTIVE, "in_review"];

// POST /api/messages { to_agent | to_task, text }: agent -> agent message, across machines.
// to_agent is an agent id or name; to_task resolves to the task's current agent.
// The recipient gets it in the `inbox` of its next agent-route response.
export const POST = handle(async (req: Request) => {
  const agent = await requireAgent(req);
  const body = await readBody(req);
  const toAgent = optStr(body, "to_agent", { max: 128 });
  const toTask = optStr(body, "to_task", { max: 128 });
  const text = str(body, "text", { max: 2000 });
  if (Boolean(toAgent) === Boolean(toTask)) throw new HttpError(400, `Send exactly one of "to_agent" or "to_task"`);
  const taskId = toTask ? parseTaskId(toTask) : null;

  const res = await getDb().runTransaction(async (tx): Promise<SendMessageResponse> => {
    let recipientId: string | null = null;
    let missionId: string | null = null;
    if (taskId) {
      const task = await tx.get(col.tasks().doc(taskId));
      if (!task.exists || task.get("project_id") !== agent.project_id) throw new HttpError(404, "Task not found");
      recipientId = HELD.includes(task.get("status")) ? (task.get("agent_id") as string | null) : null;
      if (!recipientId) throw new HttpError(409, `No agent is on task ${taskId} (status "${task.get("status")}")`);
      missionId = task.get("mission_id") ?? null;
    }
    // to_agent: try it as an id, then as a name (agent names are unique per project, see /api/agents/join).
    // Only agents in the sender's project can be reached; any other agent is "not found".
    const byId = toAgent && /^[A-Za-z0-9_-]+$/.test(toAgent) ? await tx.get(col.agents().doc(toAgent)) : null;
    const recipient = recipientId
      ? await tx.get(col.agents().doc(recipientId))
      : byId?.exists && byId.get("project_id") === agent.project_id ? byId
      : (await tx.get(col.agents().where("project_id", "==", agent.project_id).where("name", "==", toAgent).limit(1))).docs[0];
    if (!recipient?.exists || recipient.get("project_id") !== agent.project_id) throw new HttpError(404, `No agent "${toAgent}"`);
    if (recipient.id === agent.id) throw new HttpError(400, "Can't message yourself");

    const now = Timestamp.now();
    const ref = col.messages().doc();
    const toName = String(recipient.get("name") ?? recipient.id);
    tx.create(ref, {
      project_id: agent.project_id, from_agent: agent.id, from_name: agent.name, to_agent: recipient.id, to_task: taskId,
      text, created_at: now, read_at: null,
    });
    addEvent(tx, {
      project_id: agent.project_id, type: "message", agent_id: agent.id, task_id: taskId, mission_id: missionId,
      message: `${agent.name} → ${toName}: ${text}`, data: { message_id: ref.id, to_agent: recipient.id },
    }, now);
    return { message_id: ref.id, to_agent: recipient.id, to_name: toName };
  });
  return agentJson(agent.id, res);
});

// GET /api/messages: heartbeat + this agent's unread messages (`hq inbox`).
export const GET = handle(async (req: Request) => {
  const agent = await requireAgent(req);
  return agentJson(agent.id, {});
});
