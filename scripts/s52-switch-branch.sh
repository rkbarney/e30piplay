#!/usr/bin/env bash
# Switch the Pi to a different origin branch, then rebuild + deploy. Runs as the
# kiosk user; the only privileged step (rsync into /var/www + restart) is the
# already-allow-listed /usr/local/bin/s52-deploy.sh via sudo -n.
#
# Invoked by carplay-server.cjs on POST /api/switch-branch (branch validated
# there and passed as argv), or by hand:  bash scripts/s52-switch-branch.sh <branch> [--force]
set -euo pipefail

export APP_DIR="${APP_DIR:-$HOME/e30piplay}"
DEPLOY="${S52_DEPLOY_BIN:-/usr/local/bin/s52-deploy.sh}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANCH="${1:?usage: s52-switch-branch.sh <branch> [--force]}"
FORCE=0
if [[ "${2:-}" == --force ]]; then
  FORCE=1
fi

# Defense in depth — the server validates too, but never trust the caller.
if [[ ! "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "Invalid branch name: $BRANCH" >&2
  exit 2
fi

step() { echo "==> $*"; }

cd "$APP_DIR"

if [[ -n "$(git status --porcelain)" ]]; then
  if [[ "$FORCE" == 1 ]]; then
    bash "$SCRIPT_DIR/s52-git-discard-local.sh"
  else
    echo "Working tree has local changes — refusing to switch." >&2
    echo "Use FORCE UPDATE on the System screen, or: bash $0 $BRANCH --force" >&2
    git status --short >&2
    exit 2
  fi
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

# HAL voice is a separate Python sidecar (not part of npm build). Try to
# install/start it when this branch ships s52-hal-voice.py — non-fatal if
# system packages still need a one-time `sudo apt install`.
if [[ -f "$APP_DIR/scripts/s52-hal-voice.py" ]]; then
  step "HAL voice sidecar (if needed)"
  bash "$APP_DIR/scripts/s52-install-hal-voice.sh" || \
    echo "  NOTE: HAL voice not running — SSH in and run: bash $APP_DIR/scripts/s52-install-hal-voice.sh" >&2
fi

step "Switched to ${BRANCH} — now at $(git rev-parse --short HEAD)"
