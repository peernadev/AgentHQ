import "server-only";
import { Timestamp, type DocumentData, type Transaction } from "firebase-admin/firestore";
import type { Agent, MissionStatus, TaskStatus } from "@/types/api";
import { col, getDb } from "./firebase-admin";
import { HttpError } from "./http";
import { deriveMissionStatus } from "./mission-status";
import type { ParsedTask } from "./task-input";

// Lease length: LEASE_MINUTES env (default 10). Also how long an agent counts as alive after a heartbeat.
const leaseMinutes = Number(process.env.LEASE_MINUTES);
export const LEASE_MS = (Number.isFinite(leaseMinutes) && leaseMinutes > 0 ? leaseMinutes : 10) * 60 * 1000;
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
 * Reads what saving a draft batch needs (Firestore: all reads before writes) and checks that
 * `depends_on` ids outside the batch exist. Returns the priority to count up from.
 */
export async function readDraftContext(tx: Transaction, tasks: ParsedTask[]): Promise<{ lastPriority: number }> {
  const existingDeps = [...new Set(tasks.flatMap((t) => t.existing_deps))];
  const [top, deps] = await Promise.all([
    tx.get(col.tasks().orderBy("priority", "desc").limit(1)),
    existingDeps.length ? tx.getAll(...existingDeps.map((id) => col.tasks().doc(id))) : [],
  ]);
  const missing = deps.filter((d) => !d.exists).map((d) => d.id);
  if (missing.length) throw new HttpError(400, `depends_on: unknown task ids ${missing.join(", ")}`);
  return { lastPriority: Number(top.docs[0]?.get("priority") ?? 0) };
}

/** Writes a validated batch as drafts plus one `created` event each. Missing priorities go last, in batch order. */
export function writeDraftTasks(
  tx: Transaction,
  tasks: ParsedTask[],
  ctx: { lastPriority: number },
  meta: { missionId: string | null; createdBy: string; agentId: string | null },
  now = Timestamp.now(),
) {
  let next = ctx.lastPriority;
  for (const t of tasks) {
    tx.create(col.tasks().doc(t.id), {
      mission_id: meta.missionId, title: t.title, description: t.description, acceptance: t.acceptance ?? null,
      priority: t.priority ?? (next += 10), size: t.size, scope: t.scope, depends_on: t.depends_on, status: "draft",
      agent_id: null, attempt_id: null, lease_expires_at: null, branch: null, pr_url: null, head_sha: null,
      checks: null, review: null, result_summary: null, created_by: meta.createdBy,
      claimed_at: null, completed_at: null, created_at: now, updated_at: now,
    });
    addEvent(tx, { type: "created", task_id: t.id, agent_id: meta.agentId, mission_id: meta.missionId, message: t.title }, now);
  }
}

/** What a mission's status update needs, read in the transaction's read phase. */
export interface MissionRead { id: string; current: MissionStatus; statuses: Map<string, string> }

/** Reads a mission and its tasks (reads only). null if there's no mission. */
export async function readMission(tx: Transaction, missionId: string | null | undefined): Promise<MissionRead | null> {
  if (!missionId) return null;
  const [mission, tasks] = await Promise.all([
    tx.get(col.missions().doc(missionId)),
    tx.get(col.tasks().where("mission_id", "==", missionId)),
  ]);
  if (!mission.exists) return null;
  return {
    id: missionId, current: mission.get("status") as MissionStatus,
    statuses: new Map(tasks.docs.map((d) => [d.id, d.get("status") as string])),
  };
}

/** Writes the mission's derived status after `changes` ({ taskId: newStatus }), plus an event if it changed. */
export function writeMissionStatus(tx: Transaction, m: MissionRead | null, changes: Record<string, string>, now: Timestamp) {
  if (!m) return;
  const statuses = new Map(m.statuses);
  for (const [id, s] of Object.entries(changes)) if (statuses.has(id)) statuses.set(id, s);
  const next = deriveMissionStatus([...statuses.values()], m.current);
  if (next === m.current) return;
  tx.update(col.missions().doc(m.id), { status: next });
  addEvent(tx, { type: "mission_status", mission_id: m.id, message: next, data: { from: m.current, to: next } }, now);
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
    const mission = await readMission(tx, task.mission_id);
    const now = Timestamp.now();
    const update = apply(tx, task, now);
    tx.update(ref, { ...update, updated_at: now });
    if (typeof update.status === "string") writeMissionStatus(tx, mission, { [taskId]: update.status }, now);
  });
}
