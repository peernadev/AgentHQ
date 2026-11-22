import { TASK_POINTS, type Agent, type HqEvent, type Mission, type Participant, type Task, type TaskSize, type TaskStatus } from "@/types/api";

// Fixture associations live outside shared API rows, including idle/offline workers.
export const mockMissionAgents: Record<string, string[]> = { build: ["a1", "a2", "a3", "a4", "a5", "a6"] };
export interface MissionSnapshot {
  participants: Participant[];
  agents: Agent[];
  tasks: Task[];
  events: HqEvent[];
  missions: Mission[];
}

export const taskPoints = TASK_POINTS;

export function createMissionSnapshot(now = Date.now()): MissionSnapshot {
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();
  const participants: Participant[] = [
    { id: "p1", name: "Eran", email: null, color: "indigo", points: 4, tasks_done: 0, created_at: ago(3600) },
    { id: "p2", name: "Maya", email: null, color: "teal", points: 3, tasks_done: 1, created_at: ago(3600) },
    { id: "p3", name: "Omer", email: null, color: "amber", points: 1, tasks_done: 0, created_at: ago(3600) },
  ];
  const task = (id: string, title: string, status: TaskStatus, size: TaskSize, scope: string[], agent_id: string | null, description: string, acceptance: string, priority: number): Task => ({
    id, title, status, size, scope, agent_id, description, acceptance, priority,
    mission_id: ["t10", "t11"].includes(id) ? "launch" : "build",
    attempt_id: agent_id ? `mock-attempt-${id}` : null,
    lease_expires_at: agent_id && status !== "done" ? ago(-600) : null,
    head_sha: null, checks: null, review: null,
    depends_on: [], branch: agent_id ? `codex/${id}` : null,
    pr_url: null, result_summary: null, created_by: "orchestrator",
    claimed_at: agent_id ? ago(700) : null, completed_at: status === "done" ? ago(600) : null,
    created_at: ago(1800), updated_at: ago(90),
  });
  const tasks = [
    task("t1", "Build the signup flow", "in_progress", "M", ["src/components/signup/"], "a1", "Connect the landing page signup form to a clear success state with accessible validation.", "Email errors are announced. Success state works at 375px. No shared layout changes.", 1),
    task("t2", "Ship the leaderboard", "in_progress", "M", ["src/components/leaderboard/"], "a3", "Build a ranked team list with readable scores and an intentional empty state.", "Scores sort descending. Ties preserve names. Keyboard focus stays visible.", 2),
    task("t3", "Wire the invite endpoint", "claimed", "S", ["src/app/api/invites/"], "a5", "Add invite creation with validation against the agreed request contract.", "Valid requests return an invite. Invalid email returns a useful error.", 3),
    task("t4", "Review the landing page", "in_review", "M", ["src/components/landing/"], "a2", "Deliver the landing page headline, product explanation, and primary signup action.", "Primary action reaches signup. Content wraps on mobile. Build and lint pass.", 4),
    task("t5", "Define shared API contracts", "done", "S", ["src/types/landing.ts"], "a4", "Publish the minimal shared contract for signup, invites, and leaderboard rows.", "Types cover successful and failed responses. Consumers agree on field names.", 5),
    task("t6", "Add form interaction tests", "queued", "M", ["src/components/signup/__tests__/"], null, "Cover the signup success path and invalid email recovery.", "Tests assert visible user behavior and keyboard submission.", 6),
    task("t7", "Create the welcome email", "draft", "S", ["src/emails/welcome/"], null, "Draft a compact welcome email with one action to return to the team.", "Plain-text alternative exists. Links use the configured app URL.", 7),
    task("t8", "Add leaderboard loading state", "draft", "S", ["src/components/leaderboard/loading/"], null, "Keep the leaderboard layout stable while its rows are loading.", "Loading is announced. Placeholder layout matches the final table.", 8),
    task("t9", "Write the demo walkthrough", "draft", "M", ["docs/demo/"], null, "Document the three-minute path from signup to the first team score.", "Steps include a reset path and a fallback for unavailable network access.", 9),
    task("t10", "Outline the launch checklist", "queued", "S", ["docs/launch/"], null, "Prepare a small checklist for the team’s first public launch.", "Checklist names an owner for every step and includes rollback.", 1),
    task("t11", "Draft the release notes", "draft", "S", ["docs/releases/"], null, "Explain what shipped and what the team should try first.", "Notes include signup and leaderboard changes with known limitations.", 2),
  ];
  tasks[3].pr_url = "https://github.com/peernadev/agenthq/pulls";
  tasks[3].result_summary = "Landing page is ready for human review; preview checks are still pending.";
  tasks[3].head_sha = "4f2e91a";
  tasks[3].checks = { lint: true, typecheck: true, build: false };
  tasks[3].review = { verdict: "needs_human", notes: "Sample review: acceptance criteria appear covered. The build is not passing; verify the signup action and resolve checks before merging.", sha: "4f2e91a", reviewed_at: ago(90) };
  tasks[5].depends_on = ["t1"];
  tasks[7].depends_on = ["t2"];
  const agent = (id: string, participant_id: string, name: string, status: Agent["status"], current_task_id: string | null, seconds: number, note: string | null = null): Agent => ({
    id, participant_id, name, status, current_task_id, note,
    machine: `${participant_id === "p1" ? "Eran" : participant_id === "p2" ? "Maya" : "Omer"}’s laptop`,
    tool: "codex", model: "worker", role: "worker", last_heartbeat: ago(seconds), created_at: ago(1800),
  });
  return {
    participants, tasks,
    agents: [
      agent("a1", "p1", "eran-worker-1", "working", "t1", 8, "Connecting accessible field errors"),
      agent("a2", "p1", "eran-worker-2", "idle", null, 14, "PR submitted · ready for next task"),
      agent("a3", "p2", "maya-worker-1", "working", "t2", 4, "Building ranked team rows"),
      agent("a4", "p2", "maya-worker-2", "idle", null, 19, "Waiting for an available scope"),
      agent("a5", "p3", "omer-worker-1", "blocked", "t3", 11, "Needs the invite expiry decision"),
      agent("a6", "p3", "omer-worker-2", "offline", null, 192, "No heartbeat received"),
    ],
    missions: [
      { id: "build", title: "Launch the team app", goal: "Build a landing page with signup and a leaderboard.", status: "running", source_doc_id: null, source_doc_url: null, plan_doc_url: null, handoff_doc_url: null, created_by: "mock-planner", created_at: ago(1800) },
      { id: "launch", title: "Prepare for launch", goal: "Get the release checklist and team handoff ready.", status: "awaiting_approval", source_doc_id: null, source_doc_url: null, plan_doc_url: null, handoff_doc_url: null, created_by: "mock-planner", created_at: ago(1800) },
    ],
    events: [
      { id: "e4", mission_id: "build", task_id: "t4", agent_id: "a2", type: "pr_opened", message: "Eran opened a mock PR · landing page ready for review", data: null, created_at: ago(90) },
      { id: "e3", mission_id: "build", task_id: "t3", agent_id: "a5", type: "progress", message: "Omer needs a decision on invite expiry", data: null, created_at: ago(160) },
      { id: "e2", mission_id: "build", task_id: "t2", agent_id: "a3", type: "claimed", message: "Maya claimed the leaderboard · scope reserved", data: null, created_at: ago(260) },
      { id: "e1", mission_id: "build", task_id: "t5", agent_id: "a4", type: "done", message: "Shared API contracts completed · 1 workload point", data: null, created_at: ago(600) },
      { id: "e0", mission_id: "build", task_id: null, agent_id: null, type: "created", message: "Mock mission created · team app brief ready", data: null, created_at: ago(1800) },
    ],
  };
}
