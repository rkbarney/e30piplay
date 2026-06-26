#!/usr/bin/env bash
# Discard all local changes in the Pi clone (tracked edits + untracked files).
# The kiosk repo should never keep on-device edits — force update/switch uses this.
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/e30piplay}"
cd "$APP_DIR"

if [[ -z "$(git status --porcelain)" ]]; then
  exit 0
fi

echo "==> Discarding local changes"
git status --short
git restore .
git clean -fd
