#!/usr/bin/env node
// Generates src/lib/server/google/repo-context.json for the Gemini planner:
// the repo file tree, AGENTS.md's Ownership section and prompts/planner.md.
// Walks the filesystem (Vercel builds may have no .git). Plain Node, no dependencies.
// Runs from package.json hooks: postinstall, predev, prebuild.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "src/lib/server/google/repo-context.json";
const MAX_FILES = 3000;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".vercel", ".claude", "out", "build", "coverage", ".turbo"]);
const SKIP_FILE = [/^\.git$/, /^\.env/, /^\.hq\.json$/, /\.pem$/, /\.tsbuildinfo$/, /^next-env\.d\.ts$/, /adminsdk.*\.json$/i, /service[-_]?account.*\.json$/i];

const files = [];
let truncated = false;
function walk(rel) {
  let entries;
  try {
    entries = readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p);
    } else if (e.isFile() && p !== OUT && !SKIP_FILE.some((r) => r.test(e.name))) {
      if (files.length >= MAX_FILES) { truncated = true; return; }
      files.push(p);
    }
  }
}
walk("");

const read = (f) => (existsSync(path.join(root, f)) ? readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n") : "");
const ownership = read("AGENTS.md").match(/^## Ownership[^\n]*\n[\s\S]*?(?=^## )/m)?.[0].trim() ?? "";
const plannerPrompt = read("prompts/planner.md").trim();

mkdirSync(path.join(root, path.dirname(OUT)), { recursive: true });
writeFileSync(path.join(root, OUT), JSON.stringify({
  generated_at: new Date().toISOString(), truncated, files, ownership, planner_prompt: plannerPrompt,
}) + "\n");
console.log(`repo-context: ${files.length} files${truncated ? " (truncated)" : ""}, ownership ${ownership ? "ok" : "MISSING"}, planner prompt ${plannerPrompt ? "ok" : "MISSING"}`);
