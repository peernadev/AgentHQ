// Checks on Gemini planner output that parseTaskBatch doesn't do (SPEC §7). Pure functions with
// no imports, so they can be tested directly with Node.

export interface PlanTask { id: string; title: string; scope: string[]; depends_on: string[] }

const overlap = (a: string[], b: string[]) => a.some((x) => b.some((y) => x.startsWith(y) || y.startsWith(x)));

/**
 * Real paths: a scope must exist in the repo tree, or be new inside a folder that exists.
 * New top-level folders are rejected (that's where invented paths usually show up).
 */
export function checkRealPaths(tasks: PlanTask[], files: string[]): string[] {
  const exists = (p: string) => {
    const dir = p.replace(/\/+$/, "");
    return files.includes(dir) || files.some((f) => f.startsWith(dir + "/"));
  };
  const errors: string[] = [];
  for (const t of tasks) {
    for (const s of t.scope) {
      const parent = s.replace(/\/+$/, "").split("/").slice(0, -1).join("/");
      if (!exists(s) && !(parent && exists(parent))) {
        errors.push(`"${t.title}": scope "${s}" is not in the repo and its parent folder doesn't exist`);
      }
    }
  }
  return errors;
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
