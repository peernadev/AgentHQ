#!/usr/bin/env node
// Tests for src/lib/server/google/plan-checks.ts (Gemini plan validation).
// Plain Node, no dependencies: `node scripts/test-plan-checks.mjs` (Node 22.18+ runs the .ts directly).
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { checkRealPaths, checkParallelOverlap, checkTaskCount, checkNarrowScopes } = await import(
  pathToFileURL(path.join(root, "src/lib/server/google/plan-checks.ts")).href
);

const files = ["package.json", "src/app/page.tsx", "src/components/ui/button.tsx", "src/types/api.ts", "cli/.gitkeep"];
const t = (id, scope, depends_on = []) => ({ id, title: id, scope, depends_on });
const many = (n) => Array.from({ length: n }, (_, i) => t(`t${i}`, [`src/components/f${i}/`]));
let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`PASS ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.message.split("\n")[0]}`); }
};

// real paths
ok("existing folder", () => assert.deepEqual(checkRealPaths([t("a", ["src/components/"])], files), []));
ok("existing file", () => assert.deepEqual(checkRealPaths([t("a", ["package.json"])], files), []));
ok("new folder inside existing one", () => assert.deepEqual(checkRealPaths([t("a", ["src/components/leaderboard/"])], files), []));
ok("new file inside existing folder", () => assert.deepEqual(checkRealPaths([t("a", ["src/app/signup.tsx"])], files), []));
ok("folder with only .gitkeep", () => assert.deepEqual(checkRealPaths([t("a", ["cli/hq.mjs"])], files), []));
ok("invented top-level folder rejected", () => assert.equal(checkRealPaths([t("a", ["frontend/"])], files).length, 1));
ok("invented nested parent rejected", () => assert.equal(checkRealPaths([t("a", ["src/features/auth/"])], files).length, 1));
ok("prefix trick 'src/comp' is not a folder", () => assert.equal(checkRealPaths([t("a", ["src/comp/x/"])], files).length, 1));

// parallel overlap
ok("disjoint scopes in parallel: fine", () => assert.deepEqual(checkParallelOverlap([t("a", ["src/a/"]), t("b", ["src/b/"])]), []));
ok("overlap without dependency: rejected", () => assert.equal(checkParallelOverlap([t("a", ["src/components/"]), t("b", ["src/components/x/"])]).length, 1));
ok("overlap with direct dependency: fine", () => assert.deepEqual(checkParallelOverlap([t("a", ["src/x/"]), t("b", ["src/x/"], ["a"])]), []));
ok("overlap with transitive dependency: fine", () => assert.deepEqual(
  checkParallelOverlap([t("a", ["src/x/"]), t("m", ["src/m/"], ["a"]), t("b", ["src/x/y.ts"], ["m"])]), []));
ok("overlap, both depend on a third: rejected", () => assert.equal(
  checkParallelOverlap([t("c", ["src/c/"]), t("a", ["src/x/"], ["c"]), t("b", ["src/x/"], ["c"])]).length, 1));
ok("dependency on existing (non-batch) id ignored safely", () => assert.equal(
  checkParallelOverlap([t("a", ["src/x/"], ["old-task"]), t("b", ["src/x/"], ["old-task"])]).length, 1));

// task count (at least 5)
ok("4 tasks rejected", () => assert.equal(checkTaskCount(many(4)).length, 1));
ok("5 tasks accepted", () => assert.deepEqual(checkTaskCount(many(5)), []));
ok("10 tasks accepted", () => assert.deepEqual(checkTaskCount(many(10)), []));
ok("count error tells Gemini how to fix it", () => assert.match(checkTaskCount(many(3))[0], /3 tasks.*at least 5.*contract task/));

// narrow scopes: folders >= 3 segments, files any depth, bare folder name counts as folder
ok("src/components/ rejected (2-segment folder)", () => assert.equal(checkNarrowScopes([t("a", ["src/components/"])], files).length, 1));
ok("src/ rejected (1-segment folder)", () => assert.equal(checkNarrowScopes([t("a", ["src/"])], files).length, 1));
ok("cli/ rejected (1-segment folder)", () => assert.equal(checkNarrowScopes([t("a", ["cli/"])], files).length, 1));
ok("bare 'src/components' counts as a folder: rejected", () => assert.equal(checkNarrowScopes([t("a", ["src/components"])], files).length, 1));
ok("src/components/leaderboard/ accepted (3 segments)", () => assert.deepEqual(checkNarrowScopes([t("a", ["src/components/leaderboard/"])], files), []));
ok("src/app/api/leaderboard/ accepted", () => assert.deepEqual(checkNarrowScopes([t("a", ["src/app/api/leaderboard/"])], files), []));
ok("package.json accepted (root file)", () => assert.deepEqual(checkNarrowScopes([t("a", ["package.json"])], files), []));
ok("src/types/api.ts accepted (file)", () => assert.deepEqual(checkNarrowScopes([t("a", ["src/types/api.ts"])], files), []));
ok("cli/hq.mjs accepted (file in 1-segment folder)", () => assert.deepEqual(checkNarrowScopes([t("a", ["cli/hq.mjs"])], files), []));
ok("new file not in tree, no slash: treated as file", () => assert.deepEqual(checkNarrowScopes([t("a", ["src/app/signup.tsx"])], files), []));
ok("only the broad scope of a task is reported", () => assert.equal(
  checkNarrowScopes([t("a", ["src/app/page.tsx", "src/components/"])], files).length, 1));
ok("depth error names the scope and the fix", () => assert.match(
  checkNarrowScopes([t("a", ["src/components/"])], files)[0], /"src\/components\/" is too broad.*src\/components\/<feature>\//));

console.log(`== ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
