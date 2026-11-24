// Checks on Gemini planner output that parseTaskBatch doesn't do (SPEC §7). Pure functions with
// no imports, so they can be tested directly with Node.

export interface PlanTask { id: string; title: string; scope: string[]; depends_on: string[] }

const overlap = (a: string[], b: string[]) => a.some((x) => b.some((y) => x.startsWith(y) || y.startsWith(x)));

/**
 * Real paths: a scope must exist in the repo tree, or be new at most one level below what exists:
 * - a new folder inside an existing folder (src/components/leaderboard/);
 * - a new file inside an existing folder (src/app/signup.tsx), or inside one new feature folder
 *   in an existing folder (src/app/api/signup/route.ts), which is what the conventions ask for.
 * Anything deeper, and new top-level folders, are rejected (that's where invented paths show up).
 */
export function checkRealPaths(tasks: PlanTask[], files: string[]): string[] {
  const exists = (p: string) => {
    const dir = p.replace(/\/+$/, "");
    return files.includes(dir) || files.some((f) => f.startsWith(dir + "/"));
  };
  const up = (p: string, n: number) => p.replace(/\/+$/, "").split("/").slice(0, -n).join("/");
  const errors: string[] = [];
  for (const t of tasks) {
    for (const s of t.scope) {
      if (exists(s)) continue;
      const isFolder = s.endsWith("/");
      const parent = up(s, 1);
      const grandparent = up(s, 2);
      const ok = (parent && exists(parent)) || (!isFolder && grandparent && exists(grandparent));
      if (!ok) {
        errors.push(isFolder
          ? `"${t.title}": scope "${s}" is not in the repo and its parent folder doesn't exist`
          : `"${t.title}": scope "${s}" is not in the repo, and neither its folder nor that folder's parent exists`);
      }
    }
  }
  return errors;
}

export const MIN_PLAN_TASKS = 5;
export const MIN_FOLDER_SEGMENTS = 3;

/** A feature-sized goal needs a real breakdown, not 2-3 giant tasks. */
export function checkTaskCount(tasks: PlanTask[], min = MIN_PLAN_TASKS): string[] {
  return tasks.length >= min ? [] : [
    `The plan has ${tasks.length} tasks; it needs at least ${min}. Split the work: a contract task first, then UI and API tasks in parallel, then integration.`,
  ];
}

/**
 * Narrow scopes: a folder must be at least 3 path segments deep (src/components/leaderboard/,
 * not src/components/). Files can be at any depth (package.json, src/types/api.ts). A scope is a
 * folder if it ends with "/" or names a folder in the repo tree (a bare "src/components" counts).
 */
export function checkNarrowScopes(tasks: PlanTask[], files: string[], min = MIN_FOLDER_SEGMENTS): string[] {
  const errors: string[] = [];
  for (const t of tasks) {
    for (const s of t.scope) {
      const bare = s.replace(/\/+$/, "");
      const isFolder = s.endsWith("/") || files.some((f) => f.startsWith(bare + "/"));
      const depth = bare.split("/").filter(Boolean).length;
      if (isFolder && depth < min) {
        errors.push(`"${t.title}": scope "${s}" is too broad (a whole ${depth}-segment folder). Use a feature folder at least ${min} segments deep, like "src/components/<feature>/", or specific files.`);
      }
    }
  }
  return errors;
}

// Standalone words only: not inside other words ("rapid"), and not as part of a path or file name
// ("api.ts", "src/types/api.ts", "app/api/x/route.ts"), which name files, not API work.
const API_WORDS = /(?<![\w./-])(api|apis|endpoints?|routes?)(?![\w/-]|\.\w)/i;
/** Contract scopes: shared types only. A task touching nothing else is a contract task, not API work. */
const isContractScope = (s: string) => s.startsWith("src/types/") || s.endsWith(".d.ts");

/** Route location: a task whose title mentions an API, endpoint or route must edit something under src/app/api/. */
export function checkApiRouteLocation(tasks: PlanTask[]): string[] {
  return tasks
    .filter((t) => API_WORDS.test(t.title) && !t.scope.every(isContractScope) && !t.scope.some((s) => s.startsWith("src/app/api/")))
    .map((t) => `"${t.title}" is API work but no scope is under src/app/api/. Put the route in src/app/api/<feature>/ (server logic can stay in src/lib/server/<feature>.ts as a second scope).`);
}

/** Parallel scopes: two tasks in the batch with overlapping scopes must be ordered by a depends_on chain. */
export function checkParallelOverlap(tasks: PlanTask[]): string[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const reach = new Map<string, Set<string>>();
  const reachable = (id: string, seen = new Set<string>()): Set<string> => {
    if (reach.has(id)) return reach.get(id)!;
    const out = new Set<string>();
    for (const d of byId.get(id)?.depends_on ?? []) {
      if (!byId.has(d) || seen.has(d)) continue;
      out.add(d);
      reachable(d, new Set([...seen, id])).forEach((x) => out.add(x));
    }
    reach.set(id, out);
    return out;
  };
  const errors: string[] = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const [a, b] = [tasks[i], tasks[j]];
      if (overlap(a.scope, b.scope) && !reachable(a.id).has(b.id) && !reachable(b.id).has(a.id)) {
        errors.push(`"${a.title}" and "${b.title}" have overlapping scopes but neither depends on the other`);
      }
    }
  }
  return errors;
}
