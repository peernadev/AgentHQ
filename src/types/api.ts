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
  // "orchestrator": AI_PROVIDER=claude-code; an orchestrator agent (Claude Code) drafts the plan.
  plan_source?: "gemini" | "cached_demo" | "orchestrator";
  // Plan request (AI_PROVIDER=claude-code): open while status is "planning". A claim expires after
  // PLAN_CLAIM_MINUTES, then another orchestrator may take it.
  plan_requested_at?: string | null;
  plan_claimed_by?: string | null;       // orchestrator agent id
  plan_claimed_by_name?: string | null;  // its name, for the dashboard
  plan_claimed_at?: string | null;
}

/** Who drafts plans (and, later, recovery and review): an orchestrator agent, or Gemini inside the server. */
export type AiProvider = "claude-code" | "gemini";
/** How long an orchestrator's claim on a plan request lasts; also when the UI says "No orchestrator online". */
export const PLAN_CLAIM_MINUTES = 10;

export interface CheckResults { lint: boolean; typecheck: boolean; build: boolean }

export interface TaskReview {
  verdict: ReviewVerdict;
  notes: string;
  sha: string;          // review is void if the task's head_sha changes
  reviewed_at: string;
  evidence?: string[];  // short, checkable claims (file, check, acceptance bullet)
  model?: string;       // Gemini model that reviewed, or "rules" when decided without Gemini
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
  orchestrator_request?: OrchestratorTaskRequest | null;  // open recovery/review request (AI_PROVIDER=claude-code)
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

/** Agent-to-agent message (messages/{id}). to_task is set when sent to a task's current agent. */
export interface Message {
  id: string;
  from_agent: string;
  from_name: string;
  to_agent: string;
  to_task: string | null;
  text: string;
  created_at: string;
  read_at: string | null;
}

// ---------- requests / responses ----------

/**
 * Every agent-route success response also carries `inbox`: this agent's unread messages
 * (oldest first), which are marked read by that response. Error responses carry none.
 */
export type WithInbox<T> = T & { inbox?: Message[] };

/** Exactly one of to_agent (agent id or name) or to_task. */
export interface SendMessageRequest { to_agent?: string; to_task?: string; text: string }
export interface SendMessageResponse { message_id: string; to_agent: string; to_name: string }

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

/** A task finished since the claiming agent's previous claim ("what changed" briefing). */
export interface ChangeSummary { id: string; title: string; summary: string | null; completed_at: string }

export interface ClaimResponse {
  task: Task | null;
  reason?: "no_task" | "fairness";
  since_last_claim?: ChangeSummary[];   // only set when a task was claimed
}

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
  task_ids: string[];     // empty when an orchestrator will plan (mission.status "planning")
  cached_plan?: boolean;  // true: not a live Gemini plan (see Mission.plan_source); the UI must say so
}

/** A recovery or review request on a task, for an orchestrator agent. Cleared when it submits. */
export interface OrchestratorTaskRequest {
  kind: "recovery" | "review";
  requested_at: string;
  requested_by: string;
  sha: string | null;              // review: the head SHA it must review
  claimed_by: string | null;
  claimed_by_name: string | null;
  claimed_at: string | null;
}

interface RequestBase { mission_id: string; title: string; requested_by: string; requested_at: string; claimed_at: string }
interface RequestTask { title: string; description: string; acceptance: string | null; scope: string[]; size: TaskSize }
/** One open request, claimed by the calling orchestrator (GET /api/plan-requests). */
export type OrchestratorRequest =
  | (RequestBase & { kind: "plan"; goal: string })
  | (RequestBase & { kind: "recovery"; task_id: string; task: RequestTask; failure: { reason: string; log_excerpt: string | null } })
  | (RequestBase & { kind: "review"; task_id: string; task: RequestTask; pr_url: string; head_sha: string; checks: CheckResults });
/** @deprecated use OrchestratorRequest */
export type PlanRequest = OrchestratorRequest;
export interface PlanRequestsResponse { requests: OrchestratorRequest[] }

/** POST /api/tasks/:id/recovery (orchestrator): the recovery draft for a failed task. */
export interface RecoverySubmission { kind: RecoveryKind; task: CreateTaskInput }
/** POST /api/tasks/:id/verdict (orchestrator): a review bound to the head SHA it reviewed. */
export interface VerdictSubmission { sha: string; verdict: ReviewVerdict; notes: string; evidence: string[] }

export interface ReviewTaskRequest { task_id: string }
export interface ReviewTaskResponse {
  review: TaskReview;
  requested?: boolean;  // AI_PROVIDER=claude-code: the review is rules-only and an orchestrator review was requested
}

export type RecoveryKind = "fix" | "prerequisite";
export interface RecoverRequest { task_id: string }
/** Gemini: the new draft ({ task_id, kind }). claude-code: { requested: true }, the orchestrator drafts it. */
export interface RecoverResponse { task_id?: string; kind?: RecoveryKind; requested?: boolean }

export interface HealthResponse { ok: boolean }
