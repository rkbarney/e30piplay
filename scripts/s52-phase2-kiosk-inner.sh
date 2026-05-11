#!/bin/bash
# Chromium kiosk inside cage (Phase 2 — Pi OS Lite). Invoked as: cage -- this-script
# Reads ~/.config/s52-display-layout.conf for URL and exit port only (no wlr-randr).

set -euo pipefail

CONFIG="${HOME}/.config/s52-display-layout.conf"
if [[ -f "$CONFIG" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG"
fi

: "${S52_KIOSK_EXIT_PORT:=8765}"
: "${S52_KIOSK_URL:=http://localhost}"
: "${S52_HTTP_RETRIES:=90}"
: "${S52_CHROMIUM_USER_DATA_DIR:=${HOME}/.local/share/s52-kiosk-chromium}"
mkdir -p "${S52_CHROMIUM_USER_DATA_DIR}"

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
LAUNCH_DIR="$(cd "$(dirname -- "$SCRIPT_PATH")" && pwd)"
EXIT_PY="${LAUNCH_DIR}/s52-kiosk-exit-server.py"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# linger should create this at boot; wait briefly if systemd races ahead.
for ((i = 1; i <= 120; i++)); do
  if [[ -d "$XDG_RUNTIME_DIR" ]] && [[ -w "$XDG_RUNTIME_DIR" ]]; then
    break
  fi
  sleep 0.25
done
if [[ ! -d "$XDG_RUNTIME_DIR" ]] || [[ ! -w "$XDG_RUNTIME_DIR" ]]; then
  echo "s52-phase2-kiosk-inner: XDG_RUNTIME_DIR not usable: ${XDG_RUNTIME_DIR}" >&2
  exit 1
fi

KIOSK_PID_FILE="${XDG_RUNTIME_DIR}/s52-kiosk-chromium.pid"
EXIT_SERVER_PID=""
CHROMIUM_PID=""

cleanup() {
  [[ -n "${EXIT_SERVER_PID:-}" ]] && kill "${EXIT_SERVER_PID}" 2>/dev/null || true
  if [[ -n "${CHROMIUM_PID:-}" ]] && kill -0 "${CHROMIUM_PID}" 2>/dev/null; then
    kill "${CHROMIUM_PID}" 2>/dev/null || true
  fi
  rm -f "${KIOSK_PID_FILE}"
}
trap cleanup EXIT INT TERM

if [[ -f "${EXIT_PY}" ]]; then
  S52_KIOSK_PID_FILE="${KIOSK_PID_FILE}" S52_KIOSK_EXIT_PORT="${S52_KIOSK_EXIT_PORT}" \
    python3 "${EXIT_PY}" &
  EXIT_SERVER_PID=$!
fi

KIOSK_URL_WITH_EXIT="${S52_KIOSK_URL}"
if [[ "${KIOSK_URL_WITH_EXIT}" == *\?* ]]; then
  KIOSK_URL_WITH_EXIT="${KIOSK_URL_WITH_EXIT}&s52ExitPort=${S52_KIOSK_EXIT_PORT}"
else
  KIOSK_URL_WITH_EXIT="${KIOSK_URL_WITH_EXIT}?s52ExitPort=${S52_KIOSK_EXIT_PORT}"
fi

for ((i = 1; i <= S52_HTTP_RETRIES; i++)); do
  if curl -sf -o /dev/null --connect-timeout 1 --max-time 3 "${S52_KIOSK_URL}/" 2>/dev/null; then
    break
  fi
  sleep 1
done

CHROMIUM_BIN="chromium"
if [[ -x "/usr/lib/chromium/chromium" ]]; then
  CHROMIUM_BIN="/usr/lib/chromium/chromium"
fi

INHIBIT_CMD=( )
if command -v systemd-inhibit &>/dev/null; then
  INHIBIT_CMD=( systemd-inhibit --what=idle:sleep --who=s52-phase2 --why=kiosk --mode=block )
fi

# cage provides Wayland; Chromium must use ozone-wayland. --no-sandbox is typical in cage.
"${INHIBIT_CMD[@]}" "${CHROMIUM_BIN}" \
  --user-data-dir="${S52_CHROMIUM_USER_DATA_DIR}" \
  --password-store=basic \
  --ozone-platform=wayland \
  --no-sandbox \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --disable-restore-session-state \
  --disable-session-crashed-bubble \
  --disable-features=Translate \
  --check-for-update-interval=31536000 \
  "${KIOSK_URL_WITH_EXIT}" &

CHROMIUM_PID=$!
echo "${CHROMIUM_PID}" > "${KIOSK_PID_FILE}"
wait "${CHROMIUM_PID}"
