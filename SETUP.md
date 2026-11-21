# Hackathon setup guide (tonight)

Roles:
- MASTER = you (Eran). Owns the repo, Supabase, Vercel, and does steps 1-7.
- FRIENDS = the other two teammates.
- EVERYONE = all three, each on their own laptop.

Order tonight:
1. MASTER sends FRIENDS the message at the bottom of this file, then starts Step 1.
2. While MASTER does Steps 1-7 (~40 min), FRIENDS do Step 0 and wait for invites.
3. When MASTER finishes Step 7, EVERYONE does Step 8 together (ideally on a call).

Summary:

| Step | Who |
|---|---|
| 0. Install tools | EVERYONE |
| 1. Create GitHub repo | MASTER (friends only accept invite) |
| 2. Clone + add starter files | MASTER |
| 3. Scaffold with Codex | MASTER |
| 4. Check it and push | MASTER |
| 5. Supabase | MASTER |
| 6. Vercel | MASTER sets up; FRIENDS sign up + accept invite |
| 7. Protect main | MASTER |
| 8. Dry run | EVERYONE |

---

## Step 0 - Install tools  [EVERYONE]

Where: Terminal (Mac) or PowerShell (Windows)

Check what you have:

    node -v        # need v20 or newer
    git --version
    gh --version

- Missing Node: install the LTS version from nodejs.org
- Missing gh: Mac `brew install gh`, Windows `winget install GitHub.cli`

Log in:

    gh auth login        # GitHub.com -> HTTPS -> log in with browser
    npm i -g vercel
    vercel login         # Continue with GitHub

Codex app: install it and sign in with the ChatGPT account that shows
2,500 credits on the usage page.

Vercel account: sign up at vercel.com with GitHub (FRIENDS: send MASTER
the email you used).

---

## Step 1 - Create the GitHub repo  [MASTER]

Where: github.com in the browser

1. Click "+" (top right) -> New repository
2. Name: hackathon-app (or anything). Visibility: Public
   (public = free branch protection; judges usually want it public anyway)
3. Leave README, .gitignore and license UNCHECKED (empty repo)
4. Click Create repository
5. Settings -> Collaborators -> Add people -> add both friends' GitHub usernames

FRIENDS: accept the invite (email or github.com/notifications).

