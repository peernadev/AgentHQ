import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import type { Agent } from "@/types/api";
import { col, getDb } from "./firebase-admin";
import { HttpError } from "./http";
import { fromDoc } from "./serialize";
import { ACTIVE, leaseFrom } from "./tasks";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return `hq_${randomBytes(32).toString("hex")}`;
}

/** Constant-time string compare (via hashes, so lengths may differ). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

/**
 * Authenticates an agent from `Authorization: Bearer <token>` (sha256 -> agentTokens/{sha}).
 * Every call is a heartbeat: last_heartbeat = now, offline -> idle, and the lease on the
 * agent's active task is renewed for another 10 minutes. Throws 401 if the token is unknown.
 */
export async function requireAgent(req: Request): Promise<Agent> {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!match) throw new HttpError(401, "Missing bearer token");

  const tok = await col.agentTokens().doc(hashToken(match[1])).get();
  const agentId = tok.get("agent_id") as string | undefined;
  if (!agentId) throw new HttpError(401, "Invalid token");

  return getDb().runTransaction(async (tx) => {
    const ref = col.agents().doc(agentId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(401, "Invalid token");
    const agent = fromDoc<Agent>(snap);
    // Every agent belongs to one project (it scopes all its calls). Pre-projects agents must rejoin.
    if (!agent.project_id) throw new HttpError(401, "This agent isn't in a project; run hq join again with the project's join code");
    const task = agent.current_task_id ? await tx.get(col.tasks().doc(agent.current_task_id)) : null;

    const now = Timestamp.now();
    agent.last_heartbeat = now.toDate().toISOString();
    if (agent.status === "offline") {
      // Back after a lease release: it no longer holds a task.
      Object.assign(agent, { status: "idle", current_task_id: null });
    } else if (task?.exists && task.get("agent_id") === agentId && ACTIVE.includes(task.get("status"))) {
      tx.update(task.ref, { lease_expires_at: leaseFrom(now) });
    }
    tx.update(ref, { last_heartbeat: now, status: agent.status, current_task_id: agent.current_task_id });
    return agent;
  });
}
