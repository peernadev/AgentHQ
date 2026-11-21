# AgentHQ: setup + workflow for teammates (Codex users)

Eran (MASTER) has already set up GitHub, Supabase and Vercel. You only set up
your own laptop. ~20 minutes.

Windows notes:
- Use **Git Bash** (right-click a folder -> "Open Git Bash here") for the commands
  below. Every command works there as written. (In old PowerShell, `&&` fails;
  run the parts on separate lines.)
- Mac: use Terminal.

---

## 1. Install tools (10 min)

Check:

    node -v        # need v20 or newer
    git --version
    gh --version

- Node missing/old: nodejs.org -> LTS -> install -> reopen your terminal
- Git missing (Windows): git-scm.com -> install (this also gives you Git Bash)
- gh missing: Mac `brew install gh` · Windows (PowerShell) `winget install GitHub.cli`

Log in to GitHub:

    gh auth login

Choose GitHub.com -> HTTPS -> Yes -> Login with a web browser -> paste the code -> Authorize.

Codex app: install it and click **Sign in with ChatGPT**.

**Using Claude Code instead of Codex?** That's fine. It reads `CLAUDE.md`, which
loads `AGENTS.md`, so you follow the same rules. Differences:
- Install: Mac `curl -fsSL https://claude.ai/install.sh | bash` · Windows (PowerShell)
  `irm https://claude.ai/install.ps1 | iex`. Run `claude` once to log in (needs Claude Pro or higher).
- Wherever this guide says "Codex: new thread -> Worktree -> Terra", instead open a
  **new terminal tab** in the agenthq folder and run `claude -w <short-task-name>`
  (each task gets its own worktree and branch). Paste the same prompts.
- Models: Sonnet by default, Opus (`/model`) only for planning or hard bugs. `/clear` between tasks.
- Don't press Esc while it's installing or building; long steps can be silent for minutes.

## 2. Accept the GitHub invite

Check your email or github.com/notifications for an invite to `peernadev/agenthq`,
and click **Accept**.

## 3. Get the code + secrets

    cd ~
    gh repo clone peernadev/agenthq
    cd agenthq
    npm install

Create `.env.local` in the agenthq folder with the 4 lines Eran sends you
**privately** (DM, not the group chat):

    NEXT_PUBLIC_SUPABASE_URL=...
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
    SUPABASE_SECRET_KEY=...
    TEAM_JOIN_CODE=...

Windows: `notepad .env.local` · Mac: `open -e .env.local` (create it if asked).
Never commit this file (it's already gitignored) and never paste it anywhere.

Check:

    npm run dev

Open http://localhost:3000 -> "API: ok". Ctrl+C to stop.

## 4. Dry run (when Eran says go)

Codex app -> **Add project** -> select the `agenthq` folder -> new thread ->
mode **Worktree**, model **Terra** -> paste:

    Run scripts/setup-worktree.sh (use Git Bash on Windows). Then change the home
    page heading to "<your name> was here", run lint, typecheck and build, commit,
    push the branch, and open a PR with gh pr create.

Then on github.com -> agenthq -> **Pull requests** -> your PR:
1. Wait for the Vercel bot comment -> **Visit Preview** -> your change is live there
2. Open a teammate's preview and leave a comment **on their PR** (add a screenshot if it's visual)
3. On your own PR, tell your Codex thread:

       Read the PR comments with gh pr view --comments, address each one, reply
       briefly with gh pr comment, run checks, and push.

Eran merges. Done.

---

## How we work all day

### The loop (repeat; 30-90 min each)

    git pull main -> new Worktree thread -> plan -> agent builds + commits
    -> push + PR -> preview link -> comments -> agent fixes -> Eran merges -> next task

1. **Start a task.** In the agenthq folder: `git checkout main` then `git pull`.
   Codex: new thread -> **Worktree** -> **Terra**. First message:
   `Run scripts/setup-worktree.sh, then read AGENTS.md, SPEC.md and DESIGN.md.`
   Then: `Task: <small specific thing>. Stay in my area per AGENTS.md. Show me a short plan first. Commit after each working step.`
2. **Watch it locally.** The setup script prints a port, e.g. http://localhost:3017.
   Ask the agent to run `npm run dev -- -p <port>` and keep it running; the page
   updates live as it edits.
3. **Push + PR** when the slice works (even ugly), when you want feedback, or every ~45 min:
   `Run lint, typecheck and build. If they pass, push and open a PR with gh pr create.`
   Post the PR link in the group chat.
4. **Feedback** = comments on the PR (screenshots for UI). The agent fixes them (prompt above).
   Every push updates the same PR and preview.
5. **Eran merges.** When someone posts "merged", sync your open branch:
   `Pull latest main with git pull --no-rebase origin main, resolve conflicts, run checks, push.`
6. **Next task** = new thread from fresh main. Don't reuse a thread for a new task.

Once AgentHQ works (~hour 3), step 1 becomes: new Worktree thread -> paste
`prompts/worker.md` -> the agent pulls tasks from the queue by itself.

### Rules
- Never push to main. Everything goes through PRs.
- One thread per worktree. Two parallel tasks = two threads.
- Only edit your area (see Ownership in AGENTS.md), or the task's scope once AgentHQ runs.
- Shared files (src/types, supabase, package.json, layout, globals.css): announce in chat first.
- Codex: Terra by default, Sol for planning or hard bugs. Claude Code: Sonnet by default, Opus for planning.

### Where to look
| What | Where |
|---|---|
| Your work in progress | http://localhost:<your worktree port> |
| A PR (yours or a teammate's) | "Visit Preview" link in the Vercel bot comment on the PR |
| The real product (merged main) | the production URL Eran shares |
| What's open | github.com -> agenthq -> Pull requests |
