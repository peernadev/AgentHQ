import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import type { CheckResults, OrchestratorRequest, PlanRequestsResponse, TaskSize } from "@/types/api";
import { requireAgent } from "@/lib/server/auth";
import { col, getDb } from "@/lib/server/firebase-admin";
import { HttpError, handle } from "@/lib/server/http";
import { agentJson } from "@/lib/server/messages";
import { lastFailure, mayTake } from "@/lib/server/orchestrator";
import { addEvent } from "@/lib/server/tasks";

const ms = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : 0);
const iso = (t: unknown) => (t instanceof Timestamp ? t.toDate().toISOString() : new Date(0).toISOString());
type Candidate = { kind: "plan" | "recovery" | "review"; snap: DocumentSnapshot; req: FirebaseFirestore.DocumentData };

// GET /api/plan-requests: orchestrator agents only (`hq plan-requests`), within the agent's project. Returns at most one open
// request and claims it for this agent in a transaction, so two orchestrators never take the same one:
//   plan     - a "planning" mission    -> submit with POST /api/tasks { mission_id, tasks }
//   recovery - a failed task           -> submit with POST /api/tasks/:id/recovery { kind, task }
//   review   - an in_review task's PR  -> submit with POST /api/tasks/:id/verdict { sha, verdict, notes, evidence }
// Prefers a request this agent already holds; otherwise the oldest unclaimed or expired one
// (claims last PLAN_CLAIM_MINUTES). Every call renews this agent's claim.
export const GET = handle(async (req: Request) => {
  const agent = await requireAgent(req);
  if (agent.role !== "orchestrator") throw new HttpError(403, "Only orchestrator agents can take plan, recovery and review requests");

  const picked = await getDb().runTransaction(async (tx) => {
    const [missions, tasks] = await Promise.all([
      tx.get(col.missions().where("project_id", "==", agent.project_id).where("status", "==", "planning")),
      tx.get(col.tasks().where("project_id", "==", agent.project_id).where("orchestrator_request.kind", "in", ["recovery", "review"])),
    ]);
    const now = Timestamp.now();
    const candidates: Candidate[] = [
      ...missions.docs.map((snap) => ({
        kind: "plan" as const, snap,
        req: { requested_at: snap.get("plan_requested_at") ?? snap.get("created_at"), claimed_by: snap.get("plan_claimed_by"), claimed_at: snap.get("plan_claimed_at") },
      })),
      ...tasks.docs.map((snap) => ({ kind: snap.get("orchestrator_request.kind") as "recovery" | "review", snap, req: snap.get("orchestrator_request") })),
    ];
    // A review request is stale once the task left review or its head moved: drop it.
    const stale = candidates.filter((c) => c.kind === "review" && (c.snap.get("status") !== "in_review" || c.snap.get("head_sha") !== c.req.sha));
    const recoveryDone = candidates.filter((c) => c.kind === "recovery" && c.snap.get("status") !== "failed");
    const live = candidates.filter((c) => !stale.includes(c) && !recoveryDone.includes(c) && mayTake(c.req, agent.id, now))
      .sort((a, b) => Number(b.req.claimed_by === agent.id) - Number(a.req.claimed_by === agent.id) || ms(a.req.requested_at) - ms(b.req.requested_at));
    for (const c of [...stale, ...recoveryDone]) tx.update(c.snap.ref, { orchestrator_request: null });
    const pick = live[0];
    if (!pick) return null;

    const claim = { claimed_by: agent.id, claimed_by_name: agent.name, claimed_at: now };
    if (pick.kind === "plan") tx.update(pick.snap.ref, { plan_claimed_by: agent.id, plan_claimed_by_name: agent.name, plan_claimed_at: now });
    else tx.update(pick.snap.ref, { orchestrator_request: { ...pick.req, ...claim } });
    if (pick.req.claimed_by !== agent.id) {
      const missionId = pick.kind === "plan" ? pick.snap.id : pick.snap.get("mission_id");
      addEvent(tx, {
        project_id: agent.project_id, type: `${pick.kind}_claimed`, mission_id: missionId, task_id: pick.kind === "plan" ? null : pick.snap.id, agent_id: agent.id,
        message: `${agent.name} is ${pick.kind === "plan" ? "drafting the plan" : pick.kind === "recovery" ? "drafting a recovery" : "reviewing the PR"}`,
        data: pick.req.claimed_by ? { took_over_from: pick.req.claimed_by } : null,
      }, now);
    }
    return { kind: pick.kind, id: pick.snap.id, data: pick.snap.data()!, req: pick.req, claimedAt: iso(now) };
  });

  if (!picked) return agentJson<PlanRequestsResponse>(agent.id, { requests: [] });
  const d = picked.data;
  const base = { title: String(d.title), requested_by: String(picked.req.requested_by ?? d.created_by ?? ""), requested_at: iso(picked.req.requested_at), claimed_at: picked.claimedAt };
  const task = { title: d.title, description: d.description, acceptance: d.acceptance ?? null, scope: d.scope ?? [], size: (d.size ?? "M") as TaskSize };
  let request: OrchestratorRequest;
  if (picked.kind === "plan") request = { kind: "plan", mission_id: picked.id, goal: String(d.goal), ...base };
  else if (picked.kind === "recovery") request = { kind: "recovery", mission_id: d.mission_id, task_id: picked.id, task, failure: await lastFailure(picked.id), ...base };
  else request = { kind: "review", mission_id: d.mission_id, task_id: picked.id, task, pr_url: String(d.pr_url), head_sha: String(d.head_sha), checks: d.checks as CheckResults, ...base };
  return agentJson<PlanRequestsResponse>(agent.id, { requests: [request] });
});
