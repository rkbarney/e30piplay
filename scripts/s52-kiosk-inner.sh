#!/bin/bash
# Chromium kiosk inside cage (Pi OS Lite). Invoked as: cage -- this-script
# Reads ~/.config/s52-display-layout.conf for kiosk URL / exit port.

set -euo pipefail

CONFIG="${HOME}/.config/s52-display-layout.conf"
if [[ -f "$CONFIG" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG"
fi

: "${S52_KIOSK_EXIT_PORT:=8765}"
: "${S52_KIOSK_URL:=http://localhost}"
: "${S52_HTTP_RETRIES:=90}"
: "${S52_KIOSK_STATIC_ROOT:=${HOME}/e30piplay/dist}"
: "${S52_CHROMIUM_USER_DATA_DIR:=${HOME}/.local/share/s52-kiosk-chromium}"
mkdir -p "${S52_CHROMIUM_USER_DATA_DIR}"

STATIC_SRV_PID=""
if [[ -n "${S52_KIOSK_STATIC_PORT:-}" ]] && [[ -d "${S52_KIOSK_STATIC_ROOT}" ]]; then
  ( cd "${S52_KIOSK_STATIC_ROOT}" && exec python3 -m http.server "${S52_KIOSK_STATIC_PORT}" ) >>/tmp/s52-kiosk-static.log 2>&1 &
  STATIC_SRV_PID=$!
  sleep 0.4
  S52_KIOSK_URL="http://127.0.0.1:${S52_KIOSK_STATIC_PORT}"
fi

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
LAUNCH_DIR="$(cd "$(dirname -- "$SCRIPT_PATH")" && pwd)"
EXIT_PY="${LAUNCH_DIR}/s52-kiosk-exit-server.py"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

for ((i = 1; i <= 120; i++)); do
  if [[ -d "$XDG_RUNTIME_DIR" ]] && [[ -w "$XDG_RUNTIME_DIR" ]]; then
    break
  fi
  sleep 0.25
done
if [[ ! -d "$XDG_RUNTIME_DIR" ]] || [[ ! -w "$XDG_RUNTIME_DIR" ]]; then
  echo "s52-kiosk-inner: XDG_RUNTIME_DIR not usable: ${XDG_RUNTIME_DIR}" >&2
  exit 1
fi

KIOSK_PID_FILE="${XDG_RUNTIME_DIR}/s52-kiosk-chromium.pid"
EXIT_SERVER_PID=""
CHROMIUM_PID=""

cleanup() {
  [[ -n "${STATIC_SRV_PID:-}" ]] && kill "${STATIC_SRV_PID}" 2>/dev/null || true
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

CHROMIUM_BIN=""
for cand in /usr/lib/chromium/chromium /usr/lib/chromium-browser/chromium-browser; do
  if [[ -x "$cand" ]]; then
    CHROMIUM_BIN="$cand"
    break
  fi
done
if [[ -z "${CHROMIUM_BIN}" ]]; then
  echo "s52-kiosk-inner: no Chromium binary found under /usr/lib (install chromium package)" >&2
  exit 1
fi

# Do not use /usr/bin/chromium — on Debian/Pi it can be a wrapper that runs systemd-inhibit
# (PolKit fails under systemd → exit 1 → kiosk restart loop).
# Do not wrap with systemd-inhibit in this script either (same PolKit issue).

"${CHROMIUM_BIN}" \
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
  --default-background-color=000000 \
  "${KIOSK_URL_WITH_EXIT}" &

CHROMIUM_PID=$!
echo "${CHROMIUM_PID}" > "${KIOSK_PID_FILE}"
wait "${CHROMIUM_PID}"
