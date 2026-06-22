#!/bin/bash
# Invoked via sudo -n by carplay-server.cjs (NOPASSWD in /etc/sudoers.d/s52-carplay-launcher).
# Both Chromium kiosk and react-carplay live as wayland clients of one labwc
# compositor (see scripts/s52-labwc-autostart.sh). Switching is just a wlrctl
# focus/minimize on the react-carplay toplevel — instant, no service churn.
set -euo pipefail

APP_DIR="${APP_DIR:-/home/${SUDO_USER:-$(id -un)}/e30piplay}"

# Self-update privileged helpers from repo (runs as root via NOPASSWD).
for _script in s52-carplay-switch.sh s52-deploy.sh; do
  _repo="$APP_DIR/scripts/$_script"
  _inst="/usr/local/bin/$_script"
  if [[ -f "$_repo" ]] && ! cmp -s "$_inst" "$_repo" 2>/dev/null; then
    install -m 755 "$_repo" "$_inst"
  fi
done

# sudoers preserves WAYLAND_DISPLAY/XDG_RUNTIME_DIR; fall back for SSH usage.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"

CARPLAY_APP_ID="${S52_CARPLAY_APP_ID:-react-carplay}"

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
