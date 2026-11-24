import "server-only";
import { getAuth } from "firebase-admin/auth";
import type { ProjectCreators, ProjectRole } from "@/types/api";
import { col, getAdminApp } from "./firebase-admin";
import { HttpError } from "./http";

export interface SignedInUser { uid: string; email: string; name: string | null; globalOwner: boolean }
export interface ProjectUser extends SignedInUser { projectId: string; role: ProjectRole }

/** TEAM_EMAILS (comma-separated): global owners of every project, so the team can't lock itself out. */
export function globalOwners(): Set<string> {
  return new Set((process.env.TEAM_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
}

/** PROJECT_CREATORS: "global_owners" (default, only TEAM_EMAILS) or "anyone" (any signed-in user). */
export function projectCreators(): ProjectCreators {
  return process.env.PROJECT_CREATORS?.trim().toLowerCase() === "anyone" ? "anyone" : "global_owners";
}

const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Any dashboard route: `Authorization: Bearer <Firebase ID token>` with a verified Google email.
 * 401 / 403 otherwise. Says nothing about projects; see requireProjectMember.
 */
export async function requireUser(req: Request): Promise<SignedInUser> {
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
  return { uid: decoded.uid, email, name: (decoded.name as string | undefined) ?? null, globalOwner: globalOwners().has(email) };
}

/**
 * Project routes: the signed-in user must be a member of the project in `X-Project-Id` (or a global
 * owner, who is an owner of every project). Without the header, the user's only project is used
 * (one membership, or one project in total for a global owner); otherwise 400. `projectId` (from a
 * route path) overrides the header. `owner: true`
 * also requires the owner role (403 otherwise).
 */
export async function requireProjectMember(req: Request, opts: { owner?: boolean; projectId?: string } = {}): Promise<ProjectUser> {
  const user = await requireUser(req);
  // A route with the project in its path passes it; it wins over the header.
  let projectId = opts.projectId ?? (req.headers.get("x-project-id")?.trim() || null);
  if (projectId && !PROJECT_ID.test(projectId)) throw new HttpError(400, "Invalid X-Project-Id");
  if (!projectId) {
    const ids = user.globalOwner
      ? (await col.projects().select().get()).docs.map((d) => d.id)
      : (await col.projectMembers().where("email", "==", user.email).get()).docs.map((d) => d.get("project_id") as string);
    if (ids.length !== 1) throw new HttpError(400, ids.length ? "Select a project (X-Project-Id)" : "You're not a member of any project yet");
    projectId = ids[0];
  }
  const [project, member] = await Promise.all([col.projects().doc(projectId).get(), col.memberDoc(projectId, user.email).get()]);
  if (!project.exists) throw new HttpError(404, "Project not found");
  const role: ProjectRole | null = user.globalOwner ? "owner" : member.exists ? (member.get("role") as ProjectRole) : null;
  if (!role) throw new HttpError(403, "You're not a member of this project");
  if (opts.owner && role !== "owner") throw new HttpError(403, "Only project owners can do this");
  return { ...user, projectId, role };
}

/** A document the route is about to act on must belong to the caller's project; 404 otherwise (no leak). */
export function assertInProject(doc: FirebaseFirestore.DocumentSnapshot, projectId: string, what = "Not found"): void {
  if (!doc.exists || doc.get("project_id") !== projectId) throw new HttpError(404, what);
}
