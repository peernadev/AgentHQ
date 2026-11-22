import "server-only";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp } from "./firebase-admin";
import { HttpError } from "./http";

export interface TeamUser { uid: string; email: string }

function teamEmails(): Set<string> {
  const raw = process.env.TEAM_EMAILS;
  if (!raw?.trim()) throw new HttpError(500, "TEAM_EMAILS is not configured");
  return new Set(raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
}

/**
 * Dashboard routes: `Authorization: Bearer <Firebase ID token>`. The token must verify and
 * belong to a verified email listed in TEAM_EMAILS (comma-separated). 401 / 403 otherwise.
 */
export async function requireTeamUser(req: Request): Promise<TeamUser> {
  const allowed = teamEmails();
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!match) throw new HttpError(401, "Missing bearer token (Firebase ID token)");

  let decoded;
  try {
    decoded = await getAuth(getAdminApp()).verifyIdToken(match[1]);
  } catch {
    throw new HttpError(401, "Invalid or expired ID token");
  }
  const email = decoded.email?.toLowerCase();
  if (!email || !decoded.email_verified) throw new HttpError(403, "Sign in with a verified Google email");
  if (!allowed.has(email)) throw new HttpError(403, "This account is not on the team");
  return { uid: decoded.uid, email };
}
