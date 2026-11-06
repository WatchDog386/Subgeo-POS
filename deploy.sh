#!/usr/bin/env bash
# Deploy the latest code from GitHub — run this after every push:
#   cd ~/Subgeo-POS && bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

# Always deploy exactly what was pushed to this branch (override with
# DEPLOY_BRANCH=...). The database (data/), .env and backups/ are not tracked
# by git, so they are never touched. Local edits to code files are stashed
# (git stash list), never thrown away.
BRANCH="${DEPLOY_BRANCH:-claude/epic-brahmagupta-itfscw}"
echo "==> git: deploying origin/$BRANCH"
git fetch origin "$BRANCH"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "    local changes to code files found: saving them with git stash"
  git stash push -m "deploy.sh $(date '+%Y-%m-%d %H:%M')"
fi
git checkout -B "$BRANCH" "origin/$BRANCH"
echo "    now at: $(git log --oneline -1)"

echo "==> npm install"
npm install

echo "==> npm run build"
npm run build

echo "==> .env"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    created .env from .env.example"
fi

echo "==> database migrations"
npm run db:migrate

echo "==> pm2 restart"
if pm2 list | grep -q "subgeo-pos"; then
  pm2 restart subgeo-pos --update-env
else
  pm2 start npm --name "subgeo-pos" -- run server:start
fi
pm2 save >/dev/null

echo "==> health check"
sleep 2
curl -s http://localhost:8787/api/health || echo "server not answering yet — check: pm2 logs subgeo-pos --lines 30"
echo
echo "==> Done: https://pos.subgeoholding.com"
