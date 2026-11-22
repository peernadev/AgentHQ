import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// Server-only Firebase Admin client (bypasses firestore.rules). Never import from client components.
let db: Firestore | null = null;

export function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_B64");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  return initializeApp({ credential: cert(sa), projectId: sa.project_id });
}

export function getDb(): Firestore {
  // No db.settings(): it throws if called twice, which happens on dev hot reload.
  db ??= getFirestore(getAdminApp());
  return db;
}

export const col = {
  participants: () => getDb().collection("participants"),
  agents: () => getDb().collection("agents"),
  agentTokens: () => getDb().collection("agentTokens"),
  tasks: () => getDb().collection("tasks"),
  missions: () => getDb().collection("missions"),
  events: () => getDb().collection("events"),
  scopeRegistry: () => getDb().collection("meta").doc("scopeRegistry"),
};
