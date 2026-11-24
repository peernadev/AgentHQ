import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import type { CreateMissionResponse, Mission } from "@/types/api";
import { aiProvider } from "@/lib/server/ai-provider";
import { col, getDb } from "@/lib/server/firebase-admin";
import { cachedDemoPlan, planMission, PlannerBusyError, type QueueItem } from "@/lib/server/google/planner";
import { handle, readBody, str } from "@/lib/server/http";
import { toIso } from "@/lib/server/serialize";
import type { ParsedTask } from "@/lib/server/task-input";
import { addEvent, readDraftContext, writeDraftTasks } from "@/lib/server/tasks";
import { requireTeamUser } from "@/lib/server/team-auth";

export const maxDuration = 60; // the Gemini call can take a while

const OPEN = ["draft", "queued", "claimed", "in_progress", "in_review", "failed"];

// POST /api/missions { title, goal }: dashboard (team member). With AI_PROVIDER=claude-code (default)
// it saves a "planning" mission (an open plan request for an orchestrator agent). With
// AI_PROVIDER=gemini, Gemini drafts the tasks, then one transaction saves the mission plus its
// drafts. Drive/Docs (source_doc_id, google_access_token) are future work: ignored, never stored.
export const POST = handle(async (req: Request) => {
  const user = await requireTeamUser(req);
  const body = await readBody(req);
  const title = str(body, "title", { max: 200 });
  const goal = str(body, "goal", { max: 8000 });

  // AI_PROVIDER=claude-code: save the mission as an open plan request; an orchestrator agent
  // claims it via GET /api/plan-requests and submits drafts with POST /api/tasks. No AI call here.
  if (aiProvider() === "claude-code") {
    const missionId = randomUUID();
    const now = Timestamp.now();
    const mission = {
      title, goal, source_doc_id: null, source_doc_url: null, plan_doc_url: null, handoff_doc_url: null,
      status: "planning", created_by: user.email, created_at: now, plan_source: "orchestrator",
      plan_requested_at: now, plan_claimed_by: null, plan_claimed_by_name: null, plan_claimed_at: null,
    };
    await getDb().runTransaction(async (tx) => {
      tx.create(col.missions().doc(missionId), mission);
      addEvent(tx, { type: "plan_requested", mission_id: missionId, message: "Waiting for an orchestrator to draft the plan", data: { by: user.email } }, now);
    });
    return NextResponse.json<CreateMissionResponse>({ mission: { id: missionId, ...(toIso(mission) as Omit<Mission, "id">) }, task_ids: [] });
  }

  // Context for the planner (a snapshot; the transaction below re-checks dependencies).
  const [queueSnap, registry] = await Promise.all([
    col.tasks().where("status", "in", OPEN).limit(100).get(),
    col.scopeRegistry().get(),
  ]);
  const queue: QueueItem[] = queueSnap.docs.map((d) => ({
    id: d.id, title: d.get("title"), status: d.get("status"), scope: d.get("scope") ?? [], depends_on: d.get("depends_on") ?? [],
  }));

  // External call: outside any transaction (AGENTS.md correctness rules).
  // If Gemini is busy and DEMO_FALLBACK=1, use the saved demo plan, always flagged as cached.
  let tasks: ParsedTask[];
  let cached: ReturnType<typeof cachedDemoPlan> = null;
  try {
    const plan = await planMission({ title, goal, queue, locks: registry.get("locks") ?? {} });
    tasks = plan.tasks;
    console.info(`planner: ${tasks.length} tasks from ${plan.model} (attempt ${plan.attempts})`);
  } catch (e) {
    cached = e instanceof PlannerBusyError ? cachedDemoPlan(queue) : null;
    if (!cached) throw e;
    tasks = cached.tasks;
  }

  const missionId = randomUUID();
  const now = Timestamp.now();
  const mission = {
    title, goal, source_doc_id: null, source_doc_url: null, plan_doc_url: null, handoff_doc_url: null,
    status: "awaiting_approval", created_by: user.email, created_at: now,
    plan_source: cached ? "cached_demo" : "gemini",
  };
  await getDb().runTransaction(async (tx) => {
    const ctx = await readDraftContext(tx, tasks);
    tx.create(col.missions().doc(missionId), mission);
    writeDraftTasks(tx, tasks, ctx, { missionId, createdBy: "gemini-planner", agentId: null }, now);
    if (cached) {
      addEvent(tx, {
        type: "plan_cached", mission_id: missionId,
        message: `Gemini was busy: showing the cached demo plan ("${cached.source.title}", captured ${cached.source.captured_at})`,
        data: cached.source,
      }, now);
    }
  });

  return NextResponse.json<CreateMissionResponse>({
    mission: { id: missionId, ...(toIso(mission) as Omit<Mission, "id">) },
    task_ids: tasks.map((t) => t.id),
    ...(cached ? { cached_plan: true } : {}),
  });
});
