#!/usr/bin/env node
// Demo seed: a believable mid-hackathon state for the mission "Weekly leaderboard".
//   node scripts/demo-seed.mjs --reset   wipe operational data (a JSON backup goes to the OS temp dir), then seed
//   node scripts/demo-seed.mjs           seed only (refuses if a "Weekly leaderboard" mission already exists)
// Uses firebase-admin with FIREBASE_SERVICE_ACCOUNT_B64 from .env.local. Never prints secrets.
// The state follows the claim rules (SPEC §6): points = sizes of claimed tasks not failed or released,
// locks = in_progress + in_review scopes, mission status derived from task statuses (mission-status.ts).
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!env.FIREBASE_SERVICE_ACCOUNT_B64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 missing in .env.local");
const sa = JSON.parse(Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_B64, "base64").toString("utf8"));
const db = getFirestore(initializeApp({ credential: cert(sa), projectId: sa.project_id }));

const COLLECTIONS = ["participants", "agents", "agentTokens", "missions", "tasks", "events", "messages"];
const TITLE = "Weekly leaderboard";
const POINTS = { S: 1, M: 2, L: 4 };
const leaseMin = Number(env.LEASE_MINUTES ?? process.env.LEASE_MINUTES) > 0 ? Number(env.LEASE_MINUTES ?? process.env.LEASE_MINUTES) : 10;
const NOW = Date.now();
const ago = (min) => Timestamp.fromMillis(NOW - min * 60_000);
const REPO = "https://github.com/peernadev/agenthq/pull/";

