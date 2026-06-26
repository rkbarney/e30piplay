#!/usr/bin/env bash
# WiFi status + manual profile switch for the System screen UI.
# Profiles: rkb-main-hotspot (phone hotspot, priority 100), biscuit (home, priority 10).
# Status runs as the kiosk user; switch is invoked via sudo -n (see setup.sh sudoers).
set -euo pipefail

HOTSPOT_CONN="${S52_HOTSPOT_CONN:-rkb-main-hotspot}"
HOME_CONN="${S52_HOME_CONN:-biscuit}"

wifi_device() {
  nmcli -t -f DEVICE,TYPE dev status 2>/dev/null \
    | awk -F: '$2 == "wifi" && $1 != "" { print $1; exit }'
}

network_key() {
  case "${1:-}" in
    "${HOTSPOT_CONN}") echo hotspot ;;
    "${HOME_CONN}") echo biscuit ;;
    *) echo other ;;
  esac
}

emit_status() {
  local dev profile ssid signal network

  dev="$(wifi_device || true)"
  if [[ -z "${dev}" ]]; then
    printf '{"connected":false,"profile":null,"ssid":null,"signal":null,"network":null}\n'
    return
  fi

  profile="$(nmcli -g GENERAL.CONNECTION device show "${dev}" 2>/dev/null || true)"
  if [[ -z "${profile}" || "${profile}" == "--" ]]; then
    printf '{"connected":false,"profile":null,"ssid":null,"signal":null,"network":null}\n'
    return
  fi

  ssid="$(nmcli -g 802-11-wireless.ssid connection show "${profile}" 2>/dev/null || true)"
  [[ -n "${ssid}" && "${ssid}" != "--" ]] || ssid="${profile}"

  signal="$(nmcli -t -f IN-USE,SSID,SIGNAL dev wifi list ifname "${dev}" 2>/dev/null \
    | awk -F: '$1 == "*" { print $3; exit }')"

  network="$(network_key "${profile}")"

  PROFILE="${profile}" SSID="${ssid}" SIGNAL="${signal:-}" NETWORK="${network}" \
    HOTSPOT_CONN="${HOTSPOT_CONN}" HOME_CONN="${HOME_CONN}" \
    python3 <<'PY'
import json, os

signal_raw = os.environ.get("SIGNAL", "")
signal = None
if signal_raw.isdigit():
    signal = int(signal_raw)

print(json.dumps({
    "connected": True,
    "profile": os.environ["PROFILE"],
    "ssid": os.environ["SSID"],
    "signal": signal,
    "network": os.environ["NETWORK"],
    "hotspotProfile": os.environ["HOTSPOT_CONN"],
    "homeProfile": os.environ["HOME_CONN"],
}))
PY
}

switch_network() {
  local target="${1:-}"
  local conn

  case "${target}" in
    hotspot) conn="${HOTSPOT_CONN}" ;;
    biscuit|home) conn="${HOME_CONN}" ;;
    *)
      echo "unknown network: ${target} (use hotspot or biscuit)" >&2
      exit 1
      ;;
  esac

  if ! nmcli -t -f NAME connection show 2>/dev/null | grep -qxF "${conn}"; then
    echo "profile not found: ${conn}" >&2
    exit 1
  fi

  nmcli connection up "${conn}"
  emit_status
}

case "${1:-}" in
  status) emit_status ;;
  switch) switch_network "${2:-}" ;;
  *)
    echo "usage: $0 status|switch <hotspot|biscuit>" >&2
    exit 1
    ;;
esac
