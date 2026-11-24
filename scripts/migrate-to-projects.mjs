#!/usr/bin/env node
// One-time move to project-centered data (SPEC §5). Dry run by default; `--write` applies. Idempotent.
//
// Phase 1 (--delete-mission / --delete-participant): delete seed/demo data: the named missions with
// their tasks and events, the named participants with their agents, tokens and events, and every
// message to or from those agents. Locks held by deleted tasks are dropped.
// Phase 2: create the project (fixed id), add owners, stamp project_id on every remaining
// participant, agent, agentToken, mission, task, event, message and outbox doc, copy the remaining
// scope locks into scopeRegistries/{id}, and optionally link a participant to an owner's email.
// The join code hash comes from TEAM_JOIN_CODE in .env.local, so existing hq join commands and
// tokens keep working. Owner emails are passed at run time, never stored in the repo.
//
//   node scripts/migrate-to-projects.mjs \
//     --project-id agenthq --name AgentHQ --repo https://github.com/peernadev/agenthq --branch main \
//     --owner you@example.com:YourName --owner teammate@example.com:Name \
//     --link-participant YourName=you@example.com \
//     --delete-mission "Weekly leaderboard" --delete-participant Eran ...   [--write]
// Uses firebase-admin with FIREBASE_SERVICE_ACCOUNT_B64 from .env.local. Never prints secrets.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]));
for (const k of ["FIREBASE_SERVICE_ACCOUNT_B64", "TEAM_JOIN_CODE"]) if (!env[k]) throw new Error(`${k} missing in .env.local`);
const sa = JSON.parse(Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_B64, "base64").toString("utf8"));
const db = getFirestore(initializeApp({ credential: cert(sa), projectId: sa.project_id }));

const { values: o } = parseArgs({ options: {
  "project-id": { type: "string" }, name: { type: "string" }, repo: { type: "string" }, branch: { type: "string", default: "main" },
  owner: { type: "string", multiple: true, default: [] }, "link-participant": { type: "string", multiple: true, default: [] },
  "delete-mission": { type: "string", multiple: true, default: [] }, "delete-participant": { type: "string", multiple: true, default: [] },
  write: { type: "boolean", default: false },
} });
const PID = o["project-id"];
if (!PID || !/^[a-z0-9-]{3,40}$/.test(PID) || !o.name || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(o.repo ?? "")) {
  throw new Error("Need --project-id (a-z0-9-), --name and --repo https://github.com/<owner>/<repo>");
}
const owners = o.owner.map((s) => { const [email, name] = s.split(":"); if (!/^[^@\s]+@[^@\s]+$/.test(email ?? "")) throw new Error(`bad --owner ${s}`); return { email: email.toLowerCase(), name: name || email.split("@")[0] }; });
if (!owners.length) throw new Error("Need at least one --owner email:name");
const links = o["link-participant"].map((s) => { const [name, email] = s.split("="); return { name, email: email?.toLowerCase() }; });
const mask = (email) => email.replace(/^(.).*?@/, "$1***@");

// ---------- phase 1: what to delete ----------
const all = async (c) => (await db.collection(c).get()).docs;
const [missions, tasks, events, messages, participants, agents, tokens, outbox] = await Promise.all(
  ["missions", "tasks", "events", "messages", "participants", "agents", "agentTokens", "outbox"].map(all));
const delMissions = missions.filter((m) => o["delete-mission"].includes(m.get("title")));
const missingMissions = o["delete-mission"].filter((t) => !missions.some((m) => m.get("title") === t));
const delParticipants = participants.filter((p) => o["delete-participant"].includes(p.get("name")));
const missingParticipants = o["delete-participant"].filter((n) => !participants.some((p) => p.get("name") === n));
const delMissionIds = new Set(delMissions.map((d) => d.id));
const delParticipantIds = new Set(delParticipants.map((d) => d.id));
const delAgents = agents.filter((a) => delParticipantIds.has(a.get("participant_id")));
const delAgentIds = new Set(delAgents.map((d) => d.id));
const delTasks = tasks.filter((t) => delMissionIds.has(t.get("mission_id")));
const delTaskIds = new Set(delTasks.map((d) => d.id));
const delEvents = events.filter((e) => delMissionIds.has(e.get("mission_id")) || delTaskIds.has(e.get("task_id")) || delAgentIds.has(e.get("agent_id")));
const delMessages = messages.filter((m) => delAgentIds.has(m.get("from_agent")) || delAgentIds.has(m.get("to_agent")) || delTaskIds.has(m.get("to_task")));
const delTokens = tokens.filter((t) => delAgentIds.has(t.get("agent_id")));
// Kept docs that would point at deleted ones (a kept agent working on a deleted task, a kept task assigned to a deleted agent).
const keptAgentsOnDeletedTasks = agents.filter((a) => !delAgentIds.has(a.id) && delTaskIds.has(a.get("current_task_id")));
const keptTasksOfDeletedAgents = tasks.filter((t) => !delTaskIds.has(t.id) && delAgentIds.has(t.get("agent_id")));

