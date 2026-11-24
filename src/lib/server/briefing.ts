import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import type { ChangeSummary } from "@/types/api";
import { col } from "./firebase-admin";

const MAX_SINCE = 10;
const MAX_FIRST = 5;
const ms = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : 0);

/**
 * "What changed since your last task": tasks done after this agent's previous claim
 * (newest first), in the agent's own project. On an agent's first claim, the few most recent done tasks.
 * Read-only and outside the claim transaction; single-field queries, sorted here.
 */
export async function sinceLastClaim(agentId: string, projectId: string, currentTaskId: string): Promise<ChangeSummary[]> {
  const [claims, done] = await Promise.all([
    col.events().where("agent_id", "==", agentId).where("type", "==", "claimed").get(),
    col.tasks().where("project_id", "==", projectId).where("status", "==", "done").get(),
  ]);
  const previous = claims.docs
    .filter((e) => e.get("task_id") !== currentTaskId)
    .reduce((max, e) => Math.max(max, ms(e.get("created_at"))), 0);

  const tasks = done.docs
    .filter((t) => t.id !== currentTaskId && ms(t.get("completed_at")) > previous)
    .sort((a, b) => ms(b.get("completed_at")) - ms(a.get("completed_at")))
    .slice(0, previous ? MAX_SINCE : MAX_FIRST);

  return tasks.map((t) => ({
    id: t.id,
    title: String(t.get("title") ?? ""),
    summary: (t.get("result_summary") as string | null) ?? null,
    completed_at: (t.get("completed_at") as Timestamp).toDate().toISOString(),
  }));
}
