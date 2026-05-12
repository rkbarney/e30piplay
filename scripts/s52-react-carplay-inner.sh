#!/bin/bash
# Run inside cage (same stack as Chromium kiosk). ExecStart: cage -- this-script
set -euo pipefail

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

LAUNCHER="${HOME}/.local/bin/react-carplay"
if [[ ! -x "$LAUNCHER" ]]; then
  echo "s52-react-carplay-inner: missing ${LAUNCHER} — run scripts/install-react-carplay-appimage.sh" >&2
  sleep 8
  exit 1
fi

exec "$LAUNCHER" --no-sandbox "$@"
