# SPEC.md: AgentHQ, Google-native mission control

"Turn a Google Doc brief into coordinated parallel work, evidence-backed results and a team review."

## 1. The idea
Student teams run many AI coding agents across several laptops on one repo. Agents collide,
nobody has the full picture, and work splits unevenly. AgentHQ: a **Gemini planner**
reads the team's Google Doc brief and drafts small, file-scoped tasks. Humans approve.
**Worker agents** (Claude Code, Codex, Antigravity…) on every laptop claim tasks via
the `hq` CLI, work in isolated worktrees, run checks and open PRs. A **Gemini reviewer**
checks the evidence, a **recovery planner** proposes fixes for failures, and AgentHQ
writes the **handoff Doc** and proposes a **Calendar review slot**. Everything is live on
a mission-control dashboard.

## 2. Demo flow (3 min, top priority)
1. Sign in with Google. Mission control is empty: 3 teammates, no agents.
2. **New mission → pick a Google Doc brief from Drive.** Gemini drafts ~8 scoped tasks,
   cites the brief, and writes the plan into a new Google Doc.
3. We edit one task, drag one higher, **Approve all**.
4. Workers on our laptops join and claim tasks live. The scope lock map shows no file overlap.
5. A task fails its checks for real. The **recovery planner** proposes a smaller fix task, and we approve it.
6. A task's PR lands. The **Gemini reviewer** marks it pass with evidence (SHA, checks, diff summary).
7. We kill an agent. Its lease expires and another worker picks up the task.
8. **Finish mission:** the handoff Doc is generated, with a Calendar review slot proposed and confirmed.
9. "We built AgentHQ using AgentHQ." Long coding phases are pre-recorded and labeled as such.

## 3. Phases (build in order; each phase is demoable)
**Phase 1, core loop (no card needed)**
- [ ] Firebase Auth (Google sign-in) on the dashboard
- [ ] Firestore data model + server claim transaction (scopes, deps, fairness, leases)
- [ ] Agent API routes + `hq` CLI (join, claim, progress, review, done, fail, status)
- [ ] Gemini planner from a typed goal → draft tasks; approve/reorder in UI
- [ ] Live mission-control UI (Firestore onSnapshot)

**Phase 2, Google workflow (no card needed)**
- [ ] Drive brief via Google Picker → planner input (+ citations to the brief)
- [ ] Plan Doc + handoff Doc via Docs API (idempotent)
- [ ] Gemini reviewer (pass/revise/needs-human, bound to head SHA + check results)
- [ ] Recovery planner on failed tasks → draft fix task
- [ ] Planner/reviewer/recovery built as ADK agents (`@google/adk`) with bounded tools

**Phase 3, if time / once Blaze billing exists**
- [ ] Calendar: free/busy → propose review slot → create event after confirmation
- [ ] Firebase App Hosting (move off Vercel) · Cloud Storage for logs/screenshots
- [ ] Antigravity worker adapter (`agy` headless CLI wrapper around `hq`)
- [ ] Sheets workload report · Gmail handoff draft (drafts only)
- [ ] Search grounding for research tasks

## 4. Stack
- Next.js 16 (App Router, TS), Tailwind, shadcn/ui
- **Firebase Auth** (Google provider): who is on the dashboard
- **Cloud Firestore**: all operational data. Browser reads only (security rules);
  all writes go through API routes using the **Firebase Admin SDK**
- **Gemini API** (`@google/genai`, Flash model, structured JSON output) + **ADK** (`@google/adk`)
- **Workspace APIs** (Drive, Docs, Calendar) called server-side with the user's
  short-lived OAuth access token (Google Identity Services in the browser). Tokens are never stored.
- Hosting: Vercel now → Firebase App Hosting in Phase 3 (needs Blaze, Node 22+)
- `hq` CLI: plain Node, no dependencies

## 5. Firestore data model
```
participants/{id}   name, email, color, points, tasks_done, created_at
agents/{id}         participant_id, name, machine, tool, model, role(worker|orchestrator),
                    status(idle|working|blocked|offline), current_task_id, note, last_heartbeat
agentTokens/{sha}   agent_id                      (server-only, never readable by the browser)
missions/{id}       title, goal, source_doc_id, source_doc_url, plan_doc_url, handoff_doc_url,
                    status(planning|awaiting_approval|running|reviewing|done), created_by, created_at,
                    plan_source(gemini|cached_demo|orchestrator), plan_requested_at,
                    plan_claimed_by, plan_claimed_by_name, plan_claimed_at   (plan request, AI_PROVIDER=claude-code)
tasks/{id}          mission_id, title, description, acceptance, priority, size(S|M|L),
                    scope[], depends_on[], status(draft|queued|claimed|in_progress|in_review|done|failed|cancelled),
                    agent_id, attempt_id, lease_expires_at, branch, pr_url, head_sha,
                    checks{lint,typecheck,build}, review{verdict,notes,sha}, result_summary,
                    orchestrator_request{kind(recovery|review), sha, requested_at, requested_by,
                      claimed_by, claimed_by_name, claimed_at} | null   (AI_PROVIDER=claude-code),
                    created_by, claimed_at, completed_at, created_at, updated_at
events/{auto}       mission_id, task_id, agent_id, type, message, data, created_at
messages/{id}       from_agent, from_name, to_agent, to_task, text, created_at, read_at
                    (agent -> agent; each send also logs a "message" event)
meta/scopeRegistry  locks: { [taskId]: string[] }, updated_at
outbox/{key}        kind(plan_doc|handoff_doc|calendar_event), mission_id, status, result_id
```
Points per size (fairness): S=1, M=2, L=4.

