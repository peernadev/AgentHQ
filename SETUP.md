# AgentHQ setup guide

Roles:
- MASTER = Eran. Uses **Claude Code** in the terminal. Owns GitHub, Supabase, Vercel.
- FRIENDS = the other two. Use the **Codex app**.
- EVERYONE = all three, each on their own laptop.

Assumes a Mac (Windows notes in brackets). Button names on websites can shift
slightly; if something doesn't match, describe what you see.

| Part | Who | Time |
|---|---|---|
| 0. Install tools | EVERYONE (different tool per person) | 10 min |
| 1. GitHub repo | MASTER (friends accept invite) | 3 min |
| 2. Clone + starter kit | MASTER | 2 min |
| 3. Scaffold with Claude Code | MASTER | 10-15 min |
| 4. Check + push | MASTER | 2 min |
| 5. Supabase | MASTER | 8 min |
| 6. Vercel | MASTER (friends sign up + accept invite) | 10 min |
| 7. Protect main | MASTER | 3 min |
| 8. Dry run | EVERYONE | 15 min |
| 9. Kickoff tasks | EVERYONE | then build |

Order: MASTER sends FRIENDS the message at the bottom, then starts Part 1.
FRIENDS do Part 0 and wait. After Part 7, MASTER says "go" and everyone does Part 8.

---

## Part 0 - Install tools  [EVERYONE]

Where: Terminal (Cmd+Space, type "Terminal", Enter) [Windows: PowerShell]

1. Check:

       node -v        # need v20 or newer
       git --version
       gh --version

   - Node missing/old: nodejs.org -> download LTS -> run installer -> close and reopen Terminal
   - gh missing: `brew install gh` (no brew? install it from brew.sh first)
     [Windows: `winget install GitHub.cli`]
   - git missing: macOS offers to install developer tools -> click Install

2. GitHub login:

       gh auth login

   Choose: GitHub.com -> HTTPS -> Yes -> Login with a web browser.
   Copy the 8-character code, press Enter, paste the code in the browser, click Authorize.

3. Vercel CLI:

       npm i -g vercel          # "permission denied"? -> sudo npm i -g vercel

4. Vercel account: vercel.com -> Sign Up -> Continue with GitHub.
   FRIENDS: send MASTER the email you signed up with.

5. Your agent tool:
   - MASTER (Claude Code):

         curl -fsSL https://claude.ai/install.sh | bash
         claude          # first run: log in with your Claude Pro account, then type /exit

   - FRIENDS: Claude Code (same commands) or the Codex app, logged in.

---

## Part 1 - Create the GitHub repo  [MASTER]

Where: github.com

1. Top-right "+" -> New repository
2. Owner: you. Repository name: `agenthq`. Select **Public**.
   Leave "Add a README", ".gitignore" and "license" all OFF.
3. Click **Create repository**
4. Repo -> **Settings** tab -> left sidebar "Collaborators" (under Access)
   -> confirm password/2FA if asked -> **Add people** -> type friend's username
   -> pick them -> **Add ... to this repository**. Repeat for friend 2.

FRIENDS: accept the invite (email or github.com/notifications).

---

## Part 2 - Clone and add the starter kit  [MASTER]

Where: Terminal

    cd ~
    gh repo clone YOUR-USERNAME/agenthq
    cd agenthq
    unzip ~/Downloads/agenthq-starter-kit.zip -d .
    ls -a

You should see: .worktreeinclude AGENTS.md CLAUDE.md DESIGN.md SETUP.md SPEC.md
prompts scripts src supabase. ("You appear to have cloned an empty repository" is fine.)

---

## Part 3 - Scaffold with Claude Code  [MASTER]

Where: Terminal, inside ~/agenthq

    claude

Paste this prompt and press Enter:

    Read CLAUDE.md and AGENTS.md first. Scaffold this repo as described there.

    Note: this folder already contains AGENTS.md, CLAUDE.md, SPEC.md, DESIGN.md,
    SETUP.md, .worktreeinclude, prompts/, scripts/, supabase/schema.sql and
    src/types/api.ts. create-next-app may refuse a non-empty folder; if so,
    scaffold into a temp folder and move everything in, keeping ALL our
    existing files untouched.

    Set up:
    - Next.js latest (App Router, TypeScript, src/ directory, ESLint), Tailwind
    - shadcn/ui initialized, with: button, card, input, dialog, tabs, sonner,
      skeleton. Mount the Sonner <Toaster /> in the root layout.
    - Supabase browser client in src/lib/supabase.ts using @supabase/ssr, reading
      NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    - Server-only admin client in src/lib/server/supabase-admin.ts (import
      "server-only"), reading NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY
    - .env.example with empty values for: NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, TEAM_JOIN_CODE
    - .gitignore must include: .env.local, .hq.json, .claude/worktrees/
    - Keep src/types/api.ts exactly as is (it already has HealthResponse)
    - src/lib/mocks/ with a placeholder file
    - Empty placeholder folders: cli/, src/app/(dashboard)/, src/lib/server/
    - src/app/api/health/route.ts returning { ok: true }
    - src/app/lab/page.tsx and src/app/demo/page.tsx as simple placeholder pages
    - Home page that fetches /api/health and shows "API: ok" in a shadcn Card
    - package.json scripts: dev, build, lint
    - Make scripts/setup-worktree.sh executable

    Then run lint, typecheck (npx tsc --noEmit) and build, fixing errors until
    all pass. Commit everything with message "chore: scaffold". Do not push.

