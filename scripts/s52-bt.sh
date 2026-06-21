#!/usr/bin/env bash
# Pair / connect the Pi to the car stereo (Kenwood) over Bluetooth so it can be
# used as an audio OUTPUT. Run this in the car with the stereo powered on and in
# Bluetooth pairing mode.
#
# Typical first-time flow (in the car):
#   s52-bt.sh scan            # ~15s discovery; note the Kenwood's MAC
#   s52-bt.sh pair AA:BB:CC:DD:EE:FF
#   s52-audio-output.sh bt    # route CarPlay audio to it
#
# Afterwards:
#   s52-bt.sh connect         # reconnect the saved device (also runs on boot
#                             # via the optional s52-bt-connect user service)
#   s52-bt.sh status
#
# The saved device MAC lives in ~/.config/s52-bt-sink.env.
set -euo pipefail

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
CONF="${HOME}/.config/s52-bt-sink.env"

have() { command -v "$1" >/dev/null 2>&1; }
if ! have bluetoothctl; then
  echo "bluetoothctl not found (install bluez)." >&2
  exit 1
fi

save_mac() {
  mkdir -p "$(dirname "$CONF")"
  printf 'S52_BT_MAC=%s\n' "$1" >"$CONF"
  chmod 600 "$CONF"
}

load_mac() {
  [ -f "$CONF" ] && . "$CONF" 2>/dev/null || true
  echo "${S52_BT_MAC:-}"
}

cmd="${1:-status}"

case "$cmd" in
  scan)
    echo "Powering radio on, scanning ~15s for devices..."
    bluetoothctl power on >/dev/null 2>&1 || true
    bluetoothctl --timeout 15 scan on || true
    echo
    echo "Discovered devices (look for your Kenwood / car stereo):"
    bluetoothctl devices
    ;;

  pair)
    MAC="${2:-}"
    [ -n "$MAC" ] || { echo "Usage: s52-bt.sh pair <MAC>" >&2; exit 1; }
    echo "Pairing ${MAC} ..."
    bluetoothctl power on >/dev/null 2>&1 || true
    # A short scan so the adapter has the device in range/cache.
    bluetoothctl --timeout 8 scan on >/dev/null 2>&1 || true
    bluetoothctl pair "$MAC"    || true
    bluetoothctl trust "$MAC"   || true   # trust => auto-accept future connects
    bluetoothctl connect "$MAC" || true
    save_mac "$MAC"
    echo "Saved ${MAC} to ${CONF}."
    echo "Now route audio: s52-audio-output.sh bt"
    ;;

  connect)
    MAC="${2:-$(load_mac)}"
    [ -n "$MAC" ] || { echo "No saved device. Run: s52-bt.sh pair <MAC>" >&2; exit 1; }
    bluetoothctl power on >/dev/null 2>&1 || true
    ok=0
    for _ in 1 2 3 4 5 6; do
      if bluetoothctl connect "$MAC" 2>/dev/null | grep -qi 'Connection successful\|already connected'; then
        ok=1; break
      fi
      sleep 3
    done
    [ "$ok" = 1 ] && echo "Connected ${MAC}." || { echo "Could not connect ${MAC} (stereo on / in range?)." >&2; exit 1; }
    ;;

  disconnect)
    MAC="${2:-$(load_mac)}"
    [ -n "$MAC" ] && bluetoothctl disconnect "$MAC" || echo "No saved device."
    ;;

  status)
    echo "Saved device: $(load_mac || echo '(none)')"
    echo
    bluetoothctl info "$(load_mac)" 2>/dev/null | grep -E 'Name|Connected|Paired|Trusted' || \
      echo "Not paired yet. Run: s52-bt.sh scan  then  s52-bt.sh pair <MAC>"
    ;;

  *)
    echo "Usage: s52-bt.sh {scan|pair <MAC>|connect [MAC]|disconnect|status}" >&2
    exit 1
    ;;
esac
