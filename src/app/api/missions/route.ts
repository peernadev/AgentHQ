import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import type { CreateMissionResponse, Mission } from "@/types/api";
import { col, getDb } from "@/lib/server/firebase-admin";
import { planMission, type QueueItem } from "@/lib/server/google/planner";
import { handle, readBody, str } from "@/lib/server/http";
import { toIso } from "@/lib/server/serialize";
import { readDraftContext, writeDraftTasks } from "@/lib/server/tasks";
import { requireTeamUser } from "@/lib/server/team-auth";

export const maxDuration = 60; // the Gemini call can take a while

const OPEN = ["draft", "queued", "claimed", "in_progress", "in_review", "failed"];

// POST /api/missions { title, goal }: dashboard (team member). Gemini drafts the tasks, then one
// transaction saves the mission plus its draft tasks. Drive/Docs (source_doc_id,
// google_access_token) are Phase 2: ignored here and never stored.
export const POST = handle(async (req: Request) => {
  const user = await requireTeamUser(req);
  const body = await readBody(req);
  const title = str(body, "title", { max: 200 });
  const goal = str(body, "goal", { max: 8000 });

  // Context for the planner (a snapshot; the transaction below re-checks dependencies).
  const [queueSnap, registry] = await Promise.all([
    col.tasks().where("status", "in", OPEN).limit(100).get(),
    col.scopeRegistry().get(),
  ]);
  const queue: QueueItem[] = queueSnap.docs.map((d) => ({
    id: d.id, title: d.get("title"), status: d.get("status"), scope: d.get("scope") ?? [], depends_on: d.get("depends_on") ?? [],
  }));

  // External call: outside any transaction (AGENTS.md correctness rules).
  const { tasks } = await planMission({ title, goal, queue, locks: registry.get("locks") ?? {} });

  const missionId = randomUUID();
  const now = Timestamp.now();
  const mission = {
    title, goal, source_doc_id: null, source_doc_url: null, plan_doc_url: null, handoff_doc_url: null,
    status: "awaiting_approval", created_by: user.email, created_at: now,
  };
  await getDb().runTransaction(async (tx) => {
    const ctx = await readDraftContext(tx, tasks);
    tx.create(col.missions().doc(missionId), mission);
    writeDraftTasks(tx, tasks, ctx, { missionId, createdBy: "gemini-planner", agentId: null }, now);
  });

  return NextResponse.json<CreateMissionResponse>({
    mission: { id: missionId, ...(toIso(mission) as Omit<Mission, "id">) },
    task_ids: tasks.map((t) => t.id),
  });
});
