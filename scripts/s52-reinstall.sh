#!/usr/bin/env bash
# Pull the latest code, then re-run setup.sh as a full reinstall — picks up new
# apt packages, systemd units, sudoers, AppImage version bumps, etc., not just
# app code. (s52-update.sh is the lighter code-only path: git pull + build +
# deploy, no system-level changes.)
#
# Invoked by carplay-server.cjs on POST /api/reinstall, or by hand on the Pi.
# Pass --force to discard local changes first (safe on the kiosk clone).
# Reboot is a separate step (POST /api/reboot) — this script only reinstalls,
# so its log makes it back to the UI before anything restarts.
set -euo pipefail

export APP_DIR="${APP_DIR:-$HOME/e30piplay}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

FORCE=0
if [[ "${1:-}" == --force ]]; then
  FORCE=1
fi

step() { echo "==> $*"; }

cd "$APP_DIR"

if [[ -n "$(git status --porcelain)" ]]; then
  if [[ "$FORCE" == 1 ]]; then
    bash "$SCRIPT_DIR/s52-git-discard-local.sh"
  else
    echo "Working tree has local changes — refusing to reinstall." >&2
    echo "Use FORCE REINSTALL on the Settings screen, or: bash $SCRIPT_DIR/s52-reinstall.sh --force" >&2
    git status --short >&2
    exit 2
  fi
fi

step "Fetching from origin"
git fetch --quiet origin

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
step "Updating $BRANCH (fast-forward only)"
git pull --ff-only

step "Re-running setup.sh (packages, systemd units, AppImage, sudoers)"
bash "$APP_DIR/setup.sh"

step "Reinstall complete — now at $(git rev-parse --short HEAD). Reboot to apply everything."
