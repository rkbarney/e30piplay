#!/usr/bin/env bash
# Save a phone hotspot WiFi profile on the Pi and prefer it for internet.
# When both the hotspot and home WiFi are in range, NetworkManager picks the
# profile with the higher connection.autoconnect-priority (hotspot wins).
#
# SSID and password are NOT stored in the repo. Configure profile names in
# ~/.config/s52-wifi.env (see scripts/s52-wifi.env.example), or pass env vars:
#   S52_HOTSPOT_SSID="My Hotspot" S52_HOME_CONN=my-home-wifi \
#     bash ~/e30piplay/scripts/s52-add-wifi-hotspot.sh
set -euo pipefail

WIFI_ENV="${HOME}/.config/s52-wifi.env"
if [[ -f "${WIFI_ENV}" ]]; then
  set -a
  # shellcheck source=/dev/null
  . "${WIFI_ENV}"
  set +a
fi

SSID="${S52_HOTSPOT_SSID:-}"
HOTSPOT_PRIORITY="${S52_HOTSPOT_PRIORITY:-100}"
HOME_PRIORITY="${S52_HOME_PRIORITY:-10}"

if [[ -z "${S52_HOTSPOT_CON_NAME:-}" ]]; then
  echo "Set S52_HOTSPOT_CON_NAME to the NetworkManager profile name for your phone hotspot." >&2
  echo "Or add S52_HOTSPOT_CON_NAME=... to ~/.config/s52-wifi.env (see scripts/s52-wifi.env.example)." >&2
  exit 1
fi
CON_NAME="${S52_HOTSPOT_CON_NAME}"

if [[ -z "${S52_HOME_CONN:-}" ]]; then
  echo "Set S52_HOME_CONN to your home WiFi NetworkManager profile name." >&2
  echo "Or add S52_HOME_CONN=... to ~/.config/s52-wifi.env (see scripts/s52-wifi.env.example)." >&2
  exit 1
fi
HOME_CONN="${S52_HOME_CONN}"

if [[ -z "${SSID}" ]]; then
  read -r -p "Hotspot SSID: " SSID
fi
[[ -n "${SSID}" ]] || { echo "No SSID given." >&2; exit 1; }

# iPhone Personal Hotspot SSIDs often use a curly apostrophe (U+2019). Typing ASCII '
# makes the saved profile invisible to NetworkManager even when the phone is nearby.
if printf '%s' "${SSID}" | python3 <<'PY'
import sys
s = sys.stdin.read()
raise SystemExit(0 if any(c in s for c in "'\u2019\u2018") else 1)
PY
then
  echo "Tip: copy the SSID exactly from the Pi: nmcli dev wifi list" >&2
  echo "  iPhone hotspot names use a curly apostrophe, not a straight one." >&2
fi

read -r -s -p "Password for '${SSID}': " PW
echo

# This script only configures WPA-PSK, which requires an 8–63 character
# passphrase. Fail fast with a clear message rather than letting `nmcli
# connection import` reject it later with an opaque error.
if (( ${#PW} < 8 || ${#PW} > 63 )); then
  echo "Password must be 8–63 characters (WPA-PSK). Aborting." >&2
  exit 1
fi

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
autoconnect-priority=${HOTSPOT_PRIORITY}

[wifi]
mode=infrastructure
ssid=${SSID}

[wifi-security]
key-mgmt=wpa-psk
psk=${PW}
EOF

nmcli connection import type keyfile file "${KEYFILE}" >/dev/null

# Lower home priority so the hotspot is preferred when both are visible.
if nmcli -t -f NAME connection show 2>/dev/null | grep -qxF "${HOME_CONN}"; then
  nmcli connection modify "${HOME_CONN}" connection.autoconnect-priority "${HOME_PRIORITY}"
fi

echo "Saved '${CON_NAME}' (priority ${HOTSPOT_PRIORITY}; '${HOME_CONN}' → ${HOME_PRIORITY} when present)."
echo "Test: turn on the phone hotspot, then:"
echo "  nmcli connection up \"${CON_NAME}\""
echo "  ip -4 addr show wlan0"
