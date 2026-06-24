#!/usr/bin/env bash
# Save the iPhone hotspot as a fallback WiFi profile on the Pi.
# Home "home-wifi" keeps higher autoconnect priority when both are in range.
#
# Run on the Pi (phone hotspot ON for a live test):
#   bash ~/e30piplay/scripts/s52-add-wifi-hotspot.sh
set -euo pipefail

CON_NAME="rkb-main-hotspot"
SSID="REDACTED-DEVICE-NAME"

read -r -s -p "Password for '${SSID}': " PW
echo

# Avoid passing the PSK on the nmcli argv (visible in ps); use a short-lived keyfile.
KEYFILE="$(mktemp)"
chmod 600 "${KEYFILE}"
trap 'rm -f "${KEYFILE}"; unset PW' EXIT

if nmcli -t -f NAME connection show 2>/dev/null | grep -qxF "${CON_NAME}"; then
  echo "Profile '${CON_NAME}' already exists — updating password…"
  nmcli connection delete "${CON_NAME}" >/dev/null
fi

cat > "${KEYFILE}" <<EOF
[connection]
id=${CON_NAME}
type=wifi
interface-name=wlan0
autoconnect=true
autoconnect-priority=5

[wifi]
mode=infrastructure
ssid=${SSID}

[wifi-security]
key-mgmt=wpa-psk
psk=${PW}
EOF

nmcli connection import type keyfile file "${KEYFILE}" >/dev/null

# Prefer home WiFi when the Pi can see both networks.
if nmcli -t -f NAME connection show 2>/dev/null | grep -qxF home-wifi; then
  nmcli connection modify home-wifi connection.autoconnect-priority 20
fi

echo "Saved '${CON_NAME}' (priority 5; home-wifi stays 20 when present)."
echo "Test: turn on the phone hotspot, then:"
echo "  nmcli connection up ${CON_NAME}"
echo "  ip -4 addr show wlan0"