## 6. Claim transaction (replaces the SQL claim RPC)
One Admin SDK `runTransaction`. **Every claim reads and writes `meta/scopeRegistry`**,
which serializes claims (same role as the Postgres advisory lock).
1. Read the registry, the agent, all participants (for fairness), up to 50 `queued`
   tasks ordered by priority, and active tasks whose `lease_expires_at < now`.
2. Release expired leases: task → queued, clear agent/attempt, remove its lock,
   subtract its points, mark agent offline, add a `released` event.
3. Fairness: if my points > average of online participants + 2 and a teammate has an
   idle online worker → no task this round (`fairness_skip` event).
4. Pick the first queued task whose deps are all `done` and whose scope doesn't
   prefix-overlap any lock in the registry.
5. Write: task claimed + new `attempt_id` + `lease_expires_at = now + 10 min`;
   `registry.locks[taskId] = scope`; participant points += size points; agent working.
- **Every agent mutation must send `attempt_id`.** A mismatch returns 409, so a worker
  that lost its lease can't change the task anymore.
- Any agent call extends the lease by 10 min.
- Locks stay through `in_review` and are released by `done` (merged).
- **Never call Gemini or Workspace inside a transaction** (callbacks can rerun).
  Commit an `outbox` record, then run the external action idempotently afterwards.
- Composite index needed: tasks(status, priority). Firestore prints a create-index link the first time.

## 7. AI roles
**AI_PROVIDER** = `claude-code` (default) or `gemini`. With `claude-code` the server makes no AI calls for
planning: `POST /api/missions` saves a `planning` mission (an open plan request); an **orchestrator agent**
(Claude Code running `prompts/orchestrator.md`) claims it with `GET /api/plan-requests` (one at a time, a claim
lasts 10 min) and submits the plan with `POST /api/tasks { mission_id, tasks }`, which applies the same strict
validation as below and moves the mission to `awaiting_approval`. Unclaimed for 10 min → the dashboard says
"No orchestrator online"; the request stays open. With `gemini`, the server calls Gemini as described below.
Recovery and review work the same way under `claude-code`: "Propose recovery" opens a `recovery` request
(the orchestrator submits with `POST /api/tasks/:id/recovery`, same validation as below); "Review evidence"
saves a **rules-only** review at once (failed checks → revise, out-of-scope → needs_human, else needs_human
with the facts) and, if checks passed, opens a `review` request bound to the head SHA (the orchestrator
reviews with `gh pr diff` and submits with `POST /api/tasks/:id/verdict`, same guards as below). The
rules-only review stands when no orchestrator is online.

- **Planner:** input = brief text (cited), repo tree, AGENTS.md ownership, current queue
  and locks. Output = CreateTaskInput[] (JSON schema). Server validates: schema, no
  dependency cycles, real paths, non-overlapping parallel scopes. Tasks are saved as drafts.
- **Reviewer:** input = task, head SHA, diff summary, check results. Output =
  pass | revise | needs_human + evidence. A review is void if the SHA changes. It never
  replaces passing checks or a human merge. The diff comes from GitHub's public API (optional
  read-only `GITHUB_TOKEN` only raises the rate limit); the PR head must equal the task's
  head_sha. Rules before Gemini: a failed check is `revise` without a Gemini call; files
  outside the task's scope can never be `pass`. The verdict doesn't change the task's status.
- **Recovery:** input = failure reason/logs. Output = a smaller fix task or a prerequisite (draft).
  Validated like planner tasks, plus: size ≤ the failed task's; a fix stays inside the failed
  task's scope; a prerequisite doesn't overlap held locks. One pending draft per failed task.
- All three share one model fallback chain (`google/gemini.ts`); all busy → 503.
- Tools are bounded: read_selected_file, create_plan_doc, read_task_evidence,
  propose_task_revision, find_review_slots, create_confirmed_review_event. No shell, no
  arbitrary writes. Content from Docs/Drive can never authorize an action.

