#!/bin/bash
# Invoked via sudo -n by carplay-server.cjs (NOPASSWD in /etc/sudoers.d/s52-carplay-launcher).
# Both Chromium kiosk and react-carplay live as wayland clients of one labwc
# compositor (see scripts/s52-labwc-autostart.sh). Switching is just a wlrctl
# focus/minimize on the react-carplay toplevel — instant, no service churn.
set -euo pipefail

# sudoers preserves WAYLAND_DISPLAY/XDG_RUNTIME_DIR; fall back for SSH usage.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"

# sudo runs this as root; read receiver from the kiosk user's env file without
# sourcing it (user-writable — must not execute arbitrary shell as root).
S52_USER="${SUDO_USER:-${USER:-admin}}"
RECEIVER_ENV="/home/${S52_USER}/.config/s52-carplay-receiver.env"
CARPLAY_APP_ID="react-carplay"
if [[ -r "${RECEIVER_ENV}" ]]; then
  _receiver="$(grep -E '^S52_CARPLAY_RECEIVER=' "${RECEIVER_ENV}" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "\"'")"
  case "${_receiver}" in
    livi) CARPLAY_APP_ID="dev.f-io.livi" ;;
    react-carplay) CARPLAY_APP_ID="react-carplay" ;;
  esac
fi
unset _receiver

case "${1:-}" in
  launch)
    /usr/bin/wlrctl toplevel focus "app_id:${CARPLAY_APP_ID}"
    ;;
  return)
    /usr/bin/wlrctl toplevel minimize "app_id:${CARPLAY_APP_ID}"
    ;;
  *)
    echo "usage: $0 launch|return" >&2
    exit 1
    ;;
esac
