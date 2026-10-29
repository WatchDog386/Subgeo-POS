#!/usr/bin/env bash
# One-time HTTPS hosting setup for pos.subgeoholding.com.
# Run ONCE (as a sudo-capable user):
#   cd ~/Subgeo-POS && sudo bash deploy/host.sh
#
# Prerequisites:
#   - deploy/provision.sh already ran (Node 22 + pm2), and deploy.sh ran at
#     least once so the app answers on http://127.0.0.1:8787
#   - DNS record: pos.subgeoholding.com A -> this server's public IPv4
set -euo pipefail

DOMAIN="pos.subgeoholding.com"
CONF_SRC="$(cd "$(dirname "$0")" && pwd)/nginx-pos.conf"

if [ "$(id -u)" -eq 0 ]; then
  echo "==> (running as root)" >&2
fi

echo "==> check DNS for ${DOMAIN}"
if ! getent hosts "${DOMAIN}" >/dev/null; then
  echo "ERROR: ${DOMAIN} does not resolve yet. Add the A record pointing to"
  echo "       this server's public IPv4 in your DNS host, wait a few minutes,"
  echo "       then re-run this script." >&2
  exit 1
fi
SRV_IP="$(curl -fs4 -m 5 https://api.ipify.org || true)"
DNS_IP="$(getent ahostsv4 "${DOMAIN}" | awk '{print $1; exit}')"
if [ -n "${SRV_IP}" ] && [ "${SRV_IP}" != "${DNS_IP}" ]; then
  echo "WARNING: ${DOMAIN} resolves to ${DNS_IP} but this server's public IP appears to be ${SRV_IP}."
  echo "         If that is wrong, fix the DNS record first (certbot will fail otherwise)." >&2
  echo "         Continuing anyway..." >&2
  sleep 3
fi

echo "==> install nginx + certbot"
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx

echo "==> install site config"
cp "${CONF_SRC}" /etc/nginx/sites-available/subgeo-pos
ln -sf /etc/nginx/sites-available/subgeo-pos /etc/nginx/sites-enabled/subgeo-pos
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> health check behind nginx"
sleep 1
curl -s "http://${DOMAIN}/api/health" || echo "(app not answering yet — check: pm2 logs subgeo-pos --lines 30)"

echo "==> Let's Encrypt certificate for ${DOMAIN}"
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email 2>/dev/null \
  || certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --email subgeo360@gmail.com

echo
echo "==> Done: https://${DOMAIN}"
echo "    Certificates auto-renew via certbot's systemd timer."
