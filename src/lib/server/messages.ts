import "server-only";
import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import type { Message, WithInbox } from "@/types/api";
import { col, getDb } from "./firebase-admin";
import { fromDoc } from "./serialize";

const MAX_INBOX = 50;
const ms = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : 0);

/**
 * Takes this agent's unread messages (oldest first, up to 50) and marks them read in one
 * transaction, so two concurrent calls never deliver the same message twice.
 * Equality-only query: no composite index needed.
 */
export async function takeInbox(agentId: string): Promise<Message[]> {
  return getDb().runTransaction(async (tx) => {
    const snap = await tx.get(col.messages().where("to_agent", "==", agentId).where("read_at", "==", null));
    const docs = snap.docs.sort((a, b) => ms(a.get("created_at")) - ms(b.get("created_at"))).slice(0, MAX_INBOX);
    const now = Timestamp.now();
    for (const d of docs) tx.update(d.ref, { read_at: now });
    return docs.map((d) => ({ ...fromDoc<Message>(d), read_at: now.toDate().toISOString() }));
  });
}

/**
 * Success response for an agent route: `body` plus the agent's inbox. Call it only on the
 * success path (errors are thrown before it), so a failed call never swallows messages.
 */
export async function agentJson<T extends object>(agentId: string, body: T): Promise<NextResponse> {
  const inbox = await takeInbox(agentId);
  return NextResponse.json<WithInbox<T>>(inbox.length ? { ...body, inbox } : body);
}
