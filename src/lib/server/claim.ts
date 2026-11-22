import "server-only";
import { randomUUID } from "node:crypto";
import { Timestamp, type DocumentData } from "firebase-admin/firestore";
import { TASK_POINTS, type ClaimResponse, type Task, type TaskSize } from "@/types/api";
import { col, getDb } from "./firebase-admin";
import { HttpError } from "./http";
import { fromDoc, toIso } from "./serialize";
import { ACTIVE, addEvent, leaseFrom, LEASE_MS, scopesOverlap } from "./tasks";

const points = (size: unknown) => TASK_POINTS[size as TaskSize] ?? TASK_POINTS.M;
const ms = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : 0);

/**
 * SPEC §6: one transaction that releases expired leases, applies the fairness rule and
 * claims the best task. Every claim reads and writes meta/scopeRegistry, so claims are
 * serialized. Queries filter on status only (no composite index); sorting is done here.
 */
export async function claimNextTask(agentId: string): Promise<ClaimResponse> {
  return getDb().runTransaction(async (tx) => {
    // ---- reads (Firestore requires all reads before any write) ----
    const [registry, agentsSnap, participantsSnap, queuedSnap, activeSnap] = await Promise.all([
      tx.get(col.scopeRegistry()),
      tx.get(col.agents()),
      tx.get(col.participants()),
      tx.get(col.tasks().where("status", "==", "queued")),
      tx.get(col.tasks().where("status", "in", ACTIVE)),
    ]);
    // Active tasks too: one whose lease expired below is released and claimable in this same round.
    const depIds = [...new Set([...queuedSnap.docs, ...activeSnap.docs]
      .flatMap((d) => (d.get("depends_on") ?? []) as string[]))];
    const depSnaps = depIds.length ? await tx.getAll(...depIds.map((id) => col.tasks().doc(id))) : [];
    const depDone = new Set(depSnaps.filter((s) => s.exists && s.get("status") === "done").map((s) => s.id));

    const now = Timestamp.now();
    const locks: Record<string, string[]> = { ...(registry.get("locks") ?? {}) };
    const agents = new Map(agentsSnap.docs.map((d) => [d.id, { ...d.data() }]));
    const pts = new Map(participantsSnap.docs.map((d) => [d.id, Number(d.get("points") ?? 0)]));
    const touchedAgents = new Set<string>();
    const touchedParticipants = new Set<string>();
    const me = agents.get(agentId);
    if (!me) throw new HttpError(401, "Unknown agent");

    const finish = (res: ClaimResponse): ClaimResponse => {
      tx.set(col.scopeRegistry(), { locks, updated_at: now });
      for (const id of touchedAgents) {
        const a = agents.get(id)!;
        tx.update(col.agents().doc(id), { status: a.status, current_task_id: a.current_task_id ?? null });
      }
      for (const id of touchedParticipants) tx.update(col.participants().doc(id), { points: pts.get(id) ?? 0 });
      return res;
    };
    const setAgent = (id: string, patch: DocumentData) => {
      Object.assign(agents.get(id)!, patch);
      touchedAgents.add(id);
    };
    const addPoints = (participantId: unknown, n: number) => {
      if (typeof participantId !== "string" || !pts.has(participantId)) return;
      pts.set(participantId, Math.max(0, pts.get(participantId)! + n));
      touchedParticipants.add(participantId);
    };

    // ---- 1. release expired leases ----
    const candidates = [...queuedSnap.docs];
    for (const t of activeSnap.docs) {
      const lease = t.get("lease_expires_at") as Timestamp | null;
      if (lease && lease.toMillis() > now.toMillis()) {
        if (t.get("agent_id") === agentId) {
          throw new HttpError(409, "Agent already has an active task; finish it with review or fail first");
        }
        continue;
      }
      const holder = t.get("agent_id") as string | null;
      tx.update(t.ref, {
        status: "queued", agent_id: null, attempt_id: null, lease_expires_at: null, claimed_at: null, updated_at: now,
      });
      delete locks[t.id];
      candidates.push(t);
      if (holder && agents.has(holder)) {
        addPoints(agents.get(holder)!.participant_id, -points(t.get("size")));
        setAgent(holder, { status: "offline", current_task_id: null });
      }
      addEvent(tx, {
        type: "released", task_id: t.id, agent_id: holder, mission_id: t.get("mission_id") ?? null,
        message: "Lease expired; task returned to queue",
      }, now);
    }

    // ---- 2. fairness: > 2 points above the online average while a teammate has an idle worker ----
    const online = (a: DocumentData) =>
      a.status !== "offline" && a.last_heartbeat instanceof Timestamp
      && a.last_heartbeat.toMillis() > now.toMillis() - LEASE_MS;
    const onlineWorkers = [...agents.entries()].filter(([, a]) => a.role === "worker" && online(a));
    const onlineParticipants = [...new Set(onlineWorkers.map(([, a]) => a.participant_id as string))];
    const avg = onlineParticipants.reduce((s, p) => s + (pts.get(p) ?? 0), 0) / (onlineParticipants.length || 1);
    const teammateIdle = onlineWorkers.some(
      ([id, a]) => id !== agentId && a.participant_id !== me.participant_id && a.status === "idle",
    );
    if ((pts.get(me.participant_id) ?? 0) > avg + 2 && teammateIdle) {
      setAgent(agentId, { status: "idle", current_task_id: null });
      addEvent(tx, {
        type: "fairness_skip", agent_id: agentId,
        message: "Ahead of the team on workload; leaving the next task for a teammate",
      }, now);
      return finish({ task: null, reason: "fairness" });
    }

    // ---- 3. pick: lowest priority first, deps done, no scope overlap with any lock ----
    const lockScopes = Object.values(locks);
    const pick = candidates
      .sort((a, b) => (a.get("priority") ?? 100) - (b.get("priority") ?? 100)
        || ms(a.get("created_at")) - ms(b.get("created_at")))
      .find((t) =>
        ((t.get("depends_on") ?? []) as string[]).every((d) => depDone.has(d))
        && !lockScopes.some((l) => scopesOverlap(l, t.get("scope") ?? [])));
    if (!pick) {
      setAgent(agentId, { status: "idle", current_task_id: null });
      return finish({ task: null, reason: "no_task" });
    }

    // ---- 4. claim ----
    const claim = {
      status: "claimed", agent_id: agentId, attempt_id: randomUUID(), lease_expires_at: leaseFrom(now),
      claimed_at: now, updated_at: now,
    };
    tx.update(pick.ref, claim);
    locks[pick.id] = pick.get("scope") ?? [];
    addPoints(me.participant_id, points(pick.get("size")));
    setAgent(agentId, { status: "working", current_task_id: pick.id });
    // +1 ms so the activity feed always shows a same-round "released" before this "claimed".
    addEvent(tx, {
      type: "claimed", task_id: pick.id, agent_id: agentId, mission_id: pick.get("mission_id") ?? null,
      message: pick.get("title"),
    }, Timestamp.fromMillis(now.toMillis() + 1));
    return finish({ task: { ...fromDoc<Task>(pick), ...(toIso(claim) as Partial<Task>) } });
  });
}
