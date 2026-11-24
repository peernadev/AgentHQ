import "server-only";
import { Timestamp, type Transaction } from "firebase-admin/firestore";
import type { OrchestratorTaskRequest, TaskSize } from "@/types/api";
import { PLAN_CLAIM_MS } from "./ai-provider";
import { col, getDb } from "./firebase-admin";
import type { RecoveryInput } from "./google/recovery";
import { HttpError } from "./http";
import type { ParsedTask } from "./task-input";
import { addEvent, readDraftContext, writeDraftTasks } from "./tasks";

// Shared by the dashboard routes (recover, review-task) and the orchestrator routes
// (plan-requests, tasks/:id/recovery, tasks/:id/verdict).

export const OPEN = ["draft", "queued", "claimed", "in_progress", "in_review", "failed"];
const ms = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : 0);

/** A new task-level request for an orchestrator (stored as tasks/{id}.orchestrator_request). */
export function newTaskRequest(kind: OrchestratorTaskRequest["kind"], by: string, now: Timestamp, sha: string | null = null) {
  return { kind, requested_at: now, requested_by: by, sha, claimed_by: null, claimed_by_name: null, claimed_at: null };
}

/** Whether `agentId` may act on a request: unclaimed, its own, or another agent's expired claim. */
export function mayTake(req: { claimed_by?: string | null; claimed_at?: unknown }, agentId: string, now: Timestamp): boolean {
  return !req.claimed_by || req.claimed_by === agentId || ms(req.claimed_at) < now.toMillis() - PLAN_CLAIM_MS;
}

/** An open request that is still live: requested or claimed less than PLAN_CLAIM_MINUTES ago. */
export function isFresh(req: { requested_at?: unknown; claimed_at?: unknown } | null | undefined, now: Timestamp): boolean {
  return Boolean(req) && now.toMillis() - Math.max(ms(req!.requested_at), ms(req!.claimed_at)) < PLAN_CLAIM_MS;
}

/** A draft that an earlier recovery proposed for this failed task and nobody acted on yet. */
export async function pendingProposal(failedId: string, tx?: Transaction): Promise<string | null> {
  const q = col.events().where("task_id", "==", failedId).where("type", "==", "recovery_proposed");
  const events = tx ? await tx.get(q) : await q.get();
  const ids = events.docs.map((e) => e.get("data")?.draft_task_id).filter((x): x is string => typeof x === "string");
  if (!ids.length) return null;
  const refs = ids.map((id) => col.tasks().doc(id));
  const drafts = tx ? await tx.getAll(...refs) : await getDb().getAll(...refs);
  return drafts.find((d) => d.exists && d.get("status") === "draft")?.id ?? null;
}

/** The latest failure reason and log of a task (from its "failed" events). */
export async function lastFailure(taskId: string): Promise<{ reason: string; log_excerpt: string | null }> {
  const events = await col.events().where("task_id", "==", taskId).where("type", "==", "failed").get();
  const last = events.docs.sort((a, b) => ms(b.get("created_at")) - ms(a.get("created_at")))[0];
  return {
    reason: String(last?.get("data")?.reason ?? last?.get("message") ?? "No reason recorded"),
    log_excerpt: (last?.get("data")?.log_excerpt as string | null | undefined) ?? null,
  };
}

/** What validating a recovery draft needs: the failed task, its failure, the open queue and the locks. */
export async function recoveryInput(taskId: string, t: FirebaseFirestore.DocumentData): Promise<RecoveryInput> {
  const projectId = String(t.project_id);
  const [failure, queueSnap, registry] = await Promise.all([
    lastFailure(taskId),
    col.tasks().where("project_id", "==", projectId).where("status", "in", OPEN).select().limit(500).get(),
    col.scopeRegistry(projectId).get(),
  ]);
  return {
    failed: { id: taskId, title: t.title, description: t.description, acceptance: t.acceptance ?? null, scope: t.scope ?? [], size: (t.size ?? "M") as TaskSize },
    reason: failure.reason, log_excerpt: failure.log_excerpt,
    queueIds: new Set(queueSnap.docs.map((d) => d.id)),
    locks: registry.get("locks") ?? {},
  };
}

/**
 * Saves a validated recovery draft for a failed task, in one transaction: the task must still be
 * failed with no other pending draft; writes the draft + a recovery_proposed event and clears any
 * open orchestrator recovery request. `guard` runs inside the transaction for extra checks.
 */
export async function saveRecovery(p: {
  projectId: string; missionId: string; failedId: string; kind: "fix" | "prerequisite"; task: ParsedTask;
  model: string; by: string; agentId: string | null; createdBy: string;
  guard?: (cur: FirebaseFirestore.DocumentSnapshot, now: Timestamp) => void;
}): Promise<void> {
  await getDb().runTransaction(async (tx) => {
    const ref = col.tasks().doc(p.failedId);
    const [cur, again, draftCtx] = await Promise.all([tx.get(ref), pendingProposal(p.failedId, tx), readDraftContext(tx, [p.task], p.projectId)]);
    const now = Timestamp.now();
    if (cur.get("project_id") !== p.projectId) throw new HttpError(404, "Task not found");
    if (cur.get("status") !== "failed") throw new HttpError(409, "The task is no longer failed; recovery discarded");
    if (again) throw new HttpError(409, `A recovery draft for this task already exists: ${again}`);
    p.guard?.(cur, now);
    writeDraftTasks(tx, [p.task], draftCtx, { projectId: p.projectId, missionId: p.missionId, createdBy: p.createdBy, agentId: p.agentId }, now);
    if (cur.get("orchestrator_request")) tx.update(ref, { orchestrator_request: null, updated_at: now });
    addEvent(tx, {
      project_id: p.projectId, type: "recovery_proposed", task_id: p.failedId, mission_id: p.missionId, agent_id: p.agentId,
      message: `${p.kind === "fix" ? "Fix" : "Prerequisite"} proposed: ${p.task.title}`,
      data: { failed_task_id: p.failedId, draft_task_id: p.task.id, kind: p.kind, model: p.model, by: p.by },
    }, now);
  });
}
