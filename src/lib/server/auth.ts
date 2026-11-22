import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Agent } from "@/types/api";
import { getSupabaseAdmin } from "./supabase-admin";
import { HttpError, check, checkData } from "./http";

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
 * Authenticates an agent from `Authorization: Bearer <token>` and records a heartbeat
 * (last_heartbeat = now, offline -> idle). Throws 401 if the token is missing or unknown.
 */
export async function requireAgent(req: Request): Promise<Agent> {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!match) throw new HttpError(401, "Missing bearer token");

  const db = getSupabaseAdmin();
  const tok = check(
    await db.from("agent_tokens").select("agent_id").eq("token_hash", hashToken(match[1])).maybeSingle(),
    "token lookup",
  );
  if (!tok) throw new HttpError(401, "Invalid token");

  const agent = checkData(
    await db.from("agents").update({ last_heartbeat: new Date().toISOString() })
      .eq("id", tok.agent_id).select("*").single(),
    "heartbeat",
  ) as Agent;
  if (agent.status !== "offline") return agent;

  // Back from offline (e.g. after a stale sweep): it no longer holds a task.
  return checkData(
    await db.from("agents").update({ status: "idle", current_task_id: null })
      .eq("id", agent.id).select("*").single(),
    "heartbeat",
  ) as Agent;
}
