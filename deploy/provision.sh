#!/usr/bin/env bash
# One-time server setup for the Subgeo-POS host (Ubuntu 22.04/24.04).
# Run ONCE as a sudo-capable user:
#   cd ~/Subgeo-POS && sudo bash deploy/provision.sh
#
# Installs Node.js 22 (required by Vite 8 / better-sqlite3 13) and pm2,
# then hands off to deploy.sh which installs, builds and starts the app.
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "==> (running as root)" >&2
fi

echo "==> apt update + curl"
apt-get update -y
apt-get install -y curl ca-certificates

echo "==> removing apt nodejs/npm (Node 18 is too old for this stack)"
if dpkg -l 2>/dev/null | grep -q '^ii  nodejs '; then
  apt-get purge -y nodejs nodejs-doc npm 2>/dev/null || true
  apt-get autoremove -y
else
  echo "    none installed — skipping"
fi

echo "==> installing Node.js 22 via NodeSource"
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node -v
npm -v

echo "==> installing pm2 globally"
npm install -g pm2

echo
echo "==> Setup done. Now start the app:"
echo "    cd ~/Subgeo-POS && bash deploy.sh"
echo
echo "After pm2 is running once, make it survive reboots (run as the app user):"
echo "    pm2 save"
echo "    pm2 startup systemd -u \$USER --hp \$HOME   # then run the sudo command it prints"
