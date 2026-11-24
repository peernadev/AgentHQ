import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import type { CreateProjectResponse } from "@/types/api";
import { hashToken } from "@/lib/server/auth";
import { col, getDb } from "@/lib/server/firebase-admin";
import { HttpError, handle, optStr, readBody, str } from "@/lib/server/http";
import { BRANCH, newJoinCode, projectIdFor, REPO_URL, toProject } from "@/lib/server/projects";
import { addEvent } from "@/lib/server/tasks";
import { projectCreators, requireUser } from "@/lib/server/team-auth";

// POST /api/projects { name, repo_url, default_branch? }: create a project. Allowed for global
// owners (TEAM_EMAILS), or any signed-in user when PROJECT_CREATORS=anyone. The creator becomes
// its owner. Returns the join code once; only its sha256 is stored.
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req);
  if (!user.globalOwner && projectCreators() !== "anyone") throw new HttpError(403, "Only global owners can create projects");
  const body = await readBody(req);
  const name = str(body, "name", { max: 80 });
  const repoUrl = str(body, "repo_url", { max: 200 }).replace(/\/+$/, "");
  const branch = optStr(body, "default_branch", { max: 100 }) ?? "main";
  if (!REPO_URL.test(repoUrl)) throw new HttpError(400, `"repo_url" must be https://github.com/<owner>/<repo>`);
  if (!BRANCH.test(branch)) throw new HttpError(400, `"default_branch" is not a valid branch name`);

  const id = projectIdFor(name);
  const joinCode = newJoinCode();
  const now = Timestamp.now();
  await getDb().runTransaction(async (tx) => {
    tx.create(col.projects().doc(id), {
      name, repo_url: repoUrl, default_branch: branch, join_code_hash: hashToken(joinCode), created_by: user.email, created_at: now,
    });
    tx.create(col.memberDoc(id, user.email), {
      project_id: id, email: user.email, name: user.name ?? user.email.split("@")[0], role: "owner", color: null, added_by: user.email, created_at: now,
    });
    tx.create(col.scopeRegistry(id), { project_id: id, locks: {}, updated_at: now });
    addEvent(tx, { project_id: id, type: "project_created", message: `Project ${name} created`, data: { by: user.email, repo_url: repoUrl } }, now);
  });
  return NextResponse.json<CreateProjectResponse>({ project: toProject(await col.projects().doc(id).get()), join_code: joinCode });
});
