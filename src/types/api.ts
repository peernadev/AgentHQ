// Shared contracts (Firestore edition). Timestamps are ISO strings at the API boundary;
// server code converts Firestore Timestamps. Shared file: announce before changing.

export type AgentRole = "worker" | "orchestrator";
export type AgentTool = "claude" | "codex" | "antigravity" | "other";
export type AgentStatus = "idle" | "working" | "blocked" | "offline";
export type TaskStatus =
  | "draft" | "queued" | "claimed" | "in_progress"
  | "in_review" | "done" | "failed" | "cancelled";
export type TaskSize = "S" | "M" | "L";
export type MissionStatus = "planning" | "awaiting_approval" | "running" | "reviewing" | "done";
export type ReviewVerdict = "pass" | "revise" | "needs_human";

export const TASK_POINTS: Record<TaskSize, number> = { S: 1, M: 2, L: 4 };

export interface Participant {
  id: string;
  name: string;
  email: string | null;
  color: string | null;
  points: number;
  tasks_done: number;
  created_at: string;
}

export interface Agent {
  id: string;
  participant_id: string;
  name: string;
  machine: string | null;
  tool: AgentTool;
  model: string | null;
  role: AgentRole;
  status: AgentStatus;
  current_task_id: string | null;
  note: string | null;
  last_heartbeat: string;
  created_at: string;
}

export interface Mission {
  id: string;
  title: string;
  goal: string;
  source_doc_id: string | null;
  source_doc_url: string | null;
  plan_doc_url: string | null;
  handoff_doc_url: string | null;
  status: MissionStatus;
  created_by: string;
  created_at: string;
  // "cached_demo": Gemini was busy and DEMO_FALLBACK=1, so the saved demo plan was used. Show it in the UI.
  plan_source?: "gemini" | "cached_demo";
}

export interface CheckResults { lint: boolean; typecheck: boolean; build: boolean }

export interface TaskReview {
  verdict: ReviewVerdict;
  notes: string;
  sha: string;          // review is void if the task's head_sha changes
  reviewed_at: string;
}

export interface Task {
  id: string;
  mission_id: string | null;
  title: string;
  description: string;
  acceptance: string | null;
  priority: number;            // lower = sooner
  size: TaskSize;
  scope: string[];             // path prefixes, e.g. ["src/components/queue/"]
  depends_on: string[];        // task ids
  status: TaskStatus;
  agent_id: string | null;
  attempt_id: string | null;   // fencing token for the current claim
  lease_expires_at: string | null;
  branch: string | null;
  pr_url: string | null;
  head_sha: string | null;
  checks: CheckResults | null;
  review: TaskReview | null;
  result_summary: string | null;
  created_by: string;
  claimed_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface HqEvent {
  id: string;
  mission_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  type:
    | "created" | "approved" | "claimed" | "progress" | "pr_opened" | "reviewed"
    | "done" | "failed" | "released" | "fairness_skip" | "recovery_proposed"
    | "doc_created" | "calendar_proposed" | string;
  message: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
}

export interface ScopeRegistry { locks: Record<string, string[]>; updated_at: string }

// ---------- requests / responses ----------

export interface JoinRequest {
  code: string;
  participant: string;
  name: string;
  machine?: string;
  tool?: AgentTool;
  model?: string;
  role?: AgentRole;
}
export interface JoinResponse { agent_id: string; participant_id: string; token: string }

export interface ClaimResponse { task: Task | null; reason?: "no_task" | "fairness" }

export interface CreateTaskInput {
  key?: string;             // temp id so depends_on can reference tasks in the same batch
  title: string;
  description: string;
  acceptance?: string;
  priority?: number;
  size?: TaskSize;
  scope: string[];
  depends_on?: string[];    // ids of existing tasks or keys from this batch
}

export type UpdateTaskInput = Partial<
  Pick<Task, "title" | "description" | "acceptance" | "priority" | "size" | "scope" | "depends_on" | "status">
>;

export interface ProgressRequest { attempt_id: string; message: string }
export interface ReviewRequest {
  attempt_id: string; pr_url: string; branch: string; head_sha: string;
  checks: CheckResults; summary?: string;
}
export interface FailRequest { attempt_id: string; reason: string; log_excerpt?: string }
export interface DoneRequest { summary?: string }

export interface CreateMissionRequest {
  title: string;
  goal: string;
  source_doc_id?: string;
  google_access_token?: string;  // short-lived, used once, never stored
}
export interface CreateMissionResponse {
  mission: Mission;
  task_ids: string[];
  cached_plan?: boolean;  // true: not a live Gemini plan (see Mission.plan_source); the UI must say so
}

export interface HealthResponse { ok: boolean }
