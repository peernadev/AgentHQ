#!/usr/bin/env node
// Two-project isolation smoke test (SPEC §5): projects A and B must never see, claim, message,
// review or approve each other's work. Live Firestore; agents via the real hq CLI; dashboard calls
// with a real Firebase ID token for a temporary verified user who is a member of A only.
//
// Safety: all data lives in throwaway "smoke-" projects (real orchestrators are project-scoped and
// can't see them); plan requests are created already claimed by that project's smoke orchestrator;
// the smoke sweep runs before and after (in finally), so no plan request or smoke doc is left open.
//   SMOKE_URL=http://localhost:3000 node scripts/smoke/projects-isolation.mjs
//   SMOKE_URL=https://agenthq-nine.vercel.app node scripts/smoke/projects-isolation.mjs
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Timestamp } from "firebase-admin/firestore";
import { adminFromEnv, SMOKE, sweep } from "./sweep.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const admin = adminFromEnv(root);
const { db, auth, env } = admin;
const URL = process.env.SMOKE_URL || "http://localhost:3000";
const HQ = path.join(root, "cli/hq.mjs");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "hq-smoke-"));
let failed = 0;
const check = (name, cond, detail = "") => { if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail && !cond ? " | " + String(detail).replace(/\s+/g, " ").slice(0, 300) : ""}`); };
const hq = (dir, args) => {
  try { return { ok: true, out: execFileSync("node", [HQ, ...args], { cwd: dir, env: { ...process.env, HQ_URL: URL }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { ok: false, out: (e.stdout ?? "") + (e.stderr ?? "") }; }
};
const T = Date.now();
const A = `${SMOKE}proj-a-${T}`, B = `${SMOKE}proj-b-${T}`;
if (![A, B].every((p) => p.startsWith(SMOKE))) throw new Error("smoke projects must start with smoke-");
const codeA = `hqj_smokeA_${randomBytes(9).toString("hex")}`, codeB = `hqj_smokeB_${randomBytes(9).toString("hex")}`;
const sha = (s) => createHash("sha256").update(s).digest("hex");
const UID = `${SMOKE}member-${T}`, EMAIL = `${SMOKE}member-${T}@example.com`;
const now = () => Timestamp.now();
const dirs = Object.fromEntries(["wA", "wA2", "oA", "wB", "oB", "x"].map((k) => [k, path.join(work, k)]));
Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));
const agentId = (k) => JSON.parse(fs.readFileSync(path.join(dirs[k], ".hq.json"), "utf8")).agent_id;
const PLAN = { tasks: [
  { key: "types", title: "Add smoke types", description: "Types.", acceptance: "- exported", priority: 10, size: "S", scope: ["src/types/smoke.ts"], depends_on: [] },
  { key: "server", title: "Smoke server logic", description: "Logic.", acceptance: "- works", priority: 20, size: "S", scope: ["src/lib/server/smoke.ts"], depends_on: ["types"] },
  { key: "api", title: "Add smoke API route", description: "Route.", acceptance: "- 200", priority: 30, size: "S", scope: ["src/app/api/smoke/"], depends_on: ["server"] },
  { key: "ui", title: "Smoke card component", description: "UI.", acceptance: "- renders", priority: 30, size: "S", scope: ["src/components/smoke/card.tsx"], depends_on: ["types"] },
  { key: "page", title: "Smoke page", description: "Page.", acceptance: "- renders", priority: 40, size: "S", scope: ["src/app/smoke/"], depends_on: ["api", "ui"] },
] };

const task = (pid, id, mid, status, extra = {}) => db.doc(`tasks/${id}`).set({
  project_id: pid, mission_id: mid, title: id, description: "smoke", acceptance: "- x", priority: -1000, size: "S",
  scope: ["src/components/smoke-shared/"], depends_on: [], status, agent_id: null, attempt_id: null, lease_expires_at: null,
  branch: null, pr_url: null, head_sha: null, checks: null, review: null, result_summary: null, orchestrator_request: null,
  created_by: "smoke@example.com", claimed_at: null, completed_at: null, created_at: now(), updated_at: now(), ...extra,
});
const mission = (pid, id, status, claimedBy = null) => db.doc(`missions/${id}`).set({
  project_id: pid, title: id, goal: "smoke goal", status, created_by: "smoke@example.com", created_at: now(),
  plan_source: "orchestrator", plan_requested_at: now(), plan_claimed_by: claimedBy?.id ?? null,
  plan_claimed_by_name: claimedBy?.name ?? null, plan_claimed_at: claimedBy ? now() : null,
  source_doc_id: null, source_doc_url: null, plan_doc_url: null, handoff_doc_url: null,
});
const dash = async (tok, method, p, body, project) => {
  const r = await fetch(URL + p, { method, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", ...(project ? { "x-project-id": project } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

await sweep(admin, { write: true });
try {
  // ---------- projects, membership, tasks ----------
  for (const [id, code] of [[A, codeA], [B, codeB]]) {
    await db.doc(`projects/${id}`).set({ name: id, repo_url: "https://github.com/example/smoke", default_branch: "main", join_code_hash: sha(code), created_by: "smoke@example.com", created_at: now() });
    await db.doc(`scopeRegistries/${id}`).set({ project_id: id, locks: {}, updated_at: now() });
  }
  await db.doc(`projectMembers/${A}_${EMAIL}`).set({ project_id: A, email: EMAIL, name: "Smoke Member", role: "member", color: null, added_by: "smoke", created_at: now() });
  const [mA2, mB2] = [`${SMOKE}mA2-${T}`, `${SMOKE}mB2-${T}`];
  await mission(A, mA2, "running"); await mission(B, mB2, "running");
  await task(A, `${SMOKE}tA-${T}`, mA2, "queued"); await task(B, `${SMOKE}tB-${T}`, mB2, "queued");
  await task(A, `${SMOKE}draftA-${T}`, mA2, "draft", { priority: 5000, scope: ["src/components/smoke-a-only/"] });
  await task(B, `${SMOKE}draftB-${T}`, mB2, "draft", { priority: 5000, scope: ["src/components/smoke-b-only/"] });
  await task(A, `${SMOKE}doneA-${T}`, mA2, "done", { completed_at: now(), result_summary: "A done", scope: ["src/components/smoke-a-done/"] });
  await task(B, `${SMOKE}doneB-${T}`, mB2, "done", { completed_at: now(), result_summary: "B done", scope: ["src/components/smoke-b-done/"] });

  // ---------- agents: each project's own join code ----------
  const join = (k, code, name, role, extra = []) => hq(dirs[k], ["join", "--code", code, "--participant", `${SMOKE}${k}`, "--name", name, "--role", role, "--tool", "claude", ...extra]);
  const jA = join("wA", codeA, `${SMOKE}wA`, "worker"); check("join with A's code -> project A", jA.ok && jA.out.includes(A), jA.out);
  join("wA2", codeA, `${SMOKE}wA2`, "worker"); join("oA", codeA, `${SMOKE}oA`, "orchestrator");
  const jB = join("wB", codeB, `${SMOKE}wB`, "worker"); check("join with B's code -> project B", jB.ok && jB.out.includes(B), jB.out);
  join("oB", codeB, `${SMOKE}oB`, "orchestrator");
  check(".hq.json stores project_id", JSON.parse(fs.readFileSync(path.join(dirs.wA, ".hq.json"), "utf8")).project_id === A);
  const bad = hq(dirs.x, ["join", "--code", "hqj_not_a_real_code", "--participant", `${SMOKE}x`, "--name", `${SMOKE}x`]);
  check("unknown join code -> 403", !bad.ok && /Wrong join code/.test(bad.out), bad.out);
  const notMember = join("x", codeB, `${SMOKE}xB`, "worker", ["--email", EMAIL]); check("--email not a member of B -> 403", !notMember.ok && /isn't a member/.test(notMember.out), notMember.out);
  const linked = hq(dirs.x, ["join", "--code", codeA, "--participant", `${SMOKE}member`, "--name", `${SMOKE}linked`, "--email", EMAIL]);
  const linkedP = (await db.collection("participants").where("project_id", "==", A).where("email", "==", EMAIL).get()).docs[0];
  check("--email member of A -> participant linked by email", linked.ok && linkedP?.get("name") === `${SMOKE}member`, linked.out);

  // Plan requests are created already claimed by their own project's smoke orchestrator.
  const [mA, mB] = [`${SMOKE}mA-${T}`, `${SMOKE}mB-${T}`];
  await mission(A, mA, "planning", { id: agentId("oA"), name: `${SMOKE}oA` });
  await mission(B, mB, "planning", { id: agentId("oB"), name: `${SMOKE}oB` });

  // ---------- claims ----------
  const cA = hq(dirs.wA, ["claim", "--json"]); const rA = cA.ok ? JSON.parse(cA.out) : {};
  check("worker A claims A's task", rA.task?.id === `${SMOKE}tA-${T}`, cA.out);
  check("briefing shows A's done task, never B's", (rA.since_last_claim ?? []).some((c) => c.id === `${SMOKE}doneA-${T}`) && !(rA.since_last_claim ?? []).some((c) => c.id === `${SMOKE}doneB-${T}`), JSON.stringify(rA.since_last_claim));
  const cB = hq(dirs.wB, ["claim", "--json"]); const rB = cB.ok ? JSON.parse(cB.out) : {};
  check("worker B claims B's task with the SAME scope (locks are per project)", rB.task?.id === `${SMOKE}tB-${T}`, cB.out);
  const cross = hq(dirs.wA2, ["claim", "--json", "--mission", mB2]); const rX = cross.ok ? JSON.parse(cross.out) : {};
  check("claim --mission <B's mission> from A -> NO_TASK", cross.ok && rX.task === null, cross.out);
  const regA = (await db.doc(`scopeRegistries/${A}`).get()).get("locks") ?? {}, regB = (await db.doc(`scopeRegistries/${B}`).get()).get("locks") ?? {};
  check("each lock lives in its own project's registry", regA[`${SMOKE}tA-${T}`] && !regA[`${SMOKE}tB-${T}`] && regB[`${SMOKE}tB-${T}`] && !regB[`${SMOKE}tA-${T}`]);

  // ---------- messages ----------
  const m1 = hq(dirs.wA, ["msg", `${SMOKE}wB`, "hello from A"]); check("message to B's agent by name -> not found", !m1.ok && /404|No agent/.test(m1.out), m1.out);
  const m2 = hq(dirs.wA, ["msg", `${SMOKE}tB-${T}`, "hello task"]); check("message to B's task -> not found", !m2.ok && /404|not found|No agent/i.test(m2.out), m2.out);
  check("message within A works", hq(dirs.oA, ["msg", `${SMOKE}wA`, "hello teammate"]).ok);

  // ---------- orchestrator requests ----------
  const pA = hq(dirs.oA, ["plan-requests", "--json"]); const reqA = pA.ok ? JSON.parse(pA.out) : null;
  const pB = hq(dirs.oB, ["plan-requests", "--json"]); const reqB = pB.ok ? JSON.parse(pB.out) : null;
  check("each orchestrator gets only its own project's plan request", reqA?.mission_id === mA && reqB?.mission_id === mB, pA.out + pB.out);
  const planFile = path.join(work, "plan.json"); fs.writeFileSync(planFile, JSON.stringify(PLAN));
  const xPlan = hq(dirs.oA, ["tasks", "add", "--mission", mB, planFile]); check("A's orchestrator can't submit a plan for B's mission", !xPlan.ok && /not found/i.test(xPlan.out), xPlan.out);
  const verdictFile = path.join(work, "verdict.json"); fs.writeFileSync(verdictFile, JSON.stringify({ sha: "abcdef1234", verdict: "pass", notes: "x", evidence: ["x"] }));
  const xV = hq(dirs.oA, ["verdict", `${SMOKE}tB-${T}`, verdictFile]); check("A's orchestrator verdict on B's task -> 404", !xV.ok && /404/.test(xV.out), xV.out);
  const xR = hq(dirs.oA, ["recovery", `${SMOKE}tB-${T}`, verdictFile]); check("A's orchestrator recovery on B's task -> 404", !xR.ok && /404/.test(xR.out), xR.out);
  const okPlan = hq(dirs.oA, ["tasks", "add", "--mission", mA, planFile]); check("A's orchestrator submits A's plan (request closed)", okPlan.ok && (await db.doc(`missions/${mA}`).get()).get("status") === "awaiting_approval", okPlan.out);

  // ---------- dashboard (member of A only) ----------
  await auth.createUser({ uid: UID, email: EMAIL, emailVerified: true, displayName: "Smoke Member" });
  const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${env.NEXT_PUBLIC_FIREBASE_API_KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: await auth.createCustomToken(UID), returnSecureToken: true }) });
  const tok = (await signIn.json()).idToken;
  const me = await dash(tok, "GET", "/api/me");
  check("/api/me lists A only, no join_code_hash; can't create projects", me.status === 200 && me.body.projects?.length === 1 && me.body.projects[0].project.id === A && me.body.projects[0].project.join_code_hash === undefined && me.body.can_create_projects === false, JSON.stringify(me));
  check("non-global-owner can't create a project", (await dash(tok, "POST", "/api/projects", { name: `${SMOKE}nope`, repo_url: "https://github.com/example/x" })).status === 403);
  check("approve with X-Project-Id B (not a member) -> 403", (await dash(tok, "POST", "/api/tasks/approve", { ids: [`${SMOKE}draftB-${T}`] }, B)).status === 403);
  check("approve B's draft from project A -> 404", (await dash(tok, "POST", "/api/tasks/approve", { ids: [`${SMOKE}draftB-${T}`] }, A)).status === 404);
  check("approve A's draft in A works", (await dash(tok, "POST", "/api/tasks/approve", { ids: [`${SMOKE}draftA-${T}`] }, A)).status === 200);
  check("mark B's task done from A -> 404", (await dash(tok, "POST", `/api/tasks/${SMOKE}tB-${T}/done`, {}, A)).status === 404);
  check("member (not owner) can't rotate the join code", (await dash(tok, "POST", `/api/projects/${A}/join-code`)).status === 403);
} catch (e) {
  failed++;
  console.log(`FAIL crashed: ${e instanceof Error ? e.stack : e}`);
} finally {
  const left = await sweep(admin, { write: true, log: () => {} });
  const after = await sweep(admin, { write: false, log: () => {} });
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`cleanup: swept ${left} smoke docs/users; left after sweep: ${after}; ${failed} failed`);
  process.exit(failed || after ? 1 : 0);
}