Do NOT set up branch protection yet (that's Step 7).

---

## Step 2 - Clone and add starter files  [MASTER]

Where: Terminal

    cd ~
    gh repo clone YOUR-USERNAME/hackathon-app
    cd hackathon-app
    mkdir scripts

Unzip the starter kit INTO the repo folder (adjust the path if it's not in Downloads):

    unzip ~/Downloads/agenthq-starter-kit.zip -d .
    ls        # AGENTS.md DESIGN.md SETUP.md SPEC.md prompts scripts src supabase

---

## Step 3 - Scaffold with Codex  [MASTER]

Where: Codex desktop app

1. Confirm you're signed in with the account that has the credits
2. Add a project -> select the hackathon-app folder
3. New thread -> mode: Local (not Worktree, not Cloud) -> model: Terra
4. Paste this prompt:

    Read AGENTS.md first. Scaffold this repo as described there.

    Note: this folder already contains AGENTS.md, SPEC.md, DESIGN.md, SETUP.md,
    prompts/, scripts/, supabase/schema.sql and src/types/api.ts. create-next-app
    may refuse a non-empty folder; if so, scaffold into a temp folder and move
    everything in, keeping ALL our existing files untouched.

    Set up:
    - Next.js latest (App Router, TypeScript, src/ directory, ESLint), Tailwind
    - shadcn/ui initialized, with these components: button, card, input, dialog,
      tabs, sonner, skeleton. Mount the Sonner <Toaster /> in the root layout.
    - Supabase browser client in src/lib/supabase.ts using @supabase/ssr, reading
      NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    - Server-only admin client in src/lib/server/supabase-admin.ts (import
      "server-only"), reading NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY
    - .env.example with empty values for: NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, TEAM_JOIN_CODE.
      Make sure .env.local and .hq.json are in .gitignore
    - Keep src/types/api.ts exactly as is (it already has HealthResponse)
    - Empty placeholder folders: cli/, src/app/(dashboard)/, src/lib/server/
    - src/lib/mocks/ with a placeholder file
    - src/app/api/health/route.ts returning { ok: true }
    - src/app/lab/page.tsx and src/app/demo/page.tsx as simple placeholder pages
    - Home page that fetches /api/health and shows "API: ok" in a shadcn Card
    - package.json scripts: dev, build, lint
    - Make scripts/setup-worktree.sh executable

    Then run lint, typecheck (npx tsc --noEmit) and build, fixing errors until
    all pass. Commit everything with message "chore: scaffold". Do not push.

5. Approve commands when Codex asks (npm install etc.)
6. Done when it reports lint, typecheck and build all pass

---

## Step 4 - Check it and push  [MASTER]

Where: Terminal, inside hackathon-app

    npm run dev

Open http://localhost:3000 -> you should see a card saying "API: ok".
Press Ctrl+C to stop, then:

    git log --oneline       # should show "chore: scaffold"
    git push origin main

Refresh the repo on github.com -> files should be there.

---

## Step 5 - Supabase  [MASTER]

One project for the whole team. FRIENDS do NOT create their own.

Where: supabase.com in the browser

1. Sign in with GitHub -> New project
2. Name it, click "Generate a password" and save it in a password manager,
   region: West US
3. Wait ~2 minutes for it to finish setting up
4. Click "Connect" (top of the project) -> App Frameworks -> Next.js
   Copy the Project URL and the publishable key
   (if you only see an "anon" key, that works too)

Where: Terminal, inside hackathon-app

    cp .env.example .env.local

Open .env.local in an editor and fill in:

    NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxx
    SUPABASE_SECRET_KEY=sb_secret_xxxx
    TEAM_JOIN_CODE=<make up any random word, e.g. purple-otter-42>

The secret key is in Project Settings -> API Keys (it may be called
"service_role" on older projects; that works too). NEVER put NEXT_PUBLIC_ in
front of it, and never paste it in chat.

Check `git status` does NOT list .env.local (never commit it).

Create the database (browser, Supabase):
1. Left sidebar -> SQL Editor -> New query
2. Paste the whole contents of supabase/schema.sql -> Run
   ("Success. No rows returned" = good)
3. Table Editor should now show: participants, agents, agent_tokens, tasks, events
4. Database -> Publications -> supabase_realtime should list participants,
   agents, tasks, events (that's what makes the dashboard live)

---

## Step 6 - Vercel  [MASTER sets up; FRIENDS accept invite]

Where: vercel.com in the browser  [MASTER]

1. Log in with GitHub
2. Team switcher (top left) -> create a team -> choose the Pro trial
   (14 days free; needed so friends' PRs get previews and everyone can comment).
   If it asks for a card: set a phone reminder to downgrade before day 14.
3. Inside the team: Add New -> Project -> Import Git Repository -> hackathon-app
   (if it's not listed, click the link to grant Vercel's GitHub app access)
4. Framework: Next.js (auto-detected)
   Environment Variables: add all FOUR variables from .env.local,
   applied to Production AND Preview AND Development (don't tick "Sensitive",
   or friends can't fetch them with `vercel env pull`)
5. Click Deploy, wait ~1 min, open the URL -> "API: ok" live
6. Team Settings -> Members -> invite both friends

Where: Terminal, inside hackathon-app  [MASTER]

    vercel link     # pick your team -> Link to existing project -> hackathon-app

FRIENDS: accept the Vercel team invite from email.

---

## Step 7 - Protect main  [MASTER]

Where: github.com -> repo -> Settings -> Rules -> Rulesets
       -> New ruleset -> New branch ruleset

- Ruleset name: protect-main
- Enforcement status: Active
- Target branches: Add target -> Include default branch
- Turn on:
  - Restrict deletions
  - Require a pull request before merging -> Required approvals: 0
    (agents can't push straight to main, but anyone can merge a PR right away)
  - Block force pushes
- Click Create

Test it (Terminal):

    git commit --allow-empty -m test && git push origin main   # should be REJECTED
    git reset --hard HEAD~1                                    # undo the test commit

MASTER: tell FRIENDS "go".

---

## Step 8 - Dry run  [EVERYONE]

FRIENDS, each on their own laptop:

Where: Terminal

    gh repo clone MASTER-USERNAME/hackathon-app
    cd hackathon-app
    vercel link             # pick the team -> existing project -> hackathon-app
    vercel env pull .env.local

Where: Codex app

1. Add project -> select the hackathon-app folder
2. New thread -> mode: Worktree -> model: Terra
3. Paste:

    Run scripts/setup-worktree.sh. Then change the home page heading to
    "<your name> was here", run lint, typecheck and build, commit, push the
    branch, and open a PR with gh pr create.

Where: github.com -> the PR

4. Wait for the Vercel bot comment with a preview link -> open it

EVERYONE:

5. Open a teammate's preview link, click Comment in the Vercel toolbar,
   pin a comment on the page
6. PR owner tells their Codex thread:

    Run vercel comments for this branch, address the open comments,
    reply briefly, and resolve them.

MASTER:

7. Merge both PRs on github.com
8. Open the main Vercel URL -> both changes should be live

If all of this works tonight, setup is done.

---

## Step 9 - Kickoff: first tasks  [EVERYONE, in parallel]

Until AgentHQ itself works, use the normal workflow below (manual tasks).
Each person: new Worktree thread -> "Run scripts/setup-worktree.sh, then read
AGENTS.md and SPEC.md." -> then your first task:

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

Goal by hour 3: C's CLI joins + claims against B's API, and A's board shows it
live (A swaps mocks for Supabase Realtime). Then DOGFOOD: MASTER runs
prompts/orchestrator.md to load our remaining work into AgentHQ, everyone
starts threads with prompts/worker.md.

---

## Day-of workflow (after setup)

The loop every person repeats all day:

    pick task -> new worktree thread -> agent builds + commits -> push + PR
    -> preview link -> feedback comments -> agent fixes -> merge -> everyone syncs
    -> next task

Aim for each loop to take 30-90 minutes. Small PRs merge fast and rarely conflict.

### 1. Start a task  [EVERYONE]

Where: Terminal, in your main hackathon-app folder (once, before each new task)

    git checkout main
    git pull

This makes sure your new worktree starts from the latest main.

Where: Codex app

1. New thread -> mode: Worktree -> model: Terra
2. First message in every new worktree thread:

    Run scripts/setup-worktree.sh, then read AGENTS.md, SPEC.md and DESIGN.md.

3. Then give the task. Template:

    Task: <one small, specific thing, e.g. "build the upload page from SPEC.md
    step 2, using mock data from src/lib/mocks">.
    Stay in my area per AGENTS.md. Show me a short plan before coding.
    Commit after each working step.

4. Read the plan (30 seconds), reply "go" or correct it.

One task = one thread = one worktree = one branch. Don't reuse a thread for a
second unrelated task.

### 2. While the agent works  [EVERYONE]

- The agent commits locally on its own branch after each working step.
  Commits are local only; nobody else sees them until you push.
- To look at it yourself, open the worktree's dev server (the port the setup
  script printed), e.g. http://localhost:3017
- You can run a second thread on a different task in parallel (its own worktree).
- If the agent is stuck after 2 attempts: stop it, start a fresh thread with a
  tighter task.

### 3. When to push and open a PR  [EVERYONE]

Push when ANY of these is true:
- the feature slice works (even if ugly), or
- you want teammates to see it / give feedback, or
- it has been ~45 minutes since your last push.

Never sit on unpushed work for more than an hour.

Tell the agent:

    Run lint, typecheck and build. If they pass, push the branch and open a PR
    with gh pr create. Title: what it does. Body: what changed + how to test.

Or by hand, from inside the worktree folder:

    npm run lint && npx tsc --noEmit && npm run build
    git push -u origin HEAD
    gh pr create --fill

Then post the PR link in the group chat.

### 4. Feedback on the PR  [EVERYONE]

- Vercel posts a preview link on the PR within ~1-2 min.
- Anyone opens it and pins comments with the Vercel toolbar (Comment button).
- PR owner tells their thread:

    Run vercel comments for this branch, address the open comments, reply
    briefly, resolve them, run checks, and push.

- Every new push to the same branch updates the PR and the preview
  automatically. No new PR needed.
- Visual choices that get decided -> agent adds a line to DESIGN.md "Decided".

### 5. Merge  [MASTER, or the PR owner if MASTER says so]

When the preview looks right and checks pass:

On github.com: PR page -> "Squash and merge" -> "Delete branch"

Or Terminal:

    gh pr merge <PR-number> --squash --delete-branch

Vercel deploys main automatically (~1 min). Post "merged #12" in the group chat.

### 6. Sync after any merge  [EVERYONE with an open branch]

Whenever someone posts "merged", pull main into your branch so you stay close.

Tell your thread:

    Pull the latest main into this branch with git pull --no-rebase origin main.
    If there are conflicts, resolve them, run lint/typecheck/build, then push.

Or by hand, inside the worktree folder:

    git pull --no-rebase origin main
    npm run lint && npx tsc --noEmit && npm run build
    git push

(We merge main in instead of rebasing so nobody ever needs to force-push.)

### 7. Next task  [EVERYONE]

After your PR is merged, start a NEW thread/worktree from fresh main (back to
step 1). Old worktrees can be closed in the Codex app, or by hand:

    git worktree list
    git worktree remove <path>

### Shared files (types, schema, theme, package.json)

- Announce it in chat first ("changing src/types/api.ts").
- Make it its own tiny PR, merge it fast, everyone syncs (step 6).
- Only B or C adds dependencies.

### Huddle every 60-90 min  [MASTER runs it, 10 min]

1. MASTER opens the live main URL and clicks through the demo flow in SPEC.md
2. Everyone calls out problems; MASTER writes them as small tasks in the
   shared list (GitHub Issues or TODO.md), each with an owner
3. Quick check of credits on each person's usage page
4. Update SPEC.md if scope changed (cut things early, not late)

### If main breaks  [MASTER]

- Fastest: on vercel.com -> project -> Deployments -> pick the last good one ->
  Instant Rollback (site is fixed in seconds; code still needs fixing).
- Then on github.com open the PR that broke it -> "Revert" -> merge the
  revert PR, or have the owner's agent fix forward in a new PR.

### Feature freeze  [MASTER announces]

From freeze time (see SPEC.md timeline): only bug-fix and polish PRs.
No new features, no new dependencies. Last 2 hours: no code, rehearse.

### Command cheat sheet

| When | Command (run inside the worktree folder unless noted) |
|---|---|
| Before a new task (main folder) | `git checkout main && git pull` |
| See what changed | `git status` / `git log --oneline -5` |
| Run checks | `npm run lint && npx tsc --noEmit && npm run build` |
| Run the app | `npm run dev -- -p <port>` |
| First push of a branch | `git push -u origin HEAD` |
| Later pushes | `git push` |
| Open a PR | `gh pr create --fill` |
| See open PRs | `gh pr list` |
| Check out a teammate's PR | `gh pr checkout <number>` |
| Merge a PR (MASTER) | `gh pr merge <number> --squash --delete-branch` |
| Sync with main | `git pull --no-rebase origin main` |
| Read preview comments | `vercel comments` |
| Get env vars | `vercel env pull .env.local` |
| List / remove worktrees | `git worktree list` / `git worktree remove <path>` |

---

## Rules for everyone (tomorrow too)

- Never push to main. Everything goes through PRs.
- One Codex thread per worktree. Don't run two agents in the same folder.
- Only edit files in your area (see Ownership in AGENTS.md).
- Default model: Terra. Luna for small fixes. Sol only for planning and hard bugs.
- No fast mode. Use cloud tasks sparingly (~5x the cost of a local message).
- Check the usage page around midday.
- Never paste keys in chat. Use `vercel env pull .env.local`.

---

## Message for MASTER to send FRIENDS

    Setup for tomorrow. Please do this tonight:

    1. Install tools: Node 20+ (LTS from nodejs.org), git, GitHub CLI
       (Mac: brew install gh / Windows: winget install GitHub.cli). Then:
         gh auth login        (GitHub.com -> HTTPS -> browser)
         npm i -g vercel
         vercel login         (continue with GitHub)
    2. Codex app: install, sign in with the ChatGPT account that shows
       2,500 credits on the usage page.
    3. Vercel: sign up at vercel.com with GitHub. Send me the email you used.
    4. Wait for my invites and accept both:
         - GitHub repo invite (email or github.com/notifications)
         - Vercel team invite (email)
    5. When I say go, follow "Step 8 - Dry run" in SETUP.md.

    Don't create your own Supabase or Vercel project, and never push to main.
