#!/usr/bin/env bash
# Run ONCE on the Raspberry Pi (over SSH) to add your phone's hotspot as a
# network fallback. NetworkManager auto-joins the highest-priority network that
# is in range, so the Pi prefers home wifi when parked and falls back to the
# phone hotspot on the road.
#
# Credentials are stored only in NetworkManager on the Pi — never committed
# (same rule as the wifi/sudo secrets noted in HANDOFF.md).
#
# Usage (on the Pi):
#   bash scripts/s52-add-hotspot.sh "<SSID>" "<PASSWORD>"
#
# From your Mac:
#   ./scripts/ssh-pi.sh 'bash -s' "<SSID>" "<PASSWORD>" < scripts/s52-add-hotspot.sh
set -euo pipefail

# Home network kept at a higher priority so it always wins when present.
HOME_CONN="${S52_HOME_CONN:-home-wifi}"
HOME_PRIORITY="${S52_HOME_PRIORITY:-10}"
HOTSPOT_PRIORITY="${S52_HOTSPOT_PRIORITY:-5}"

SSID="${1:-}"
PSK="${2:-}"

if [[ "$(uname -s)" != Linux ]]; then
  echo "This script must run on the Pi (Linux), not on $(uname -s)." >&2
  echo "From your Mac:  ./scripts/ssh-pi.sh 'bash -s' \"<SSID>\" \"<PASSWORD>\" < scripts/s52-add-hotspot.sh" >&2
  exit 1
fi

if [[ -z "$SSID" || -z "$PSK" ]]; then
  echo "usage: $0 \"<SSID>\" \"<PASSWORD>\"" >&2
  exit 1
fi

if ! command -v nmcli &>/dev/null; then
  echo "nmcli not found — this Pi is not using NetworkManager." >&2
  exit 1
fi

echo "Adding hotspot connection '$SSID' (autoconnect, priority $HOTSPOT_PRIORITY) …"
# Re-runnable: drop any existing profile with the same name first.
nmcli connection delete "$SSID" &>/dev/null || true
nmcli connection add type wifi con-name "$SSID" ssid "$SSID" \
  wifi-sec.key-mgmt wpa-psk \
  wifi-sec.psk "$PSK" \
  connection.autoconnect yes \
  connection.autoconnect-priority "$HOTSPOT_PRIORITY"

# Keep home wifi preferred over the hotspot (best-effort; skip if not present).
if nmcli -g NAME connection show | grep -qx "$HOME_CONN"; then
  echo "Raising '$HOME_CONN' priority to $HOME_PRIORITY so it stays preferred …"
  nmcli connection modify "$HOME_CONN" connection.autoconnect-priority "$HOME_PRIORITY" || true
else
  echo "Note: home connection '$HOME_CONN' not found — skipping its priority bump." >&2
  echo "      (set S52_HOME_CONN to your home connection name if it differs.)" >&2
fi

echo
echo "Connection priorities now:"
nmcli -f NAME,TYPE,AUTOCONNECT,AUTOCONNECT-PRIORITY connection show

echo
echo "Done. NetworkManager will join '$HOME_CONN' when in range and fall back to '$SSID' otherwise."
echo "iPhone hotspot tips: enable 'Maximize Compatibility' (2.4 GHz); an idle iPhone hotspot"
echo "sleeps until a device asks for it, so expect a short reconnect delay after waking."
