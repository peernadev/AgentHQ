import { Timestamp } from "firebase-admin/firestore";
import type { PlanRequest, PlanRequestsResponse } from "@/types/api";
import { PLAN_CLAIM_MS } from "@/lib/server/ai-provider";
import { requireAgent } from "@/lib/server/auth";
import { col, getDb } from "@/lib/server/firebase-admin";
import { HttpError, handle } from "@/lib/server/http";
import { agentJson } from "@/lib/server/messages";
import { addEvent } from "@/lib/server/tasks";

const ms = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : 0);

// GET /api/plan-requests: orchestrator agents only (`hq plan-requests`). Returns at most one open
// plan request (a "planning" mission) and claims it for this agent in a transaction, so two
// orchestrators never plan the same mission. Prefers a request this agent already holds; otherwise
// the oldest one that is unclaimed or whose claim expired (PLAN_CLAIM_MINUTES). Every call renews
// this agent's claim. Submit the plan with POST /api/tasks { mission_id, tasks }.
export const GET = handle(async (req: Request) => {
  const agent = await requireAgent(req);
  if (agent.role !== "orchestrator") throw new HttpError(403, "Only orchestrator agents can take plan requests");

  const res = await getDb().runTransaction(async (tx): Promise<PlanRequestsResponse> => {
    const snap = await tx.get(col.missions().where("status", "==", "planning"));
    const now = Timestamp.now();
    const open = snap.docs
      .filter((d) => {
        const holder = d.get("plan_claimed_by") as string | null;
        return !holder || holder === agent.id || ms(d.get("plan_claimed_at")) < now.toMillis() - PLAN_CLAIM_MS;
      })
      .sort((a, b) => Number(b.get("plan_claimed_by") === agent.id) - Number(a.get("plan_claimed_by") === agent.id)
        || ms(a.get("plan_requested_at") ?? a.get("created_at")) - ms(b.get("plan_requested_at") ?? b.get("created_at")));
    const pick = open[0];
    if (!pick) return { requests: [] };

    const previous = pick.get("plan_claimed_by") as string | null;
    tx.update(pick.ref, { plan_claimed_by: agent.id, plan_claimed_by_name: agent.name, plan_claimed_at: now });
    if (previous !== agent.id) {
      addEvent(tx, {
        type: "plan_claimed", mission_id: pick.id, agent_id: agent.id,
        message: `${agent.name} is drafting the plan`, data: previous ? { took_over_from: previous } : null,
      }, now);
    }
    const request: PlanRequest = {
      mission_id: pick.id, title: pick.get("title"), goal: pick.get("goal"),
      requested_by: String(pick.get("created_by") ?? ""),
      requested_at: (pick.get("plan_requested_at") ?? pick.get("created_at")).toDate().toISOString(),
      claimed_at: now.toDate().toISOString(),
    };
    return { requests: [request] };
  });
  return agentJson<PlanRequestsResponse>(agent.id, res);
});
