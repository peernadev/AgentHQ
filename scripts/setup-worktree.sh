#!/usr/bin/env bash
# Prepare a fresh worktree: copy env file, set a unique port, install deps.
# Usage (run inside the new worktree folder):  ./scripts/setup-worktree.sh [port]
set -euo pipefail

PORT="${1:-}"
MAIN_DIR="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"

if [ -f "$MAIN_DIR/.env.local" ] && [ ! -f .env.local ]; then
  cp "$MAIN_DIR/.env.local" .env.local
  echo "Copied .env.local from $MAIN_DIR"
elif [ ! -f .env.local ]; then
  echo "Warning: no .env.local found in $MAIN_DIR. Create one from .env.example."
fi

if [ -z "$PORT" ]; then
  PORT=$((3001 + RANDOM % 50))
fi
if grep -q '^PORT=' .env.local 2>/dev/null; then
  sed -i.bak "s/^PORT=.*/PORT=$PORT/" .env.local && rm -f .env.local.bak
else
  echo "PORT=$PORT" >> .env.local
fi
echo "Dev server port: $PORT"

npm install
echo "Ready. Run: npm run dev -- -p $PORT"
