import "server-only";
import type { Agent, Task, TaskStatus } from "@/types/api";
import { getSupabaseAdmin } from "./supabase-admin";
import { HttpError, check } from "./http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseTaskId(id: string): string {
  if (!UUID.test(id)) throw new HttpError(400, "Task id must be a UUID");
  return id;
}

/**
 * Updates a task only if this agent holds it and it is in one of `from`. The guard runs in
 * the UPDATE itself, so a task the stale sweep already released can't be moved anyway.
 * Throws 404 / 409 with a reason when the guard fails.
 */
export async function transitionOwnTask(
  agent: Agent,
  taskId: string,
  from: TaskStatus[],
  patch: Partial<Task>,
): Promise<Task> {
  const db = getSupabaseAdmin();
  const updated = check(
    await db.from("tasks").update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", taskId).eq("agent_id", agent.id).in("status", from)
      .select("*").maybeSingle(),
    "task update",
  ) as Task | null;
  if (updated) return updated;

  const task = check(
    await db.from("tasks").select("status, agent_id").eq("id", taskId).maybeSingle(),
    "task lookup",
  );
  if (!task) throw new HttpError(404, "Task not found");
  if (task.agent_id !== agent.id) throw new HttpError(409, "Task is not held by this agent");
  throw new HttpError(409, `Task is "${task.status}"; expected ${from.join(" or ")}`);
}

export async function logEvent(e: {
  type: string; task_id?: string | null; agent_id?: string | null;
  message?: string | null; data?: Record<string, unknown> | null;
}) {
  check(await getSupabaseAdmin().from("events").insert(e), "event insert");
}
