// Shared contracts. Field names match the database columns (snake_case) on purpose,
// so rows from Supabase can be used directly. Shared file: announce before changing.

export type AgentRole = "worker" | "orchestrator";
export type AgentStatus = "idle" | "working" | "blocked" | "offline";
export type TaskStatus =
  | "draft" | "queued" | "claimed" | "in_progress"
  | "in_review" | "done" | "failed" | "cancelled";
export type TaskSize = "S" | "M" | "L";

export interface Participant {
  id: string;
  name: string;
  color: string | null;
  credit_budget: number;
  credits_remaining: number | null;
  created_at: string;
}

export interface Agent {
  id: string;
  participant_id: string;
  name: string;
  machine: string | null;
  tool: string;
  model: string | null;
  role: AgentRole;
  status: AgentStatus;
  current_task_id: string | null;
  note: string | null;
  last_heartbeat: string;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  acceptance: string | null;
  priority: number;
  size: TaskSize;
  est_credits: number | null;
  scope: string[];        // path prefixes, e.g. ["src/components/queue/"]
  depends_on: string[];   // task ids
  status: TaskStatus;
  agent_id: string | null;
  branch: string | null;
  pr_url: string | null;
  result_summary: string | null;
  credits_used: number;
  created_by: string;
  claimed_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface HqEvent {
  id: number;
  task_id: string | null;
  agent_id: string | null;
  type:
    | "created" | "approved" | "claimed" | "progress" | "pr_opened"
    | "done" | "failed" | "released" | "fairness_skip" | string;
  message: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
}

// ---------- requests / responses ----------

export interface JoinRequest {
  code: string;            // TEAM_JOIN_CODE
  participant: string;     // creates the participant if new
  name: string;            // unique agent name
  machine?: string;
  tool?: string;
  model?: string;
  role?: AgentRole;
}
export interface JoinResponse { agent_id: string; participant_id: string; token: string }

export interface ClaimResponse { task: Task | null; reason?: "no_task" | "fairness" }

export interface CreateTaskInput {
  key?: string;            // temp id so depends_on can reference tasks in the same batch
  title: string;
  description: string;
  acceptance?: string;
  priority?: number;
  size?: TaskSize;
  est_credits?: number;
  scope: string[];
  depends_on?: string[];   // ids of existing tasks or keys from this batch
}

export type UpdateTaskInput = Partial<
  Pick<Task, "title" | "description" | "acceptance" | "priority" | "size" | "scope" | "depends_on" | "status">
>;

export interface ReviewRequest { pr_url: string; branch: string; summary?: string; credits_used?: number }
export interface DoneRequest { summary?: string; credits_used?: number }

export interface HealthResponse { ok: boolean }