## 8. API (Next.js route handlers)
Agent routes: `Authorization: Bearer <agent token>`; every call is a heartbeat and renews the lease.
Every successful agent-route response also carries `inbox`: the agent's unread messages
(oldest first, max 50), marked read by that response. Error responses leave them unread.
| Method | Route | Body | Who |
|---|---|---|---|
| POST | /api/agents/join | { code, participant, name, machine?, tool?, model?, role? } | CLI |
| POST | /api/tasks/claim | none → { task \| null, reason? } (task includes attempt_id) | worker |
| POST | /api/tasks/:id/progress | { attempt_id, message } | worker |
| POST | /api/tasks/:id/review | { attempt_id, pr_url, branch, head_sha, checks, summary? } | worker |
| POST | /api/tasks/:id/fail | { attempt_id, reason, log_excerpt? } | worker |
| POST | /api/messages | { to_agent (id or name) \| to_task, text } → { message_id, to_agent, to_name } | any agent |
| GET | /api/messages | none → { inbox } | any agent |
| POST | /api/tasks/:id/done | { summary? } | dashboard (after merge) |
| GET | /api/plan-requests | none → { requests: OrchestratorRequest[] } (at most one plan/recovery/review request; claims it) | orchestrator agent |
| POST | /api/tasks/:id/recovery | { kind, task } → { task_id, kind } (recovery request; recovery validation) | orchestrator agent |
| POST | /api/tasks/:id/verdict | { sha, verdict, notes, evidence } → { review } (review request; SHA-bound, guarded) | orchestrator agent |
| POST | /api/tasks | { mission_id?, tasks: CreateTaskInput[] } (planning mission: strict plan validation, closes the request) | orchestrator agent |
| PATCH | /api/tasks/:id | UpdateTaskInput | dashboard |
| POST | /api/tasks/approve | { ids } | dashboard |
| POST | /api/tasks/reorder | { ids } | dashboard |
| POST | /api/missions | { title, goal } → mission (+ drafts with `gemini`; `planning` with `claude-code`) | dashboard |
| POST | /api/missions/:id/review-task | { task_id } → { review, requested? } (in_review tasks; stored on the task, bound to head_sha) | dashboard |
| POST | /api/missions/:id/recover | { task_id } → { task_id, kind } (gemini) or { requested: true } (claude-code) | dashboard |
| POST | /api/missions/:id/handoff | { google_access_token } → handoff Doc URL | dashboard |
Dashboard routes verify the Firebase ID token (`Authorization: Bearer <idToken>`) and
that the email belongs to a participant.

## 9. `hq` CLI (cli/hq.mjs, Node 22+, no deps, config in ./.hq.json)
```
hq join --code <TEAM_JOIN_CODE> --participant <name> --name <agent> [--role worker|orchestrator] [--tool claude|codex|antigravity]
hq claim                    # prints task JSON (with attempt_id) or NO_TASK
hq progress <id> "msg"
hq review <id> --pr <url> --branch <b>     # CLI fills head_sha and runs lint/typecheck/build itself
hq fail <id> "reason"       # attaches the last 40 lines of the failing check
hq status [--json]
hq plan-requests [--json] [--wait <s>]   # orchestrator: take the next plan/recovery/review request
hq recovery <task_id> recovery.json      # orchestrator: submit a recovery draft
hq verdict <task_id> verdict.json        # orchestrator: submit a review verdict
hq tasks add [--mission <id>] plan.json   # orchestrator: submit drafts / a mission's plan
hq msg <agent|task> "text"  # message an agent (id or name) or a task's current agent
hq inbox                    # heartbeat + show unread messages
```
The CLI keeps attempt_id in .hq.json and sends it automatically. Every hq call prints new
inbox messages to stderr.

## 10. Ownership
- **A, mission-control UI:** `src/app/(dashboard)/**`, `src/components/**`, `src/lib/client/**`
  (Firebase client, sign-in, Picker, GIS token). Antigravity-inspired layout: missions left,
  worker board center, inspector right, timeline bottom.
- **B, data + agent API + CLI:** `src/lib/server/**` (except `google/`), agent and task
  routes in `src/app/api/**`, `firestore.rules`, `firestore.indexes.json`, `cli/**`
- **C, Google AI + Workspace:** `src/lib/server/google/**` (gemini, adk, drive, docs, calendar),
  `src/app/api/missions/**`, `prompts/**`, demo script. (B takes this until a third person is free.)
- Shared, announce first: `src/types/**`, `package.json`, root layout, globals.css, AGENTS.md, SPEC.md

## 11. Fairness, honesty, pitch
- Fairness = workload points (stand-in for token spend; real usage tracking is future work).
- Say plainly in the demo: workers are launched by humans on laptops; recorded phases are labeled.
- Pitch: "Google-native mission control that turns team knowledge into parallel action
  and shows what every agent did, why it failed, and how the team recovered."
