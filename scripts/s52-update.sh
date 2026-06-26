#!/usr/bin/env bash
# Pull the latest app from GitHub, rebuild, and deploy. Runs as the kiosk user
# (unprivileged); the only privileged step (rsync into /var/www + restart) is
# delegated to /usr/local/bin/s52-deploy.sh via sudo -n.
#
# Invoked by carplay-server.cjs on POST /api/update, or by hand on the Pi.
# Pass --force to discard any local changes first (safe on the kiosk clone).
# Progress is written to stdout so the UI can show a log.
set -euo pipefail

# Exported so `sudo -n s52-deploy.sh` inherits it (env_keep in the sudoers file).
export APP_DIR="${APP_DIR:-$HOME/e30piplay}"
DEPLOY="${S52_DEPLOY_BIN:-/usr/local/bin/s52-deploy.sh}"
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
    echo "Working tree has local changes — refusing to update." >&2
    echo "Use FORCE UPDATE on the System screen, or: bash $SCRIPT_DIR/s52-update.sh --force" >&2
    git status --short >&2
    exit 2
  fi
fi

step "Fetching from origin"
git fetch --quiet origin

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
step "Updating $BRANCH (fast-forward only)"
git pull --ff-only

step "Installing dependencies (npm ci)"
npm ci

step "Building (npm run build)"
npm run build

step "Deploying (rsync + restart)"
sudo -n "$DEPLOY"

step "Update complete — now at $(git rev-parse --short HEAD)"
