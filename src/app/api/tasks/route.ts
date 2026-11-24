import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { PLAN_CLAIM_MS } from "@/lib/server/ai-provider";
import { requireAgent } from "@/lib/server/auth";
import { col, getDb } from "@/lib/server/firebase-admin";
import { validate } from "@/lib/server/google/planner";
import { agentJson } from "@/lib/server/messages";
import { HttpError, handle, optStr, readBody } from "@/lib/server/http";
import { parseTaskBatch, type ParsedTask } from "@/lib/server/task-input";
import { addEvent, readDraftContext, writeDraftTasks } from "@/lib/server/tasks";

const OPEN = ["draft", "queued", "claimed", "in_progress", "in_review", "failed"];
const ms = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : 0);

// POST /api/tasks { mission_id?, tasks: CreateTaskInput[] }: orchestrator submits drafts.
// One transaction: all tasks are saved or none. Returns { ids } in input order.
// For a mission in "planning" (an open plan request), the batch is the mission's plan: it gets the
// same strict validation as the Gemini planner (count, real paths, narrow scopes, route location,
// parallel overlap, cycles), all errors in one 400 so the orchestrator can fix and resubmit, and on
// success the mission moves to "awaiting_approval" and the request is closed.
export const POST = handle(async (req: Request) => {
  const agent = await requireAgent(req);
  if (agent.role !== "orchestrator") throw new HttpError(403, "Only orchestrator agents can create tasks");
  const body = await readBody(req);
  const missionId = optStr(body, "mission_id", { max: 128 }) ?? null;
  if (missionId && !/^[A-Za-z0-9_-]+$/.test(missionId)) throw new HttpError(400, `"mission_id" is not a valid id`);

  const before = missionId ? await col.missions().doc(missionId).get() : null;
  if (before && !before.exists) throw new HttpError(400, `Mission "${missionId}" not found`);
  const isPlan = before?.get("status") === "planning";

  let tasks: ParsedTask[];
  if (isPlan) {
    const open = await col.tasks().where("status", "in", OPEN).select().limit(500).get();
    try {
      tasks = validate(JSON.stringify({ tasks: body.tasks }), new Set(open.docs.map((d) => d.id)));
    } catch (e) {
      throw new HttpError(400, `Plan rejected. Fix these and submit again:\n${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    tasks = parseTaskBatch(body.tasks, randomUUID);
  }

  await getDb().runTransaction(async (tx) => {
    const [mission, ctx] = await Promise.all([
      missionId ? tx.get(col.missions().doc(missionId)) : null,
      readDraftContext(tx, tasks),
    ]);
    if (mission && !mission.exists) throw new HttpError(400, `Mission "${missionId}" not found`);
    const now = Timestamp.now();
    if (isPlan) {
      if (mission!.get("status") !== "planning") throw new HttpError(409, "This mission already has a plan");
      const holder = mission!.get("plan_claimed_by") as string | null;
      const expired = ms(mission!.get("plan_claimed_at")) < now.toMillis() - PLAN_CLAIM_MS;
      if (holder && holder !== agent.id && !expired) {
        throw new HttpError(409, `${mission!.get("plan_claimed_by_name") ?? "Another orchestrator"} is planning this mission`);
      }
      tx.update(mission!.ref, {
        status: "awaiting_approval", plan_claimed_by: agent.id, plan_claimed_by_name: agent.name, plan_claimed_at: now,
      });
      addEvent(tx, {
        type: "plan_submitted", mission_id: missionId, agent_id: agent.id,
        message: `${agent.name} drafted ${tasks.length} tasks`, data: { tasks: tasks.length },
      }, now);
    }
    writeDraftTasks(tx, tasks, ctx, { missionId, createdBy: agent.name, agentId: agent.id }, now);
  });
  return agentJson(agent.id, { ids: tasks.map((t) => t.id) });
});
