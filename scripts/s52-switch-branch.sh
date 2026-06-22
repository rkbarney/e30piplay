#!/usr/bin/env bash
# Switch the Pi to a different origin branch, then rebuild + deploy. Runs as the
# kiosk user; the only privileged step (rsync into /var/www + restart) is the
# already-allow-listed /usr/local/bin/s52-deploy.sh via sudo -n.
#
# Invoked by carplay-server.cjs on POST /api/switch-branch (branch validated
# there and passed as argv), or by hand:  bash scripts/s52-switch-branch.sh <branch>
set -euo pipefail

export APP_DIR="${APP_DIR:-$HOME/e30piplay}"
DEPLOY="${S52_DEPLOY_BIN:-/usr/local/bin/s52-deploy.sh}"
BRANCH="${1:?usage: s52-switch-branch.sh <branch>}"

# Defense in depth — the server validates too, but never trust the caller.
if [[ ! "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "Invalid branch name: $BRANCH" >&2
  exit 2
fi

step() { echo "==> $*"; }

cd "$APP_DIR"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree has local changes — refusing to switch." >&2
  echo "Resolve them over SSH (git status), then retry." >&2
  git status --short >&2
  exit 2
fi

step "Fetching from origin"
git fetch --quiet --prune origin

if ! git rev-parse --verify --quiet "origin/${BRANCH}" >/dev/null; then
  echo "No such branch on origin: ${BRANCH}" >&2
  exit 2
fi

step "Switching to ${BRANCH}"
git checkout -B "$BRANCH" "origin/${BRANCH}"

step "Installing dependencies (npm ci)"
npm ci

step "Building (npm run build)"
npm run build

step "Deploying (rsync + restart)"
sudo -n "$DEPLOY"

step "Switched to ${BRANCH} — now at $(git rev-parse --short HEAD)"
