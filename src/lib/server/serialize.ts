import "server-only";
import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";

// Firestore stores Timestamps; the API contract (src/types/api.ts) uses ISO strings.

/** Converts Timestamps (also nested) to ISO strings. */
export function toIso(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(toIso);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toIso(x)]));
  }
  return v;
}

/** Document -> API object: `{ id, ...fields }` with Timestamps as ISO strings. */
export function fromDoc<T>(snap: DocumentSnapshot): T {
  return { id: snap.id, ...(toIso(snap.data()) as object) } as T;
}
