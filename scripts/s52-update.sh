#!/usr/bin/env bash
# Pull the latest app from GitHub, rebuild, and deploy. Runs as the kiosk user
# (unprivileged); the only privileged step (rsync into /var/www + restart) is
# delegated to /usr/local/bin/s52-deploy.sh via sudo -n.
#
# Invoked by carplay-server.cjs on POST /api/update, or by hand on the Pi.
# Progress is written to stdout so the UI can show a log.
set -euo pipefail

# Exported so `sudo -n s52-deploy.sh` inherits it (env_keep in the sudoers file).
export APP_DIR="${APP_DIR:-$HOME/e30piplay}"
DEPLOY="${S52_DEPLOY_BIN:-/usr/local/bin/s52-deploy.sh}"

step() { echo "==> $*"; }

cd "$APP_DIR"

# The Pi has known locally-modified files (see HANDOFF.md). Refuse rather than
# clobber them — let the user resolve over SSH.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree has local changes — refusing to update." >&2
  echo "Resolve them over SSH (git status), then retry." >&2
  git status --short >&2
  exit 2
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
