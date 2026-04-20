#!/bin/bash
# S52 kiosk: optional Wayland layout (wlr-randr), warp pointer to car output so the
# new window opens there, localhost exit helper, then Chromium.
# Override defaults in ~/.config/s52-display-layout.conf (KEY=value, one per line):
#   S52_WLR_OUTPUT=HDMI-A-2   # car panel on Pi 5 "HDMI 2" — check: wlr-randr
#   S52_WLR_MODE=1280x720
#   S52_WLR_TRANSFORM=90
#   S52_LAYOUT_DELAY=2
#   S52_WARP_CURSOR_TO_KIOSK_OUTPUT=1   # 0 to disable (window may open on wrong monitor)
#   S52_KIOSK_EXIT_PORT=8765
# Optional: serve dist/ without nginx sudo (set port + root; overrides S52_KIOSK_URL):
#   S52_KIOSK_STATIC_PORT=8899
#   S52_KIOSK_STATIC_ROOT=/home/admin/tinycarplay/dist
#   S52_KIOSK_URL=http://localhost   # default page URL (auto-set when STATIC_PORT is set)
# Use S52_WLR_TRANSFORM=normal for no rotation. If a mode string fails, edit S52_WLR_MODE to match: wlr-randr

CONFIG="${HOME}/.config/s52-display-layout.conf"
if [[ -f "$CONFIG" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG"
fi

: "${S52_WLR_OUTPUT:=HDMI-A-1}"
: "${S52_WLR_MODE:=1280x720}"
: "${S52_WLR_TRANSFORM:=90}"
: "${S52_LAYOUT_DELAY:=2}"
: "${S52_HTTP_RETRIES:=90}"
: "${S52_WARP_CURSOR_TO_KIOSK_OUTPUT:=1}"
: "${S52_KIOSK_EXIT_PORT:=8765}"
: "${S52_KIOSK_URL:=http://localhost}"
: "${S52_KIOSK_STATIC_ROOT:=${HOME}/tinycarplay/dist}"
# Separate profile so kiosk does not attach to an existing Chromium (e.g. Cursor).
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
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
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

if command -v wlr-randr &>/dev/null; then
  sleep "$S52_LAYOUT_DELAY"
  wlr-randr --output "$S52_WLR_OUTPUT" --transform "$S52_WLR_TRANSFORM" --mode "$S52_WLR_MODE" 2>/dev/null || \
  wlr-randr --output "$S52_WLR_OUTPUT" --transform "$S52_WLR_TRANSFORM" 2>/dev/null || \
  wlr-randr --output "$S52_WLR_OUTPUT" --mode "$S52_WLR_MODE" 2>/dev/null || true
fi

if [[ "${S52_WARP_CURSOR_TO_KIOSK_OUTPUT}" == "1" ]] && command -v xdotool &>/dev/null && command -v wlr-randr &>/dev/null; then
  coords="$(
    S52_WLR_OUTPUT="${S52_WLR_OUTPUT}" python3 <<'PY' 2>/dev/null || true
import json, os, subprocess, sys
try:
    out = os.environ["S52_WLR_OUTPUT"]
    data = json.loads(subprocess.check_output(["wlr-randr", "--json"], timeout=3))
except Exception:
    sys.exit(1)
for m in data:
    if m.get("name") != out or not m.get("enabled"):
        continue
    pos = m["position"]
    t = str(m.get("transform", "normal"))
    modes = m.get("modes") or []
    mode = next((x for x in modes if x.get("current")), modes[0] if modes else None)
    if not mode:
        sys.exit(1)
    w, h = int(mode["width"]), int(mode["height"])
    lw, lh = (h, w) if t in ("90", "270") else (w, h)
    print(pos["x"] + lw // 2, pos["y"] + lh // 2)
    break
else:
    sys.exit(1)
PY
  )"
  if [[ -n "${coords}" ]]; then
    read -r _cx _cy <<< "${coords}"
    DISPLAY="${DISPLAY:-:0}" xdotool mousemove --sync "${_cx}" "${_cy}" 2>/dev/null || true
  fi
fi

sleep 1
killall wf-panel-pi 2>/dev/null || true
killall lxpanel 2>/dev/null || true
killall pcmanfm 2>/dev/null || true
sleep 0.5
xset s off 2>/dev/null || true
xset -dpms 2>/dev/null || true
xset s noblank 2>/dev/null || true
unclutter -idle 0.1 -root 2>/dev/null &

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

# Wait until the page URL responds (nginx or embedded static server).
for ((i = 1; i <= S52_HTTP_RETRIES; i++)); do
  if curl -sf -o /dev/null --connect-timeout 1 --max-time 3 "${S52_KIOSK_URL}/" 2>/dev/null; then
    break
  fi
  sleep 1
done

# Debian's /usr/bin/chromium wrapper can inject unsupported JS flags on some
# Pi kernels/page sizes. Prefer direct binary when available.
CHROMIUM_BIN="chromium"
if [[ -x "/usr/lib/chromium/chromium" ]]; then
  CHROMIUM_BIN="/usr/lib/chromium/chromium"
fi

"${CHROMIUM_BIN}" \
  --user-data-dir="${S52_CHROMIUM_USER_DATA_DIR}" \
  --password-store=basic \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --disable-restore-session-state \
  --disable-session-crashed-bubble \
  --check-for-update-interval=31536000 \
  "${KIOSK_URL_WITH_EXIT}" &

CHROMIUM_PID=$!
echo "${CHROMIUM_PID}" > "${KIOSK_PID_FILE}"
wait "${CHROMIUM_PID}"
