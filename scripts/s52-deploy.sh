#!/usr/bin/env bash
# Privileged deploy step, invoked via `sudo -n` by scripts/s52-update.sh
# (NOPASSWD in /etc/sudoers.d/s52-carplay-launcher). Mirrors the
# s52-carplay-switch.sh pattern: keep the only root-requiring actions in one
# small, allow-listed script.
#
# Publishes the freshly built UI and restarts the API server. Does NOT restart
# s52-cage-kiosk: Vite emits hash-named assets, so the UI reloads itself to pick
# up the new build (avoids killing the compositor mid-request).
set -euo pipefail

APP_DIR="${APP_DIR:-/home/${SUDO_USER:-$(id -un)}/e30piplay}"
WEB_ROOT="${S52_WEB_ROOT:-/var/www/s52-display}"

if [[ ! -d "$APP_DIR/dist" ]]; then
  echo "No build at $APP_DIR/dist — run npm run build first." >&2
  exit 1
fi

rsync -a --delete "$APP_DIR/dist/" "$WEB_ROOT/"
systemctl restart s52-carplay