- Claude asks before running commands. For npm/npx/git in this folder, choose
  "Yes" (or "Yes, and don't ask again" for that command).
- Done when it reports lint, typecheck and build passed and the commit exists.
- Type `/exit` to leave Claude Code.

---

## Part 4 - Check it and push  [MASTER]

Where: Terminal, inside ~/agenthq

    npm run dev

Open http://localhost:3000 -> card says "API: ok". Back in Terminal: Ctrl+C. Then:

    git log --oneline       # top line: chore: scaffold
    git status              # "nothing to commit"
    git push origin main

Refresh the repo on github.com -> files are there.

---

## Part 5 - Supabase  [MASTER]

One project for the whole team. FRIENDS never create their own.

Create the project (supabase.com):
1. Sign in -> Continue with GitHub -> Authorize
2. If asked for an organization: any name, type Personal, plan Free -> Create organization
3. **New project**:
   - Project name: agenthq
   - Database password: **Generate a password** -> Copy -> save in password manager
   - Region: West US (North California)
   -> **Create new project**, wait ~2 min

Get the keys:
4. Bottom-left gear (**Project Settings**) -> **API Keys**
   - Copy the **Publishable key** (sb_publishable_...)
   - Secret keys -> **Reveal** -> copy (sb_secret_...)
     (older projects show "anon" and "service_role" instead; use those)
