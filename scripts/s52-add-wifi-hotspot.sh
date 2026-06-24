#!/usr/bin/env bash
# Save the iPhone hotspot as a fallback WiFi profile on the Pi.
# Home "biscuit" keeps higher autoconnect priority when both are in range.
#
# Run on the Pi (phone hotspot ON for a live test):
#   bash ~/e30piplay/scripts/s52-add-wifi-hotspot.sh
set -euo pipefail

CON_NAME="rkb-main-hotspot"
SSID="rkbarney's main"

if nmcli -t -f NAME connection show 2>/dev/null | grep -qxF "${CON_NAME}"; then
  echo "Profile '${CON_NAME}' already exists — updating password…"
  read -r -s -p "Password for '${SSID}': " PW
  echo
  nmcli connection modify "${CON_NAME}" wifi-sec.psk "${PW}"
else
  read -r -s -p "Password for '${SSID}': " PW
  echo
  nmcli connection add \
    type wifi \
    con-name "${CON_NAME}" \
    ifname wlan0 \
    ssid "${SSID}" \
    wifi-sec.key-mgmt wpa-psk \
    wifi-sec.psk "${PW}" \
    connection.autoconnect yes \
    connection.autoconnect-priority 5
fi

# Prefer home WiFi when the Pi can see both networks.
if nmcli -t -f NAME connection show 2>/dev/null | grep -qxF biscuit; then
  nmcli connection modify biscuit connection.autoconnect-priority 20
fi

echo "Saved '${CON_NAME}' (priority 5; biscuit stays 20 when present)."
echo "Test: turn on the phone hotspot, then:"
echo "  nmcli connection up ${CON_NAME}"
echo "  ip -4 addr show wlan0"
