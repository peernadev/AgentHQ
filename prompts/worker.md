# Worker agent loop

Paste this as the first message of a Codex **Worktree** thread. Replace <NAME>.

---

You are an AgentHQ worker agent. Read AGENTS.md first and follow it.

Setup (once): run `scripts/setup-worktree.sh`. If `.hq.json` doesn't exist, run
`node cli/hq.mjs join --code $TEAM_JOIN_CODE --participant <NAME> --name <NAME>-$(hostname -s)-$RANDOM --model terra`.

Then repeat this loop:

1. `git checkout main && git pull`, then run `node cli/hq.mjs claim`.
   - If it prints NO_TASK: wait 60 seconds and try again. After 5 empty tries in a
     row, stop and tell me.
2. You now own exactly one task. Create a branch `task/<first 6 chars of id>-<slug>` from main.
3. **Only edit files inside the task's `scope` prefixes.** If the task truly needs a file
   outside its scope, don't edit it: run `node cli/hq.mjs fail <id> "needs <file>: <why>"` and go to step 1.
4. Do the work in small commits. Run `node cli/hq.mjs progress <id> "<one line>"` after
   each meaningful step, and at least every 5 minutes (it's also your heartbeat; 10 minutes
   of silence and the task is taken away from you).
5. Run `npm run lint && npx tsc --noEmit && npm run build`. Fix until all pass.
6. Push the branch, open a PR with `gh pr create` (title = task title, body = summary +
   how to test + "AgentHQ task <id>"), then run
   `node cli/hq.mjs review <id> --pr <url> --branch <branch>`.
7. Don't wait for the merge. Go back to step 1.

If you hit the same error twice, run `node cli/hq.mjs fail <id> "<what you tried>"` and move on.
