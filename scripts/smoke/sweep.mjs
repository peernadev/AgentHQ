#!/usr/bin/env node
// Deletes ALL smoke-test data from Firestore and Firebase Auth. Smoke data is anything in a project
// whose id starts with "smoke-", any doc whose id/title/name starts with "smoke-", and any doc
// requested or created by smoke@example.com. Open plan requests (planning missions) and task-level
// orchestrator requests go first, so no orchestrator can pick one up mid-sweep. Docs of real
// projects are only touched if they are themselves smoke-named. Dry run by default; --write applies.
//   node scripts/smoke/sweep.mjs [--write]
// Uses firebase-admin with FIREBASE_SERVICE_ACCOUNT_B64 from .env.local. Never prints secrets.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

export const SMOKE = "smoke-";
const COLLECTIONS = ["missions", "tasks", "events", "messages", "agents", "agentTokens", "participants", "outbox", "projectMembers", "scopeRegistries", "projects"];
const isSmokeValue = (v) => typeof v === "string" && (v.startsWith(SMOKE) || v === "smoke@example.com" || /^smoke-[\w-]*@example\.com$/.test(v));

export function adminFromEnv(root) {
  const env = Object.fromEntries(readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
  const sa = JSON.parse(Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_B64, "base64").toString("utf8"));
  const app = initializeApp({ credential: cert(sa), projectId: sa.project_id }, `smoke-${Date.now()}-${Math.random()}`);
  return { app, db: getFirestore(app), auth: getAuth(app), env };
}

/** Finds (and with write: deletes) every piece of smoke data. Returns the number of docs + users. */
export async function sweep({ db, auth }, { write = false, log = console.log } = {}) {
  const smokeProjects = new Set((await db.collection("projects").get()).docs.filter((d) => d.id.startsWith(SMOKE)).map((d) => d.id));
  const isSmokeDoc = (d) => smokeProjects.has(d.get("project_id")) || d.id.startsWith(SMOKE)
    || ["title", "name", "created_by", "requested_by", "email", "mission_id", "project_id"].some((k) => isSmokeValue(d.get(k)))
    || isSmokeValue(d.get("orchestrator_request")?.requested_by);
  const found = {};
  for (const c of COLLECTIONS) found[c] = (await db.collection(c).get()).docs.filter((d) => c === "projects" ? smokeProjects.has(d.id) : isSmokeDoc(d));
  const openRequests = [
    ...found.missions.filter((d) => d.get("status") === "planning"),
    ...found.tasks.filter((d) => d.get("orchestrator_request")),
  ];
  const users = (await auth.listUsers(1000)).users.filter((u) => u.uid.startsWith(SMOKE) || isSmokeValue(u.email));
  const total = Object.values(found).reduce((n, docs) => n + docs.length, 0);
  log(`smoke sweep ${write ? "(write)" : "(dry run)"}: ${smokeProjects.size} projects, ${openRequests.length} open requests, `
    + Object.entries(found).filter(([, d]) => d.length).map(([c, d]) => `${d.length} ${c}`).join(", ") + `, ${users.length} auth users`);
  if (!write) return total + users.length;
  // Close open requests first, then everything else in batches.
  for (const refs of [openRequests.map((d) => d.ref), Object.values(found).flat().map((d) => d.ref)]) {
    const uniq = [...new Map(refs.map((r) => [r.path, r])).values()];
    for (let i = 0; i < uniq.length; i += 400) { const b = db.batch(); uniq.slice(i, i + 400).forEach((r) => b.delete(r)); await b.commit(); }
  }
  for (const u of users) await auth.deleteUser(u.uid);
  return total + users.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const admin = adminFromEnv(root);
  await sweep(admin, { write: process.argv.includes("--write") });
  process.exit(0);
}
