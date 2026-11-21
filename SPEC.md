# SPEC.md: AgentHQ (working name)

A live mission-control dashboard for hackathon teams running many AI coding agents.

## 1. The idea
Student teams now run several AI agents across several laptops on one repo. Agents
step on each other, nobody can see the whole picture, and token or credit spend gets
lopsided. AgentHQ gives the team one **orchestrator** agent that breaks the project into
modular, non-overlapping tasks in a **queue**. **Worker agents** on every laptop (several
per laptop is fine) pull the top task, do it, open a PR, and pull the next one. A live
dashboard shows who is doing what, what's done, what's next, and whether spend is fair.

## 2. Demo flow (3 minutes, the top priority)
1. Dashboard is open on the projector: 3 participants, 0 agents, empty queue.
2. We paste a project goal ("build a landing page with signup and a leaderboard").
   The orchestrator drafts ~8 tasks, each with a **file scope**, dependencies, size and
   acceptance criteria. They appear as drafts in the queue.
3. We edit one, drag one higher, and click **Approve all**. The tasks turn "queued".
4. Three laptops (live) start worker agents. Agent cards light up one by one; each
   claims a task. The **scope lock map** shows nobody touches the same files.
5. A task finishes: its PR link appears, it moves to "In review", and the agent
   immediately claims the next one.
6. We kill an agent on stage. Within the timeout it turns "offline" and its task goes
   back to the queue, and another agent picks it up.
7. The **fairness meter** shows spend per person staying roughly even. One person is
   over their share, so the next task goes to a teammate.
8. **Wow moment:** "We built AgentHQ *using* AgentHQ. Here's the activity log from today."

## 3. Must-haves (only what the demo needs)
- [ ] Database + atomic claim (no two agents get the same task; no overlapping scopes)
- [ ] `hq` CLI: join, claim, progress, review, done, fail, status, tasks add, balance
- [ ] Worker prompt (the loop agents follow) and orchestrator prompt (how to split work)
- [ ] Dashboard: agent board, queue (approve drafts, reorder), in review / done, activity feed
- [ ] Live updates (Supabase Realtime, no refresh)
- [ ] Stale-agent recovery (heartbeat timeout puts the task back in the queue)
- [ ] Fairness meter + fairness rule in claim
- [ ] Scope lock map (which folders are locked by which agent)

## 4. Cut list (only if time allows)
- Dependency graph view of the queue
- `hq ask`: agent asks a human a question; answer it from the dashboard
- GitHub webhook: auto-mark "done" when the PR merges (until then: "Mark merged" button)
- Burn rate + "credits run out at 7:40pm" projection per person
- Show the Vercel preview link on each task card
- In-app "Plan with orchestrator" button that calls an LLM API (needs sponsor API credits)

## 5. Data model
Defined in `supabase/schema.sql` (types mirrored in `src/types/api.ts`).
- **participants**: name, color, credit_budget (2500), credits_remaining (synced by the person)
- **agents**: participant, name ("eran-mbp-1"), machine, tool, model, role
  (worker | orchestrator), status (idle | working | blocked | offline), current_task_id,
  last_heartbeat
- **tasks**: title, description, acceptance, priority (lower = sooner), size (S/M/L),
  est_credits, **scope** (path prefixes the task may edit), depends_on, status
  (draft → queued → claimed → in_progress → in_review → done | failed | cancelled),
  agent_id, branch, pr_url, result_summary, credits_used
- **events**: append-only activity log (created, approved, claimed, progress, pr_opened,
  done, failed, released, fairness_skip)
- **agent_tokens**: hashed per-agent API tokens (never readable by the browser)

## 6. How interference is prevented
1. **Scopes.** Every queued task lists path prefixes, like `src/components/queue/`. The
   claim function refuses a task whose scope overlaps any task that is claimed,
   in progress or in review. A scope lock is released only when the task is done (merged).
2. **Dependencies.** A task is claimable only when everything in depends_on is done.
3. **Shared files go first.** The orchestrator puts changes to shared files (types,
   schema, package.json, theme) into tiny early tasks that others depend on.
