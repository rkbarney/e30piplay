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

# Deploy the app, but preserve any existing emulatorjs/ directory inside
# WEB_ROOT — it is not in dist/ when build ran without install-emulatorjs.sh.
rsync -a --delete --exclude emulatorjs "$APP_DIR/dist/" "$WEB_ROOT/"

# If the build included emulatorjs/ (install-emulatorjs.sh was run before
# npm run build), re-sync it.  This is a no-op if the dir doesn't exist.
if [[ -d "$APP_DIR/dist/emulatorjs" ]]; then
  rsync -a --delete "$APP_DIR/dist/emulatorjs/" "$WEB_ROOT/emulatorjs/"
fi

# Restart the API server AFTER this request returns. carplay-server is the very
# process handling POST /api/update (this script runs inside that request), so a
# synchronous `systemctl restart s52-carplay` here tears down the connection
# before the success response is sent — the UI then shows a false "update failed"
# ("lost connection during restart?"). Schedule the restart on a short transient
# timer, OUTSIDE this service's cgroup, so the response + the SPA's self-reload
# land first. (UI assets are already live from the rsync above; this restart only
# matters when carplay-server.cjs itself changed.)
if command -v systemd-run >/dev/null 2>&1; then
  systemd-run --collect --on-active=4 systemctl restart s52-carplay >/dev/null 2>&1
else
  setsid bash -c 'sleep 4; systemctl restart s52-carplay' </dev/null >/dev/null 2>&1 &
fi
