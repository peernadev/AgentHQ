# AGENTS.md: AgentHQ

Read this before every task. Keep changes small and focused.

## Project
- AgentHQ: a live dashboard plus a task queue that coordinates many AI coding agents
  across a hackathon team's laptops. An orchestrator agent drafts modular tasks; worker
  agents claim them, build them and open PRs.
- Spec: SPEC.md (it changes during the day; re-read it at the start of each task).
  The demo flow in SPEC.md is the top priority.
- Contracts: `src/types/api.ts` and `supabase/schema.sql`. Never change them silently.

## Stack
- Next.js (App Router) + TypeScript, Tailwind, shadcn/ui (Sonner for toasts)
- Supabase: Postgres + Realtime. The browser uses the publishable key (read-only via RLS).
  API routes use the secret key (`src/lib/server/`). Never import server code in client components.
- Vercel; every PR gets a preview URL
- `cli/hq.mjs`: plain Node 20, **no npm dependencies** (uses built-in fetch)

## Commands
- Install: `npm install` · Dev: `npm run dev -- -p $PORT`
- Checks: `npm run lint && npx tsc --noEmit && npm run build`
- CLI: `node cli/hq.mjs <command>` (see SPEC.md §9)

## Ownership (only edit files in your area)
- A, dashboard: `src/app/(dashboard)/**`, `src/components/**`, `src/lib/mocks/**`
- B, backend: `supabase/**`, `src/app/api/**`, `src/lib/server/**`
- C, agents + demo: `cli/**`, `prompts/**`, `scripts/seed*`, `README.md`
- Shared (announce first, tiny separate PR): `src/types/**`, `package.json`,
  `src/app/layout.tsx`, `src/app/globals.css`, tailwind config, `AGENTS.md`, `SPEC.md`
- **If you're running an AgentHQ task, its `scope` overrides the list above:** edit
  only inside the task's scope.

If a task needs a file outside your area or scope, stop and say so instead of editing it.

## Git rules
- Your own branch only. Never commit or push to `main`. Never force-push.
- Commit after each small working step (`feat: agent card shows heartbeat age`).
- Before a PR: lint, typecheck and build must pass. Open with `gh pr create`.
- PRs under ~300 changed lines when possible.
- Sync: `git pull --no-rebase origin main`; resolve conflicts, rerun checks, explain.
- One task per branch. After a merge, start a new branch from the latest main.

## Feedback loop
- Teammates comment on the PR preview with the Vercel Toolbar.
- "Address feedback" means: run `vercel comments`, fix each comment, reply, resolve, push.
- After visual changes, check desktop and 375px mobile.

## Design rules (DESIGN.md is a living file)
- Follow "Decided" in DESIGN.md. "Exploring" is open.
- shadcn components + Tailwind tokens, no inline hex colors.
- When asked for options, build variants at `/lab/v1..v3` without touching real pages.
- When a visual decision is made, apply it and add one line to "Decided".
- Keep styling in theme tokens and shared components so a late restyle is a small edit.
- Dashboard must read well on a projector: large status colors, no tiny text.

## Don'ts
- No new dependencies without a reason (B or C only). None at all in `cli/`.
- No secrets in code or commits. `.env.local` and `.hq.json` are gitignored.
- Don't refactor code you weren't asked to touch.
- After 2 failed attempts at the same thing, stop and report what you tried.