4. **One branch per task**, PRs into main, same git rules as AGENTS.md.
5. Claims are serialized with a Postgres advisory lock, so two agents can never race.

## 7. Fairness
- spend(person) = credit_budget − credits_remaining. Each person runs
  `hq balance <number>` from their Codex usage page, or edits it on the dashboard.
- Claim rule: if your spend > team average × 1.25 + 100 **and** a teammate has an idle
  online agent, you get no task this round, and the event log says why.
- The orchestrator balances task sizes so each person's expected share is similar.
- Dashboard: one bar per person against an "equal share" line.

## 8. API contracts (Next.js route handlers)
Agent calls send `Authorization: Bearer <agent token>`. Every agent call also counts
as a heartbeat. The dashboard reads Supabase directly (read-only); writes go through the API.

| Method | Route | Body | Returns | Who |
|---|---|---|---|---|
| POST | /api/agents/join | JoinRequest | JoinResponse | CLI (needs TEAM_JOIN_CODE) |
| POST | /api/agents/heartbeat | { status?, note? } | { ok } | worker |
| POST | /api/tasks/claim | none | ClaimResponse | worker |
| POST | /api/tasks/:id/progress | { message } | { ok } | worker |
| POST | /api/tasks/:id/review | { pr_url, branch, summary?, credits_used? } | { ok } | worker |
| POST | /api/tasks/:id/done | { summary?, credits_used? } | { ok } | worker or dashboard |
| POST | /api/tasks/:id/fail | { reason } | { ok } | worker |
| POST | /api/tasks | { tasks: CreateTaskInput[] } | { ids } | orchestrator (created as drafts) |
| PATCH | /api/tasks/:id | UpdateTaskInput | Task | dashboard |
| POST | /api/tasks/approve | { ids } | { ok } | dashboard (draft → queued) |
| POST | /api/tasks/reorder | { ids } (new order) | { ok } | dashboard |
| POST | /api/participants/:id/balance | { credits_remaining } | { ok } | CLI or dashboard |

Dashboard write routes: no auth for the hackathon. Mention it to judges as a known shortcut.

## 9. `hq` CLI (Node, no dependencies, in `cli/hq.mjs`)
Config lives in `.hq.json` in the current folder (gitignored), so each worktree is its own agent.
```
hq join --code <TEAM_JOIN_CODE> --participant Eran --name eran-mbp-1 [--role worker|orchestrator] [--model terra]
hq claim                         # prints task JSON, or NO_TASK
hq progress <id> "message"
hq review <id> --pr <url> --branch <name> [--credits 40]
hq done <id> [--summary "..."]
hq fail <id> "reason"
hq status [--json]               # queue + agents snapshot
hq tasks add plan.json           # orchestrator: submit drafts
hq balance <credits_remaining>
```
Env: HQ_URL (defaults to the production Vercel URL).

## 10. Who owns what
- **A, frontend/dashboard:** `src/app/(dashboard)/**`, `src/components/**`. Agent board, queue,
  review/done columns, activity feed, fairness meter, scope map. Use mock data from
  `src/lib/mocks/` until B's tables exist, then switch to Supabase Realtime.
- **B, backend:** `supabase/**`, `src/app/api/**`, `src/lib/server/**`. Schema, claim and
  stale functions, all API routes, token auth.
- **C, agents + demo:** `cli/**`, `prompts/**`, `scripts/seed*`, README, pitch. The hq CLI,
  worker and orchestrator prompts, seed data, demo script, backup video.

## 11. Timeline (adjust to the event's hours)
- **Hour 0–1:** setup (SETUP.md), contracts are already in the repo.
- **By hour 3:** vertical slice. One real agent joins, claims, reviews, and the board updates live.
- **Hour 3–4:** **dogfood.** Load our remaining work into AgentHQ and run our own agents from it.
- **Feature freeze:** 4 hours before the deadline.
- **Last 2 hours:** rehearse the demo flow, record the backup video.
