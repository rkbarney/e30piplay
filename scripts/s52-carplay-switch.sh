#!/bin/bash
# Invoked via sudo -n by carplay-server.cjs (NOPASSWD in /etc/sudoers.d/s52-carplay-launcher).
# Both Chromium kiosk and react-carplay live as wayland clients of one labwc
# compositor (see scripts/s52-labwc-autostart.sh). Switching is just a wlrctl
# focus/minimize on the react-carplay toplevel — instant, no service churn.
set -euo pipefail

# sudo runs this as root; read receiver from the kiosk user's env file without
# sourcing it (user-writable — must not execute arbitrary shell as root).
S52_USER="${SUDO_USER:-${USER:-admin}}"
S52_UID="$(id -u "${S52_USER}" 2>/dev/null || true)"

# sudoers preserves WAYLAND_DISPLAY/XDG_RUNTIME_DIR; fall back for SSH usage.
# Never default to root's uid — root cannot open the kiosk user's Wayland socket.
if [[ -z "${XDG_RUNTIME_DIR:-}" && -n "${S52_UID}" ]]; then
  export XDG_RUNTIME_DIR="/run/user/${S52_UID}"
fi
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
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

wlrctl_toplevel() {
  /usr/bin/wlrctl toplevel "$@" "app_id:${CARPLAY_APP_ID}"
}

case "${1:-}" in
  launch)
    wlrctl_toplevel focus || {
      /usr/bin/wlrctl toplevel find "app_id:${CARPLAY_APP_ID}" >/dev/null || exit 1
    }
    # focus de-iconifies but may leave a partial window — maximize fills the panel.
    wlrctl_toplevel maximize || true
    ;;
  return)
    wlrctl_toplevel minimize || true
    ;;
  *)
    echo "usage: $0 launch|return" >&2
    exit 1
    ;;
esac
