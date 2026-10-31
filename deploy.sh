#!/usr/bin/env bash
# Deploy the latest code from GitHub — run this after every push:
#   cd ~/Subgeo-POS && bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "==> git pull"
git pull --ff-only

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