// ---------- reset ----------
async function reset() {
  const backup = {};
  const counts = {};
  for (const c of COLLECTIONS) {
    const snap = await db.collection(c).get();
    backup[c] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    counts[c] = snap.size;
    for (let i = 0; i < snap.docs.length; i += 400) {
      const b = db.batch();
      snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
  }
  const reg = await db.doc("meta/scopeRegistry").get();
  backup.scopeRegistry = reg.exists ? reg.data() : null;
  await db.doc("meta/scopeRegistry").set({ locks: {}, updated_at: Timestamp.now() });
  const file = path.join(tmpdir(), `agenthq-backup-${new Date(NOW).toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(backup, null, 1));
  console.log("reset: deleted", Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" "), "| scopeRegistry cleared");
  console.log("reset: backup written to", file);
}

// ---------- seed ----------
async function seed() {
  const dup = await db.collection("missions").where("title", "==", TITLE).limit(1).get();
  if (!dup.empty) throw new Error(`A "${TITLE}" mission already exists; run with --reset`);

  const P = { eran: randomUUID(), omer: randomUUID(), dana: randomUUID() };
  const A = { eran1: randomUUID(), omer1: randomUUID(), dana1: randomUUID(), eran2: randomUUID() };
  const MID = randomUUID();
  const T = Object.fromEntries(["types", "store", "api", "table", "podium", "reset", "badges", "page"].map((k) => [k, randomUUID()]));
  const agentOf = { [A.eran1]: "eran", [A.eran2]: "eran", [A.omer1]: "omer", [A.dana1]: "dana" };
  const agentName = { [A.eran1]: "eran-claude-1", [A.omer1]: "omer-codex-1", [A.dana1]: "dana-antigravity-1", [A.eran2]: "eran-claude-2" };
  const allChecks = { lint: true, typecheck: true, build: true };
  const review = (sha, minAgo, notes, evidence) =>
    ({ verdict: "pass", notes, sha, reviewed_at: ago(minAgo), evidence, model: "gemini-3.8-flash" });

  // Tasks (Gemini plan, ~2 h ago). Real merged PRs + their real head SHAs for the evidence.
  const base = (key, f) => ({
    mission_id: MID, depends_on: [], agent_id: null, attempt_id: null, lease_expires_at: null, branch: null, pr_url: null,
    head_sha: null, checks: null, review: null, result_summary: null, created_by: "gemini-planner",
    claimed_at: null, completed_at: null, created_at: ago(122), updated_at: ago(122), ...f, id: T[key],
  });
  const tasks = [
    base("types", {
      title: "Add leaderboard types", size: "S", priority: 10, scope: ["src/types/leaderboard.ts"], status: "done",
      description: "Define LeaderboardEntry, WeeklyScore and LeaderboardResponse in src/types/leaderboard.ts. These are the contract the API and UI tasks build on.",
      acceptance: "- LeaderboardEntry has participant_id, name, points, rank\n- npx tsc --noEmit passes",
      agent_id: A.eran1, attempt_id: randomUUID(), claimed_at: ago(110), completed_at: ago(88), updated_at: ago(88),
      branch: "feat/planner-quality", pr_url: REPO + "10", head_sha: "eb71d749b5e32c59d6351119faf59ec4a0cb270c", checks: allChecks,
      result_summary: "Leaderboard contract types added; API and UI tasks unblocked.",
      review: review("eb71d749b5e32c59d6351119faf59ec4a0cb270c", 92, "Small, contract-only change inside the task scope. Checks pass at the reviewed SHA.",
        ["lint, typecheck, build: pass at eb71d74", "All changed files are inside the task scope", "Acceptance: LeaderboardEntry fields present"]),
    }),
    base("store", {
      title: "Weekly score aggregation in server logic", size: "M", priority: 20, scope: ["src/lib/server/leaderboard.ts"], status: "done",
      description: "Implement getWeeklyLeaderboard() in src/lib/server/leaderboard.ts: sum each participant's points for the current ISO week from Firestore and rank them.",
      acceptance: "- Returns participants sorted by weekly points, ties by name\n- Week boundary is Monday 00:00 UTC",
      depends_on: [T.types], agent_id: A.omer1, attempt_id: randomUUID(), claimed_at: ago(86), completed_at: ago(55), updated_at: ago(55),
      branch: "feat/api-missions", pr_url: REPO + "6", head_sha: "557131ed0136a4d02ed1342365dfa5351e6ec2eb", checks: allChecks,
      result_summary: "Weekly aggregation with deterministic tie-break; reads only, no transactions needed.",
      review: review("557131ed0136a4d02ed1342365dfa5351e6ec2eb", 60, "Aggregation matches the acceptance bullets; reads are bounded. Checks pass at the reviewed SHA.",
        ["lint, typecheck, build: pass at 557131e", "Sort order: points desc, then name", "No writes outside the task scope"]),
    }),
    base("api", {
      title: "GET /api/leaderboard route", size: "S", priority: 20, scope: ["src/app/api/leaderboard/route.ts"], status: "done",
      description: "Add GET /api/leaderboard in src/app/api/leaderboard/route.ts that returns getWeeklyLeaderboard() as LeaderboardResponse JSON.",
      acceptance: "- GET /api/leaderboard returns the top 10 as JSON\n- 200 with an empty list when nobody has points",
      depends_on: [T.types], agent_id: A.dana1, attempt_id: randomUUID(), claimed_at: ago(84), completed_at: ago(40), updated_at: ago(40),
      branch: "feat/review-recover", pr_url: REPO + "12", head_sha: "eda1d5b13913d7432e5f8fc9d5f194210ede430e", checks: allChecks,
      result_summary: "Route returns the top 10; empty week returns { entries: [] }.",
      review: review("eda1d5b13913d7432e5f8fc9d5f194210ede430e", 45, "Route is thin and delegates to server logic as the conventions ask. Checks pass at the reviewed SHA.",
        ["lint, typecheck, build: pass at eda1d5b", "Route file under src/app/api/leaderboard/", "Acceptance: empty list case handled"]),
    }),
    base("table", {
      title: "Leaderboard table component", size: "M", priority: 20, scope: ["src/components/leaderboard/table.tsx"], status: "in_review",
      description: "Build the ranked table in src/components/leaderboard/table.tsx: rank, name, weekly points, with the top 3 highlighted. Readable on a projector.",
      acceptance: "- Renders 10 rows from LeaderboardResponse\n- Works at 375px without horizontal scroll",
      depends_on: [T.types], agent_id: A.eran2, attempt_id: randomUUID(), claimed_at: ago(80), updated_at: ago(24),
      branch: "feat/lease-minutes-mission-status", pr_url: REPO + "20", head_sha: "e76c92fb5d3ad7c9aa5d562e17348495bce1fbbe", checks: allChecks,
      result_summary: "Table with top-3 highlight; mobile layout checked at 375px.",
    }),
    base("podium", {
      title: "Top-3 podium component", size: "M", priority: 30, scope: ["src/components/leaderboard/podium.tsx"], status: "in_progress",
      description: "Build a podium for the week's top 3 in src/components/leaderboard/podium.tsx, using LeaderboardEntry. Large, calm status colors.",
      acceptance: "- Shows 1st/2nd/3rd with names and points\n- Handles fewer than 3 entries",
      depends_on: [T.types], agent_id: A.eran1, attempt_id: randomUUID(), claimed_at: ago(34), updated_at: ago(4),
      lease_expires_at: Timestamp.fromMillis(NOW - 4 * 60_000 + leaseMin * 60_000),
    }),
    base("reset", {
      title: "Weekly reset job and its API route", size: "M", priority: 30,
      scope: ["src/lib/server/leaderboard-reset.ts", "src/app/api/leaderboard/reset/route.ts"], status: "in_progress",
      description: "Add resetWeek() in src/lib/server/leaderboard-reset.ts that snapshots last week's ranking, and POST /api/leaderboard/reset (team only) that calls it.",
      acceptance: "- Snapshot saved once per week (idempotent)\n- POST /api/leaderboard/reset returns 403 for non-team users",
      depends_on: [T.store], agent_id: A.omer1, attempt_id: randomUUID(), claimed_at: ago(50), updated_at: ago(2),
      lease_expires_at: Timestamp.fromMillis(NOW - 2 * 60_000 + leaseMin * 60_000),
    }),
    base("badges", {
      title: "Streak badges component", size: "S", priority: 30, scope: ["src/components/leaderboard/badges.tsx"], status: "failed",
      description: "Show a streak badge (3+ weeks in the top 3) next to a name in src/components/leaderboard/badges.tsx.",
      acceptance: "- Badge appears for a 3-week streak\n- No badge for new participants",
      depends_on: [T.types], agent_id: A.dana1, attempt_id: randomUUID(), claimed_at: ago(38), updated_at: ago(18),
    }),
    base("page", {
      title: "Leaderboard page: wire table, podium and API", size: "M", priority: 40, scope: ["src/app/leaderboard/"], status: "queued",
      description: "Add the /leaderboard page in src/app/leaderboard/ that fetches GET /api/leaderboard and renders the podium above the table.",
      acceptance: "- /leaderboard shows podium + table from live data\n- Loading and empty states",
      depends_on: [T.api, T.table, T.podium],
    }),
  ];

  // Points (claim adds size points, fail refunds) and tasks_done, derived from the tasks above.
  const pts = { eran: 0, omer: 0, dana: 0 }, done = { eran: 0, omer: 0, dana: 0 };
  for (const t of tasks) {
    if (!t.agent_id) continue;
    const who = agentOf[t.agent_id];
    if (t.status !== "failed") pts[who] += POINTS[t.size];
    if (t.status === "done") done[who]++;
  }
  const locks = Object.fromEntries(tasks.filter((t) => ["claimed", "in_progress", "in_review"].includes(t.status)).map((t) => [t.id, t.scope]));
  // Derived mission status (same rules as src/lib/server/mission-status.ts).
  const live = tasks.map((t) => t.status).filter((s) => s !== "cancelled");
  const missionStatus = live.every((s) => s === "done") ? "done"
    : live.some((s) => ["queued", "claimed", "in_progress", "failed"].includes(s)) ? "running"
      : live.some((s) => s === "in_review") ? "reviewing" : "awaiting_approval";

  const participants = [
    { id: P.eran, name: "Eran", color: "indigo", created_at: ago(130) },
    { id: P.omer, name: "Omer", color: "amber", created_at: ago(128) },
    { id: P.dana, name: "Dana", color: "teal", created_at: ago(127) },
  ].map((p) => { const k = p.name.toLowerCase(); return { ...p, email: null, points: pts[k], tasks_done: done[k] }; });

  const agents = [
    { id: A.eran1, participant_id: P.eran, name: "eran-claude-1", machine: "eran-laptop", tool: "claude", model: "claude-opus-5-5",
      status: "working", current_task_id: T.podium, note: "Podium renders; handling the fewer-than-3 case", last_heartbeat: ago(4), created_at: ago(115) },
    { id: A.omer1, participant_id: P.omer, name: "omer-codex-1", machine: "omer-desktop", tool: "codex", model: null,
      status: "working", current_task_id: T.reset, note: "Snapshot write is idempotent; adding the team check on the route", last_heartbeat: ago(2), created_at: ago(112) },
    { id: A.dana1, participant_id: P.dana, name: "dana-antigravity-1", machine: "dana-laptop", tool: "antigravity", model: "gemini-3.8-flash",
      status: "idle", current_task_id: null, note: null, last_heartbeat: ago(3), created_at: ago(111) },
    { id: A.eran2, participant_id: P.eran, name: "eran-claude-2", machine: "eran-laptop", tool: "claude", model: "claude-sonnet-5-5",
      status: "offline", current_task_id: null, note: null, last_heartbeat: ago(22), created_at: ago(95) },
  ].map((a) => ({ role: "worker", ...a }));

  const mission = {
    id: MID, title: TITLE, goal: "Add a weekly leaderboard: a ranked table and a top-3 podium on /leaderboard, fed by GET /api/leaderboard, with a weekly reset that snapshots last week's ranking and streak badges for 3 weeks in the top 3.",
    source_doc_id: null, source_doc_url: null, plan_doc_url: null, handoff_doc_url: null,
    status: missionStatus, created_by: "Eran", created_at: ago(123), plan_source: "gemini",
  };

  const LOG = [
    "src/components/leaderboard/badges.tsx:14:27 - error TS2339: Property 'streak_weeks' does not exist on type 'LeaderboardEntry'.",
    "",
    "14   const weeks = entry.streak_weeks ?? 0;",
    "                             ~~~~~~~~~~~~",
    "",
    "Found 1 error in src/components/leaderboard/badges.tsx:14",
    "",
    "npm run build: Failed to compile. Type error: Property 'streak_weeks' does not exist on type 'LeaderboardEntry'.",
  ].join("\n");

  const msgs = [
    { id: randomUUID(), from_agent: A.omer1, from_name: "omer-codex-1", to_agent: A.eran1, to_task: T.podium,
      text: "Heads up: getWeeklyLeaderboard() returns ties sorted by name, so the podium can show two people with the same points.",
      created_at: ago(27), read_at: ago(26) },
    { id: randomUUID(), from_agent: A.dana1, from_name: "dana-antigravity-1", to_agent: A.eran1, to_task: null,
      text: "Badges failed: LeaderboardEntry has no streak_weeks yet. Can the types task own that field, or should I add it?",
      created_at: ago(16), read_at: null },
  ];

  // Timeline: oldest first. Each entry: [minutesAgo, type, taskKey|null, agentId|null, message, data?]
  const E = [
    [121, "created", null, null, "Gemini planner drafted 8 tasks", { by: "gemini-planner", tasks: 8 }],
    [118, "approved", null, null, "8 tasks approved", { by: "Eran", tasks: 8 }],
    [118, "mission_status", null, null, "running", { from: "awaiting_approval", to: "running" }],
    [110, "claimed", "types", A.eran1], [97, "pr_opened", "types", A.eran1, null, { pr_url: REPO + "10" }],
    [92, "reviewed", "types", null, "pass: Small, contract-only change inside the task scope.", { verdict: "pass", sha: "eb71d749b5e32c59d6351119faf59ec4a0cb270c", model: "gemini-3.8-flash" }],
    [88, "done", "types", A.eran1], [86, "claimed", "store", A.omer1], [84, "claimed", "api", A.dana1],
    [80, "claimed", "table", A.eran2],
    [66, "progress", "store", A.omer1, "Aggregation done; adding the ISO-week boundary tests"],
    [62, "pr_opened", "store", A.omer1, null, { pr_url: REPO + "6" }],
    [60, "reviewed", "store", null, "pass: Aggregation matches the acceptance bullets.", { verdict: "pass", sha: "557131ed0136a4d02ed1342365dfa5351e6ec2eb", model: "gemini-3.8-flash" }],
    [55, "done", "store", A.omer1], [50, "claimed", "reset", A.omer1],
    [46, "pr_opened", "api", A.dana1, null, { pr_url: REPO + "12" }],
    [45, "reviewed", "api", null, "pass: Route is thin and delegates to server logic.", { verdict: "pass", sha: "eda1d5b13913d7432e5f8fc9d5f194210ede430e", model: "gemini-3.8-flash" }],
    [40, "done", "api", A.dana1], [38, "claimed", "badges", A.dana1], [34, "claimed", "podium", A.eran1],
    [27, "message", "podium", A.omer1, `omer-codex-1 → eran-claude-1: ${msgs[0].text}`, { message_id: msgs[0].id, to_agent: A.eran1 }],
    [24, "pr_opened", "table", A.eran2, null, { pr_url: REPO + "20" }],
    [18, "failed", "badges", A.dana1, "Typecheck and build fail: LeaderboardEntry has no streak_weeks", { reason: "Typecheck and build fail: LeaderboardEntry has no streak_weeks", log_excerpt: LOG }],
    [16, "message", null, A.dana1, `dana-antigravity-1 → eran-claude-1: ${msgs[1].text}`, { message_id: msgs[1].id, to_agent: A.eran1 }],
    [4, "progress", "podium", A.eran1, "Podium renders; handling the fewer-than-3 case"],
    [2, "progress", "reset", A.omer1, "Snapshot write is idempotent; adding the team check on the route"],
  ];
  const byKey = Object.fromEntries(tasks.map((t) => [Object.keys(T).find((k) => T[k] === t.id), t]));
  const events = E.map(([m, type, key, agent, message, data], i) => ({
    mission_id: MID, task_id: key ? T[key] : null, agent_id: agent ?? null, type,
    message: message ?? (key ? byKey[key].title : null), data: data ?? null,
    created_at: Timestamp.fromMillis(NOW - m * 60_000 + i), // +i ms keeps same-minute events in order
  }));

  const b = db.batch();
  b.set(db.doc(`missions/${MID}`), (({ id, ...m }) => m)(mission));
  for (const { id, ...p } of participants) b.set(db.doc(`participants/${id}`), p);
  for (const { id, ...a } of agents) b.set(db.doc(`agents/${id}`), a);
  for (const { id, ...t } of tasks) b.set(db.doc(`tasks/${id}`), t);
  for (const { id, ...m } of msgs) b.set(db.doc(`messages/${id}`), m);
  for (const e of events) b.set(db.collection("events").doc(), e);
  b.set(db.doc("meta/scopeRegistry"), { locks, updated_at: Timestamp.now() });
  await b.commit();

  // ---------- summary ----------
  console.log(`\nseeded project ${sa.project_id}: mission "${TITLE}" status=${missionStatus} (lease ${leaseMin} min)`);
  console.log("participants:", participants.map((p) => `${p.name} points=${p.points} done=${p.tasks_done}`).join(" | "));
  console.log("agents:      ", agents.map((a) => `${a.name}(${a.status})`).join(" "));
  console.log("tasks:");
  for (const t of tasks) {
    console.log(`  ${t.status.padEnd(11)} ${t.size} p${String(t.priority).padEnd(3)} ${t.title.padEnd(46)} ${(agentName[t.agent_id] ?? "-").padEnd(19)} ${t.pr_url ? "PR #" + t.pr_url.split("/").pop() : ""}${t.review ? " review=pass" : ""}`);
  }
  console.log("locks:       ", Object.values(locks).map((s) => s.join(", ")).join(" | "));
  console.log(`events: ${events.length} over the last ${E[0][0]} min | messages: ${msgs.length} (1 unread)`);
}

if (process.argv.includes("--reset")) await reset();
await seed();
process.exit(0);
