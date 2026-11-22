import "server-only";
import { HttpError } from "../http";

// Public GitHub REST API: the PR's head SHA and changed files, for the Gemini reviewer.
// Optional GITHUB_TOKEN (read-only) only raises the rate limit; it is never required.

const API = "https://api.github.com";
const PR_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)\/?(?:[?#].*)?$/;
const MAX_FILES = 300; // 3 pages; the summary below keeps far less
const TIMEOUT_MS = 10_000;

export interface PrFile { filename: string; status: string; additions: number; deletions: number; patch?: string }
export interface PrInfo { owner: string; repo: string; number: number; head_sha: string; title: string; files: PrFile[] }

export function parsePrUrl(url: string): { owner: string; repo: string; number: number } {
  const m = PR_URL.exec(url.trim());
  if (!m) throw new HttpError(400, `pr_url is not a GitHub pull request URL: ${url}`);
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

async function gh<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "agenthq-reviewer",
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let res: Response;
  try {
    res = await fetch(API + path, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new HttpError(502, "GitHub didn't answer; try again");
  }
  if (res.status === 404) throw new HttpError(404, "PR not found on GitHub (the repo must be public, or set GITHUB_TOKEN)");
  if (res.status === 403 || res.status === 429) {
    throw new HttpError(503, "GitHub rate limit reached; try again later (or set GITHUB_TOKEN)");
  }
  if (!res.ok) throw new HttpError(502, `GitHub API error ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchPr(url: string): Promise<PrInfo> {
  const { owner, repo, number } = parsePrUrl(url);
  const base = `/repos/${owner}/${repo}/pulls/${number}`;
  const pr = await gh<{ title: string; head: { sha: string } }>(base);
  const files: PrFile[] = [];
  for (let page = 1; files.length < MAX_FILES; page++) {
    const batch = await gh<PrFile[]>(`${base}/files?per_page=100&page=${page}`);
    files.push(...batch.map(({ filename, status, additions, deletions, patch }) => ({ filename, status, additions, deletions, patch })));
    if (batch.length < 100) break;
  }
  return { owner, repo, number, head_sha: pr.head.sha.toLowerCase(), title: pr.title, files };
}

/** Diff summary for the prompt: every file's stats, then patches until the size budget runs out. */
export function diffSummary(files: PrFile[], { maxFiles = 40, maxChars = 40_000, maxPatch = 4_000 } = {}): string {
  const stats = files.map((f) => `${f.status.padEnd(8)} +${f.additions} -${f.deletions}  ${f.filename}`).join("\n");
  let budget = maxChars - stats.length;
  const patches: string[] = [];
  for (const f of files.slice(0, maxFiles)) {
    if (!f.patch || budget <= 0) continue;
    const p = f.patch.length > maxPatch ? `${f.patch.slice(0, maxPatch)}\n... (patch truncated)` : f.patch;
    patches.push(`--- ${f.filename}\n${p.slice(0, budget)}`);
    budget -= p.length;
  }
  const skipped = files.length - patches.length;
  return `Files (${files.length}):\n${stats}\n\nPatches${skipped ? ` (${skipped} file(s) without a patch shown)` : ""}:\n${patches.join("\n\n")}`;
}
