#!/usr/bin/env bash
# Run ON THE PI (copy-paste once over SSH). Fixes kiosk launcher + restarts service.
set -euo pipefail
REPO="${HOME}/e30piplay"
SCRIPT_SRC="${REPO}/scripts/s52-kiosk-inner.sh"
DST="${HOME}/.local/bin/s52-kiosk-inner.sh"

if [[ ! -f "$SCRIPT_SRC" ]]; then
  echo "Missing ${SCRIPT_SRC} — clone/pull repo first:" >&2
  echo "  cd ~ && git clone -b experiment/pios-lite-cage https://github.com/rkbarney/e30piplay.git e30piplay" >&2
  echo "  # or: cd ~/e30piplay && git pull" >&2
  exit 1
fi

install -m 755 "$SCRIPT_SRC" "$DST"
if grep -q 'INHIBIT_CMD' "$DST"; then
  echo "ERROR: ${DST} still contains INHIBIT_CMD — repo may be stale. git pull and retry." >&2
  exit 1
fi
if grep -qE '^[[:space:]]*[^#]*systemd-inhibit[[:space:]]' "$DST"; then
  echo "ERROR: ${DST} still invokes systemd-inhibit." >&2
  exit 1
fi

sudo systemctl daemon-reload
sudo systemctl restart s52-cage-kiosk
sleep 2
systemctl is-active --quiet s52-cage-kiosk && echo "s52-cage-kiosk: active" || echo "s52-cage-kiosk: NOT active — run: journalctl -u s52-cage-kiosk -n 40 --no-pager"
