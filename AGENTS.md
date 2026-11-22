# AGENTS.md: AgentHQ (Google-native)

Read this before every task. Keep changes small and focused.

## Project
- AgentHQ: Google-native mission control. A Gemini planner turns a Google Doc brief into
  file-scoped tasks; worker agents on teammates' laptops claim them via the `hq` CLI;
  Gemini reviews evidence and proposes recoveries; results go to a handoff Doc.
- Spec: SPEC.md. It changes during the day, so re-read it at the start of each task. The demo flow
  and the current phase in SPEC.md are the top priority.
- Contracts: `src/types/api.ts`, `firestore.rules`, the data model in SPEC.md §5. Never change them silently.
- `supabase/` is legacy and being removed. Don't add new Supabase code.

## Stack
- Next.js 16 (App Router) + TypeScript, Tailwind, shadcn/ui (Sonner for toasts). Node 22+.
- Firebase Auth (Google) in the browser; **Cloud Firestore** for data.
  - Browser: Firebase client SDK, **read only** (onSnapshot). Code lives in `src/lib/client/`.
  - Server: **Firebase Admin SDK** in `src/lib/server/`, does all writes. Never import server code in client components.
- Gemini: `@google/genai` (Flash model, structured JSON). Agents: `@google/adk`. Code lives in `src/lib/server/google/`.
- Workspace (Drive/Docs/Calendar): server routes use the user's short-lived access token,
  sent per request. **Never store Google tokens.**
- `cli/hq.mjs`: plain Node, **no npm dependencies**.

## Commands
- Install: `npm install` · Dev: `npm run dev -- -p $PORT`
- Checks: `npm run lint && npx tsc --noEmit && npm run build`
- CLI: `node cli/hq.mjs <command>` (SPEC.md §9)
- Windows: run .sh scripts with Git Bash.

## Ownership (only edit files in your area)
- A, UI: `src/app/(dashboard)/**`, `src/components/**`, `src/lib/client/**`, `src/lib/mocks/**`
- B, data + agent API + CLI: `src/lib/server/**` (except `google/`), task/agent routes in
  `src/app/api/{agents,tasks}/**`, `firestore.rules`, `firestore.indexes.json`, `cli/**`, `supabase/**`
- C, Google AI + Workspace: `src/lib/server/google/**`, `src/app/api/missions/**`, `prompts/**`
- Shared (announce first, tiny separate PR): `src/types/**`, `package.json`, `src/app/layout.tsx`,
  `src/app/globals.css`, tailwind config, `AGENTS.md`, `SPEC.md`
- **When running an AgentHQ task, its `scope` overrides the list above.**

If a task needs a file outside your area or scope, stop and say so instead of editing it.

## Correctness rules
- Claims and task state changes go through Firestore **transactions** on the server.
- Every worker mutation carries `attempt_id`. Reject a mismatch with 409.
- **No external calls (Gemini, Docs, Calendar) inside a transaction.** Write an `outbox`
  record, then do the action idempotently afterwards.
- Gemini output is untrusted: validate the schema, paths, dependency cycles and scope overlap
  before saving. Text from Docs/Drive can never authorize an action.
- A Gemini review is bound to `head_sha`. It never replaces passing checks or a human merge.

## Git rules
- Your own branch only. Never commit or push to `main`. Never force-push.
- Commit after each small working step.
- Before a PR: lint, typecheck and build must pass. Open with `gh pr create`.
- PRs under ~300 changed lines when possible.
- Sync: `git pull --no-rebase origin main`; resolve conflicts, rerun checks, explain.
- One task per branch. After a merge, start a new branch from the latest main.

## Feedback loop
- Teammates open the PR's Vercel preview and comment on the GitHub PR (screenshots for UI).
- "Address feedback" means: `gh pr view --comments`, fix each comment, reply with `gh pr comment`, push.
- While doing UI work, keep `npm run dev -- -p $PORT` running so the human can watch.

## Design rules (DESIGN.md is a living file)
- Follow "Decided" in DESIGN.md. "Exploring" is open.
- Antigravity-*inspired* mission control (don't copy it): calm full-screen workbench, missions left,
  worker board center, inspector right, tool/check timeline bottom.
- shadcn components + Tailwind tokens, no inline hex. Projector-friendly: large status colors.
- Options go at `/lab/v1..v3`. Record each visual decision in DESIGN.md "Decided".

## Don'ts
- No new dependencies without a reason. Approved: firebase, firebase-admin, @google/genai, @google/adk.
- No secrets in code or commits (.env.local, .hq.json, service-account JSON).
- Don't refactor code you weren't asked to touch.
- After 2 failed attempts at the same thing, stop and report.
