#!/usr/bin/env bash
# Remove phone-hotspot NetworkManager profiles from the Pi.
#
# Wireless CarPlay and Personal Hotspot share the phone's WiFi radio — having
# the Pi auto-join the hotspot while CarPlay is active causes disconnects and
# audio skips. Run this to roll back an s52-add-hotspot.sh install.
#
# Deletes by UUID (SSID names with apostrophes break nmcli name matching).
# Keeps the home connection (default: biscuit).
#
# Usage (on the Pi):
#   sudo /usr/local/bin/s52-remove-hotspot.sh
#   bash scripts/s52-remove-hotspot.sh   # uses sudo -n if allow-listed
#
# From your Mac:
#   ./scripts/ssh-pi.sh 'sudo -n /usr/local/bin/s52-remove-hotspot.sh'
set -euo pipefail

HOME_CONN="${S52_HOME_CONN:-biscuit}"

if [[ "$(uname -s)" != Linux ]]; then
  echo "This script must run on the Pi (Linux), not on $(uname -s)." >&2
  exit 1
fi

if ! command -v nmcli &>/dev/null; then
  echo "nmcli not found — this Pi is not using NetworkManager." >&2
  exit 1
fi

run_nmcli() {
  if [[ "$(id -u)" -eq 0 ]]; then
    nmcli "$@"
  elif sudo -n true 2>/dev/null; then
    sudo -n nmcli "$@"
  else
    echo "Root required to delete NetworkManager profiles (run: sudo $0)." >&2
    exit 1
  fi
}

home_uuid=""
while IFS=: read -r name uuid type; do
  [[ "$type" == "802-11-wireless" ]] || continue
  if [[ "$name" == "$HOME_CONN" ]]; then
    home_uuid="$uuid"
    echo "Keeping home wifi '$name' ($uuid)."
  else
    echo "Removing wifi profile '$name' ($uuid) …"
    run_nmcli connection delete "$uuid"
  fi
done < <(nmcli -t -f NAME,UUID,TYPE connection show)

echo
echo "Remaining connections:"
nmcli -f NAME,TYPE,AUTOCONNECT,AUTOCONNECT-PRIORITY connection show

if [[ -n "$home_uuid" ]]; then
  leftover=$(nmcli -t -f NAME,TYPE connection show | awk -F: '$2 == "802-11-wireless" && $1 != "'"$HOME_CONN"'" { print $1 }')
  if [[ -n "$leftover" ]]; then
    echo "Warning: non-home wifi profiles still present." >&2
    exit 1
  fi
fi

echo "Hotspot profiles removed."