5. **Connect** button (top bar) -> copy the **Project URL** (https://xxxx.supabase.co)

Create .env.local (Terminal, inside ~/agenthq):

    cp .env.example .env.local
    open -e .env.local          # [Windows: notepad .env.local]

Fill in, save, close:

    NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxx
    SUPABASE_SECRET_KEY=sb_secret_xxxx
    TEAM_JOIN_CODE=<any made-up phrase, e.g. purple-otter-42>

Never put NEXT_PUBLIC_ in front of the secret key. Never paste it in chat.
Run `git status`: .env.local must NOT be listed.

Create the database (supabase.com):
6. Left sidebar **SQL Editor** -> **+ New query**
7. Terminal: `open -e supabase/schema.sql` -> Cmd+A, Cmd+C -> paste into the editor
8. Click **Run** (bottom right) -> "Success. No rows returned"
9. Check:
   - **Table Editor**: participants, agents, agent_tokens, tasks, events
   - **Database -> Publications -> supabase_realtime**: participants, agents, tasks, events

---

## Part 6 - Vercel  [MASTER sets up; FRIENDS accept invite]

Team (vercel.com):
1. Top-left team switcher -> **Create Team** -> name `agenthq-team` -> choose
   **Pro trial** (14 days free; needed so friends' PRs get previews and comments).
   Card asked? Set a phone reminder to downgrade before day 14.

Import:
2. With the new team selected: **Add New... -> Project**
3. Import Git Repository: if agenthq isn't listed -> **Install** / **Adjust GitHub
   App Permissions** -> Only select repositories -> agenthq -> Save
4. Next to agenthq -> **Import**
5. Configure Project:
   - Framework Preset: Next.js
   - Open **Environment Variables** -> paste the WHOLE contents of .env.local into
     the first Key box (it splits into 4 rows). Leave "Sensitive" OFF.
6. **Deploy** -> wait ~1 min -> open the domain -> "API: ok" live
7. Project -> **Settings -> Environment Variables**: all 4 must apply to
   Production, Preview AND Development (fix with "..." -> Edit if not)

Invite:
8. Team -> **Settings -> Members -> Invite** -> friend's Vercel email -> role Member.
   Repeat. FRIENDS: accept from email.

Link your folder (Terminal, inside ~/agenthq):

    vercel login            # Continue with GitHub
    vercel link             # y -> agenthq-team -> link existing: y -> agenthq

---

## Part 7 - Protect main  [MASTER]

Where: github.com -> repo -> **Settings** -> left sidebar **Rules -> Rulesets**
-> **New ruleset -> New branch ruleset**

- Ruleset name: protect-main
- Enforcement status: **Active**
- Target branches: **Add target -> Include default branch**
- Branch rules (checked):
  - Restrict deletions
  - Require a pull request before merging -> Required approvals: **0**
  - Block force pushes
- Scroll down -> **Create**

Test (Terminal):

    git commit --allow-empty -m test && git push origin main    # must be REJECTED
    git reset --hard HEAD~1                                     # undo test commit

MASTER: tell FRIENDS "go".

---

## Part 8 - Dry run  [EVERYONE]

FRIENDS, Terminal:

    gh repo clone MASTER-USERNAME/agenthq
    cd agenthq
    vercel login
    vercel link                 # agenthq-team -> existing -> agenthq
    vercel env pull .env.local

FRIENDS, Codex app: **Add project** -> agenthq -> new thread -> mode **Worktree**,
model **Terra** -> paste:

    Run scripts/setup-worktree.sh. Then change the home page heading to
    "<your name> was here", run lint, typecheck and build, commit, push the
    branch, and open a PR with gh pr create.

MASTER, Terminal (new tab, Cmd+T):

    cd ~/agenthq && git checkout main && git pull
    claude -w dryrun-master

Paste the same prompt (with your name).

EVERYONE:
1. github.com -> repo -> **Pull requests** -> open a PR -> wait for the Vercel bot
   comment -> **Visit Preview**
2. On a teammate's preview: Vercel toolbar (bottom of page) -> **Comment** -> click
   on the page -> type a comment
3. PR owner tells their agent:

       Run vercel comments for this branch, address the open comments, reply
       briefly, resolve them, run checks, and push.

MASTER: each PR -> **Squash and merge -> Confirm** -> **Delete branch**.
Open the main Vercel URL -> all changes live. Setup is done.

---

## Part 9 - Kickoff tasks  [EVERYONE, in parallel]

Pick roles first (MASTER fits B or C). Each person starts a new agent session
(FRIENDS: Codex Worktree thread; MASTER: `claude -w <task-name>` in a new tab),
first message: "Run scripts/setup-worktree.sh, then read AGENTS.md and SPEC.md."
Then the role's task:

A (dashboard):

    Build the dashboard at src/app/(dashboard)/page.tsx using mock data in
    src/lib/mocks/ typed with src/types/api.ts: agent board (cards grouped by
    participant: status color, current task, heartbeat age), queue column
    (draft/queued, ordered by priority), in review + done columns, activity feed.
    Projector-friendly. Show me a plan first.

B (backend):

    Implement the API routes in SPEC.md section 8 in src/app/api/, using
    src/lib/server/supabase-admin.ts and the claim_next_task RPC from
    supabase/schema.sql. Agent auth = Bearer token, stored as sha256 in
    agent_tokens; every agent call updates last_heartbeat. Start with join,
    claim, progress, review, then POST /api/tasks. Show me a plan first.

C (agents + demo):

    Build cli/hq.mjs per SPEC.md section 9: plain Node 20, no dependencies,
    built-in fetch, config in ./.hq.json, HQ_URL env (default: our Vercel URL).
    Print task JSON on claim or NO_TASK. Then scripts/seed.mjs that creates
    3 participants and ~8 demo tasks. Show me a plan first.

Goal by hour 3: C's CLI joins + claims against B's API and A's board shows it
live (A swaps mocks for Supabase Realtime). Then DOGFOOD:
- MASTER: plain `claude` session on main (no -w), `/model` -> Opus, paste
  prompts/orchestrator.md ("Codex Local thread" in that file = this session).
- Everyone: worker sessions with prompts/worker.md.

---

## Day-of workflow

The loop:

    pick task -> new worktree session -> agent builds + commits -> push + PR
    -> preview link -> feedback comments -> agent fixes -> merge -> everyone syncs

30-90 min per loop. Small PRs merge fast and rarely conflict.

### 1. Start a task  [EVERYONE]

    cd ~/agenthq && git checkout main && git pull     # main folder, before each task

Then start the session:
- Codex (FRIENDS): new thread -> Worktree -> Terra
- Claude Code (MASTER): new terminal tab -> `claude -w <short-task-name>`

First message: `Run scripts/setup-worktree.sh, then read AGENTS.md, SPEC.md and DESIGN.md.`
Then the task:

    Task: <one small, specific thing>.
    Stay in my area per AGENTS.md. Show me a short plan before coding.
    Commit after each working step.

Read the plan, reply "go" or correct it. One task = one session = one worktree = one branch.
(Once AgentHQ works: paste prompts/worker.md instead and the agent pulls tasks itself.)

### 2. While the agent works

- It commits locally on its own branch; nobody sees it until you push.
- Look at it on the port the setup script printed (e.g. http://localhost:3017).
- Run a second session on a different task in parallel (its own worktree).
- Stuck after 2 tries -> stop it, new session with a tighter task.

### 3. When to push + open a PR

Push when the slice works (even ugly), when you want feedback, or every ~45 min.
Never sit on unpushed work for more than an hour. Tell the agent:

    Run lint, typecheck and build. If they pass, push the branch and open a PR
    with gh pr create. Title: what it does. Body: what changed + how to test.

By hand (inside the worktree):

    npm run lint && npx tsc --noEmit && npm run build
    git push -u origin HEAD
    gh pr create --fill

Post the PR link in the group chat.

### 4. Feedback

- Vercel posts a preview link on the PR in ~1-2 min.
- Anyone pins comments with the Vercel toolbar.
- PR owner: "Run vercel comments for this branch, address the open comments,
  reply briefly, resolve them, run checks, and push."
- New pushes update the same PR and preview. Decided visuals -> DESIGN.md "Decided".

### 5. Merge  [MASTER]

github.com PR -> **Squash and merge** -> **Delete branch**
or `gh pr merge <number> --squash --delete-branch`
Vercel deploys main in ~1 min. Post "merged #12" in chat.
(Once AgentHQ works: mark the task merged/done on the dashboard so its scope unlocks.)

### 6. Sync after a merge  [EVERYONE with an open branch]

Tell the agent: "Pull the latest main into this branch with git pull --no-rebase
origin main, resolve conflicts, run checks, push." By hand:

    git pull --no-rebase origin main
    npm run lint && npx tsc --noEmit && npm run build
    git push

### 7. Next task

After the merge, start a NEW session from fresh main (back to step 1).
- Claude Code: exit the session; unchanged worktrees are removed automatically.
- Cleanup by hand: `git worktree list` / `git worktree remove <path>`

### Shared files (types, schema, theme, package.json)
Announce in chat first, make it its own tiny PR, merge fast, everyone syncs.
Only B or C adds dependencies.

### Huddle every 60-90 min  [MASTER runs, 10 min]
1. Open the live URL, click through the demo flow in SPEC.md
2. Problems -> small tasks with owners (later: straight into the AgentHQ queue)
3. Glance at the fairness meter (workload points per person)
4. Cut scope early if behind

### If main breaks  [MASTER]
vercel.com -> project -> Deployments -> last good one -> **Instant Rollback**.
Then on github.com open the bad PR -> **Revert** -> merge the revert PR (or fix forward).

### Feature freeze
From freeze time: bug fixes and polish only. Last 2 hours: no code, rehearse.

### Cheat sheet

| When | Command |
|---|---|
| Before a new task (main folder) | `git checkout main && git pull` |
| New Claude Code worktree session | `claude -w <name>` |
| Run checks | `npm run lint && npx tsc --noEmit && npm run build` |
| Run the app | `npm run dev -- -p <port>` |
| First push / later pushes | `git push -u origin HEAD` / `git push` |
| Open a PR / list PRs | `gh pr create --fill` / `gh pr list` |
| Try a teammate's PR | `gh pr checkout <number>` |
| Merge (MASTER) | `gh pr merge <number> --squash --delete-branch` |
| Sync with main | `git pull --no-rebase origin main` |
| Preview comments | `vercel comments` |
| Env vars | `vercel env pull .env.local` |
| Worktrees | `git worktree list` / `git worktree remove <path>` |
| AgentHQ | `node cli/hq.mjs status` / `claim` |

---

## Rules for everyone

- Never push to main. Everything goes through PRs.
- One agent session per worktree. Never two agents in the same folder.
- Only edit your area (or the task's scope once AgentHQ runs).
- Codex: Terra default, Sol for planning.
- Claude Code: Sonnet default, Opus for orchestrator/hard bugs, /clear between tasks.
- Never paste keys in chat. Use `vercel env pull .env.local`.

---

## Message for MASTER to send FRIENDS

    Setup for today. Please do this now:

    1. Install: Node 20+ (LTS from nodejs.org), git, GitHub CLI
       (Mac: brew install gh / Windows: winget install GitHub.cli). Then:
         gh auth login        (GitHub.com -> HTTPS -> browser)
         npm i -g vercel
    2. Vercel: sign up at vercel.com with GitHub. Send me the email you used.
    3. Your agent tool: Claude Code or the Codex app, logged in.
    4. Accept my GitHub repo invite and Vercel team invite when they arrive.
    5. When I say go: follow "Part 8 - Dry run" in SETUP.md (in the repo).

    Don't create your own Supabase or Vercel project, and never push to main.
