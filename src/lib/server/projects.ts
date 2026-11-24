import "server-only";
import { randomBytes } from "node:crypto";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import type { Project } from "@/types/api";
import { fromDoc } from "./serialize";

/** A new project join code: high-entropy, URL-safe, recognizable. Only its sha256 is stored. */
export function newJoinCode(): string {
  return `hqj_${randomBytes(18).toString("base64url")}`;
}

/** A readable, unique project id: "my-app-7f3k". */
export function projectIdFor(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";
  return `${slug}-${randomBytes(3).toString("hex")}`;
}

/** API shape of a project: never includes join_code_hash. */
export function toProject(snap: DocumentSnapshot): Project {
  const { id, name, repo_url, default_branch, created_by, created_at } = fromDoc<Project & { join_code_hash?: string }>(snap);
  return { id, name, repo_url, default_branch, created_by, created_at };
}

export const REPO_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/;
export const BRANCH = /^[A-Za-z0-9._/-]{1,100}$/;