console.log(`=== Phase 1: delete seed data ${o.write ? "(WRITE)" : "(dry run)"} ===`);
for (const m of delMissions) console.log(`  mission  "${m.get("title")}"  (${tasks.filter((t) => t.get("mission_id") === m.id).length} tasks)`);
for (const p of delParticipants) console.log(`  participant ${p.get("name")}  agents: ${agents.filter((a) => a.get("participant_id") === p.id).map((a) => a.get("name")).join(", ") || "none"}`);
console.log(`  totals: ${delMissions.length} missions, ${delTasks.length} tasks, ${delEvents.length} events, ${delMessages.length} messages, ${delParticipants.length} participants, ${delAgents.length} agents, ${delTokens.length} tokens`);
if (missingMissions.length || missingParticipants.length) console.log(`  not found (skipped): ${[...missingMissions, ...missingParticipants].join(", ")}`);
if (keptAgentsOnDeletedTasks.length) console.log(`  kept agents whose current task is deleted (will be set idle): ${keptAgentsOnDeletedTasks.map((a) => a.get("name")).join(", ")}`);
if (keptTasksOfDeletedAgents.length) console.log(`  WARNING kept tasks assigned to deleted agents: ${keptTasksOfDeletedAgents.map((t) => t.get("title")).join(", ")}`);

// ---------- phase 2: what to migrate ----------
const keep = (docs, gone) => docs.filter((d) => !gone.has(d.id));
const keepIds = (docs) => new Set(docs.map((d) => d.id));
const kept = {
  participants: keep(participants, delParticipantIds), agents: keep(agents, delAgentIds),
  agentTokens: tokens.filter((t) => !delTokens.includes(t)), missions: keep(missions, delMissionIds),
  tasks: keep(tasks, delTaskIds), events: keep(events, keepIds(delEvents)), messages: keep(messages, keepIds(delMessages)), outbox,
};
const stamp = Object.fromEntries(Object.entries(kept).map(([c, docs]) => [c, docs.filter((d) => d.get("project_id") !== PID)]));
const otherProject = Object.values(kept).flat().filter((d) => d.get("project_id") && d.get("project_id") !== PID);
const registry = (await db.doc("meta/scopeRegistry").get()).get("locks") ?? {};
const keptTaskIds = keepIds(kept.tasks);
const locks = Object.fromEntries(Object.entries(registry).filter(([id]) => keptTaskIds.has(id)));
const project = await db.doc(`projects/${PID}`).get();
const linkPlan = links.map((l) => ({ ...l, doc: kept.participants.find((p) => p.get("name") === l.name) }));

console.log(`\n=== Phase 2: migrate into project "${o.name}" (${PID}) ${o.write ? "(WRITE)" : "(dry run)"} ===`);
console.log(`  project: ${project.exists ? "exists (kept; join code hash refreshed from TEAM_JOIN_CODE)" : "create"}  repo ${o.repo}  branch ${o.branch}`);
console.log(`  owners: ${owners.map((w) => `${w.name} <${mask(w.email)}>`).join(", ")}`);
for (const [c, docs] of Object.entries(stamp)) console.log(`  stamp project_id on ${String(docs.length).padStart(3)} ${c}${c === "participants" || c === "agents" ? `: ${docs.map((d) => d.get("name")).join(", ")}` : ""}${c === "missions" ? `: ${docs.map((d) => `"${d.get("title")}"`).join(", ")}` : ""}`);
console.log(`  scope locks: ${Object.keys(locks).length} kept of ${Object.keys(registry).length} -> scopeRegistries/${PID} (meta/scopeRegistry stays until P3 is live)`);
for (const l of linkPlan) console.log(`  link participant ${l.name} -> ${l.email ? mask(l.email) : "?"}${l.doc ? "" : "  (participant NOT FOUND, skipped)"}`);
if (otherProject.length) console.log(`  WARNING ${otherProject.length} docs already belong to another project; left alone`);

if (!o.write) { console.log("\nDry run only. Re-run with --write to apply both phases."); process.exit(0); }

// ---------- apply ----------
const ops = [];
const del = (ref) => ops.push((b) => b.delete(ref));
[...delMissions, ...delTasks, ...delEvents, ...delMessages, ...delParticipants, ...delAgents, ...delTokens].forEach((d) => del(d.ref));
for (const a of keptAgentsOnDeletedTasks) ops.push((b) => b.update(a.ref, { current_task_id: null, status: "idle" }));
if (delTaskIds.size) ops.push((b) => b.set(db.doc("meta/scopeRegistry"), { locks: Object.fromEntries([...delTaskIds].map((id) => [id, FieldValue.delete()])) }, { merge: true }));
const now = Timestamp.now();
const joinHash = createHash("sha256").update(env.TEAM_JOIN_CODE).digest("hex");
ops.push((b) => b.set(db.doc(`projects/${PID}`), {
  name: o.name, repo_url: o.repo, default_branch: o.branch, join_code_hash: joinHash,
  created_by: project.get("created_by") ?? owners[0].email, created_at: project.get("created_at") ?? now,
}, { merge: true }));
for (const w of owners) {
  ops.push((b) => b.set(db.doc(`projectMembers/${PID}_${w.email}`), {
    project_id: PID, email: w.email, name: w.name, role: "owner", color: null, added_by: "migration", created_at: now,
  }, { merge: true }));
}
for (const docs of Object.values(stamp)) for (const d of docs) ops.push((b) => b.update(d.ref, { project_id: PID }));
ops.push((b) => b.set(db.doc(`scopeRegistries/${PID}`), { project_id: PID, locks, updated_at: now }));
for (const l of linkPlan) if (l.doc && l.email) ops.push((b) => b.update(l.doc.ref, { email: l.email }));

for (let i = 0; i < ops.length; i += 400) {
  const b = db.batch();
  ops.slice(i, i + 400).forEach((op) => op(b));
  await b.commit();
}
console.log(`\nApplied ${ops.length} writes.`);
process.exit(0);
