import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/server/auth";
import { col, getDb } from "@/lib/server/firebase-admin";
import { HttpError, handle, optStr, readBody } from "@/lib/server/http";
import { parseTaskBatch } from "@/lib/server/task-input";
import { readDraftContext, writeDraftTasks } from "@/lib/server/tasks";

// POST /api/tasks { mission_id?, tasks: CreateTaskInput[] }: orchestrator submits drafts.
// One transaction: all tasks are saved or none. Returns { ids } in input order.
export const POST = handle(async (req: Request) => {
  const agent = await requireAgent(req);
  if (agent.role !== "orchestrator") throw new HttpError(403, "Only orchestrator agents can create tasks");
  const body = await readBody(req);
  const missionId = optStr(body, "mission_id", { max: 128 }) ?? null;
  if (missionId && !/^[A-Za-z0-9_-]+$/.test(missionId)) throw new HttpError(400, `"mission_id" is not a valid id`);
  const tasks = parseTaskBatch(body.tasks, randomUUID);

  await getDb().runTransaction(async (tx) => {
    const [mission, ctx] = await Promise.all([
      missionId ? tx.get(col.missions().doc(missionId)) : null,
      readDraftContext(tx, tasks),
    ]);
    if (mission && !mission.exists) throw new HttpError(400, `Mission "${missionId}" not found`);
    writeDraftTasks(tx, tasks, ctx, { missionId, createdBy: agent.name, agentId: agent.id });
  });
  return NextResponse.json({ ids: tasks.map((t) => t.id) });
});
