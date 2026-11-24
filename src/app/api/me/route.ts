import { NextResponse } from "next/server";
import type { MeResponse, ProjectRole } from "@/types/api";
import { col, getDb } from "@/lib/server/firebase-admin";
import { handle } from "@/lib/server/http";
import { toProject } from "@/lib/server/projects";
import { projectCreators, requireUser } from "@/lib/server/team-auth";

// GET /api/me: the signed-in user's projects and role in each, and whether they may create
// projects (PROJECT_CREATORS). Global owners (TEAM_EMAILS) see every project, as owner.
export const GET = handle(async (req: Request) => {
  const user = await requireUser(req);
  let projects: MeResponse["projects"];
  if (user.globalOwner) {
    const all = await col.projects().get();
    projects = all.docs.map((d) => ({ project: toProject(d), role: "owner" as ProjectRole }));
  } else {
    const memberships = await col.projectMembers().where("email", "==", user.email).get();
    const refs = memberships.docs.map((m) => col.projects().doc(String(m.get("project_id"))));
    const snaps = refs.length ? await getDb().getAll(...refs) : [];
    projects = snaps.filter((s) => s.exists).map((s) => ({
      project: toProject(s),
      role: memberships.docs.find((m) => m.get("project_id") === s.id)!.get("role") as ProjectRole,
    }));
  }
  projects.sort((a, b) => a.project.name.localeCompare(b.project.name));
  return NextResponse.json<MeResponse>({
    email: user.email, global_owner: user.globalOwner,
    can_create_projects: user.globalOwner || projectCreators() === "anyone",
    projects,
  });
});
