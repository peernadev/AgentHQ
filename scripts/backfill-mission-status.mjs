#!/usr/bin/env node
// Recomputes every mission's stored status from its tasks, with the server's own rule
// (src/lib/server/mission-status.ts). For missions written before the server kept
// missions.status in sync (#20). Dry run by default; `--write` saves the changes.
// Uses firebase-admin with FIREBASE_SERVICE_ACCOUNT_B64 from .env.local. Never prints secrets.
//   node scripts/backfill-mission-status.mjs           # dry run
//   node scripts/backfill-mission-status.mjs --write   # apply (+ one mission_status event each)
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { deriveMissionStatus } = await import(pathToFileURL(path.join(root, "src/lib/server/mission-status.ts")).href);
const env = Object.fromEntries(readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!env.FIREBASE_SERVICE_ACCOUNT_B64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 missing in .env.local");
const sa = JSON.parse(Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_B64, "base64").toString("utf8"));
const db = getFirestore(initializeApp({ credential: cert(sa), projectId: sa.project_id }));
const write = process.argv.includes("--write");

const [missions, tasks] = await Promise.all([db.collection("missions").get(), db.collection("tasks").get()]);
const byMission = new Map();
for (const t of tasks.docs) {
  const id = t.get("mission_id");
  if (id) byMission.set(id, [...(byMission.get(id) ?? []), t.get("status")]);
}

const changes = [];
for (const m of missions.docs) {
  const current = m.get("status");
  const statuses = byMission.get(m.id) ?? [];
  const next = deriveMissionStatus(statuses, current);
  const counts = Object.entries(statuses.reduce((c, s) => ({ ...c, [s]: (c[s] ?? 0) + 1 }), {})).map(([s, n]) => `${s}:${n}`).join(" ");
  console.log(`${next === current ? "  ok    " : "  CHANGE"} ${m.id.slice(0, 8)} "${m.get("title")}" ${current}${next === current ? "" : ` -> ${next}`}  [${counts || "no tasks"}]`);
  if (next !== current) changes.push({ ref: m.ref, id: m.id, from: current, to: next });
}

if (!write) {
  console.log(`\nDry run: ${changes.length} of ${missions.size} missions would change. Run with --write to apply.`);
  process.exit(0);
}
const now = Timestamp.now();
const batch = db.batch();
for (const c of changes) {
  batch.update(c.ref, { status: c.to });
  batch.create(db.collection("events").doc(), {
    mission_id: c.id, task_id: null, agent_id: null, type: "mission_status", message: c.to,
    data: { from: c.from, to: c.to, by: "backfill-mission-status" }, created_at: now,
  });
}
if (changes.length) await batch.commit();
console.log(`\nWrote ${changes.length} mission status ${changes.length === 1 ? "change" : "changes"}.`);
process.exit(0);
