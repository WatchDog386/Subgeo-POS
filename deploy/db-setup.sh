#!/usr/bin/env bash
# Database setup + verification + nightly backup for the Subgeo-POS server.
# Run ONCE after deploy.sh has started the app:
#   cd ~/Subgeo-POS && sudo bash deploy/db-setup.sh
#
# Idempotent: verifies the SQLite schema, and installs a daily 02:47 backup
# cron keeping the newest 14 snapshots. Re-running is always safe.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="${SUDO_USER:-$USER}"
APP_HOME="$(getent passwd "${APP_USER}" | cut -d: -f6)"
export PATH="/usr/bin:${PATH}"   # cron needs plain node/tsx on PATH

echo "==> driving out of ${REPO} as ${APP_USER}"
sudo -u "${APP_USER}" bash -lc "cd '${REPO}' && npm run db:migrate"
sudo -u "${APP_USER}" bash -lc "cd '${REPO}' && ./node_modules/.bin/tsx scripts/db-status.ts"

echo "==> install nightly backup cron (/etc/cron.d/subgeo-pos-backup, daily 02:47)"
sudo tee /etc/cron.d/subgeo-pos-backup >/dev/null <<EOF
# Nightly backup of the Subgeo-POS SQLite database; keeps 14 days.
SHELL=/bin/bash
PATH=/usr/bin:/usr/local/bin
47 2 * * * ${APP_USER} cd '${REPO}' && ./node_modules/.bin/tsx scripts/backup-db.ts >> '${REPO}/backups/backup.log' 2>&1
EOF
sudo chmod 644 /etc/cron.d/subgeo-pos-backup

echo "==> run the first backup now"
sudo -u "${APP_USER}" bash -lc "cd '${REPO}' && ./node_modules/.bin/tsx scripts/backup-db.ts"

echo
echo "==> Database is set up."
echo "    file:     ${APP_HOME}/Subgeo-POS/data/subgeo.db"
echo "    backups:  ${APP_HOME}/Subgeo-POS/backups/ (daily, 14 kept, log in backup.log)"
echo "    check:    bash -lc \"cd ~/Subgeo-POS && ./node_modules/.bin/tsx scripts/db-status.ts\""
