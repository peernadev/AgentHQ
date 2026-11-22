import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { requireAgent } from "@/lib/server/auth";
import { col, getDb } from "@/lib/server/firebase-admin";
import { HttpError, handle, optStr, readBody } from "@/lib/server/http";
import { parseTaskBatch } from "@/lib/server/task-input";
import { addEvent } from "@/lib/server/tasks";

// POST /api/tasks { mission_id?, tasks: CreateTaskInput[] }: orchestrator submits drafts.
// One transaction: all tasks are saved or none. Returns { ids } in input order.
export const POST = handle(async (req: Request) => {
  const agent = await requireAgent(req);
  if (agent.role !== "orchestrator") throw new HttpError(403, "Only orchestrator agents can create tasks");
  const body = await readBody(req);
  const missionId = optStr(body, "mission_id", { max: 128 }) ?? null;
  if (missionId && !/^[A-Za-z0-9_-]+$/.test(missionId)) throw new HttpError(400, `"mission_id" is not a valid id`);
  const tasks = parseTaskBatch(body.tasks, randomUUID);
  const existingDeps = [...new Set(tasks.flatMap((t) => t.existing_deps))];

  await getDb().runTransaction(async (tx) => {
    const [top, mission, deps] = await Promise.all([
      tx.get(col.tasks().orderBy("priority", "desc").limit(1)),
      missionId ? tx.get(col.missions().doc(missionId)) : null,
      existingDeps.length ? tx.getAll(...existingDeps.map((id) => col.tasks().doc(id))) : [],
    ]);
    if (mission && !mission.exists) throw new HttpError(400, `Mission "${missionId}" not found`);
    const missing = deps.filter((d) => !d.exists).map((d) => d.id);
    if (missing.length) throw new HttpError(400, `depends_on: unknown task ids ${missing.join(", ")}`);

    // Tasks without a priority go after everything else, in batch order.
    let next = Number(top.docs[0]?.get("priority") ?? 0);
    const now = Timestamp.now();
    for (const t of tasks) {
      const priority = t.priority ?? (next += 10);
      tx.create(col.tasks().doc(t.id), {
        mission_id: missionId, title: t.title, description: t.description, acceptance: t.acceptance ?? null,
        priority, size: t.size, scope: t.scope, depends_on: t.depends_on, status: "draft",
        agent_id: null, attempt_id: null, lease_expires_at: null, branch: null, pr_url: null, head_sha: null,
        checks: null, review: null, result_summary: null, created_by: agent.name,
        claimed_at: null, completed_at: null, created_at: now, updated_at: now,
      });
      addEvent(tx, { type: "created", task_id: t.id, agent_id: agent.id, mission_id: missionId, message: t.title }, now);
    }
  });
  return NextResponse.json({ ids: tasks.map((t) => t.id) });
});
