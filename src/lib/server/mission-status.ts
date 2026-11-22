// Mission status derived from its tasks' statuses. Pure, no imports (testable with plain Node).
// cancelled tasks don't count; "planning" is never derived (it's only the pre-plan state).

type MissionStatus = "planning" | "awaiting_approval" | "running" | "reviewing" | "done";

export function deriveMissionStatus(statuses: string[], current: MissionStatus): MissionStatus {
  const live = statuses.filter((s) => s !== "cancelled");
  if (!live.length) return current;
  if (live.every((s) => s === "done")) return "done";
  if (live.some((s) => ["queued", "claimed", "in_progress", "failed"].includes(s))) return "running";
  if (live.some((s) => s === "in_review")) return "reviewing";
  if (live.some((s) => s === "draft")) return "awaiting_approval"; // only drafts (+ done) left: a human must approve
  return current;
}
