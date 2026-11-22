import "server-only";
import { Timestamp, type DocumentData, type Transaction } from "firebase-admin/firestore";
import type { Agent, TaskStatus } from "@/types/api";
import { col, getDb } from "./firebase-admin";
import { HttpError } from "./http";

export const LEASE_MS = 10 * 60 * 1000;
export const ACTIVE: TaskStatus[] = ["claimed", "in_progress"];

// Task ids are UUIDs we generate; also accept any safe Firestore id (no "/" path tricks).
const DOC_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function parseTaskId(id: string): string {
  if (!DOC_ID.test(id)) throw new HttpError(400, "Invalid task id");
  return id;
}

export function leaseFrom(now: Timestamp): Timestamp {
  return Timestamp.fromMillis(now.toMillis() + LEASE_MS);
}

/** Two scopes overlap if a prefix of one starts with a prefix of the other. */
export function scopesOverlap(a: string[], b: string[]): boolean {
  return a.some((x) => b.some((y) => x.startsWith(y) || y.startsWith(x)));
}

type EventInput = {
  type: string; task_id?: string | null; agent_id?: string | null; mission_id?: string | null;
  message?: string | null; data?: Record<string, unknown> | null;
};

/** Adds an event write to a transaction (events/{auto}). */
export function addEvent(tx: Transaction, e: EventInput, now = Timestamp.now()) {
  tx.create(col.events().doc(), {
    mission_id: null, task_id: null, agent_id: null, message: null, data: null, ...e, created_at: now,
  });
}

/**
 * Runs `apply` on a task in a transaction, only if this agent holds it with this attempt_id
 * and it is in one of `from`. Throws 404 / 409 with a reason otherwise. `apply` returns the
 * task fields to update; it may also add other writes to the transaction.
 */
export async function mutateOwnTask(
  agent: Agent,
  taskId: string,
  attemptId: string,
  from: TaskStatus[],
  apply: (tx: Transaction, task: DocumentData, now: Timestamp) => DocumentData,
): Promise<void> {
  await getDb().runTransaction(async (tx) => {
    const ref = col.tasks().doc(taskId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, "Task not found");
    const task = snap.data()!;
    if (task.agent_id !== agent.id) throw new HttpError(409, "Task is not held by this agent");
    if (task.attempt_id !== attemptId) {
      throw new HttpError(409, "Stale attempt_id: this claim was released; claim a new task");
    }
    if (!from.includes(task.status)) {
      throw new HttpError(409, `Task is "${task.status}"; expected ${from.join(" or ")}`);
    }
    const now = Timestamp.now();
    tx.update(ref, { ...apply(tx, task, now), updated_at: now });
  });
}
