#!/usr/bin/env bash
# WiFi status + manual profile switch for the System screen UI.
# Lists saved NetworkManager WiFi profiles; switch activates one by connection name.
# Status runs as the kiosk user; switch is invoked via sudo -n (see setup.sh sudoers).
set -euo pipefail

wifi_device() {
  nmcli -t -f DEVICE,TYPE dev status 2>/dev/null \
    | awk -F: '$2 == "wifi" && $1 != "" { print $1; exit }'
}

list_wifi_profiles() {
  nmcli -t -f NAME,TYPE connection show 2>/dev/null \
    | awk -F: '$2 == "wifi" && $1 != "" { print $1 }' \
    | sort
}

profile_is_wifi() {
  local conn="${1:-}"
  [[ -n "${conn}" ]] || return 1
  nmcli -t -f NAME,TYPE connection show 2>/dev/null \
    | awk -F: -v c="${conn}" '$2 == "wifi" && $1 == c { found=1 } END { exit !found }'
}

emit_status() {
  local dev profile ssid signal profiles_json

  profiles_json="$(list_wifi_profiles | python3 -c 'import json,sys; print(json.dumps([l.rstrip("\n") for l in sys.stdin if l.strip()]))')"

  dev="$(wifi_device || true)"
  if [[ -z "${dev}" ]]; then
    printf '{"connected":false,"profile":null,"ssid":null,"signal":null,"profiles":%s}\n' "${profiles_json}"
    return
  fi

  profile="$(nmcli -g GENERAL.CONNECTION device show "${dev}" 2>/dev/null || true)"
  if [[ -z "${profile}" || "${profile}" == "--" ]]; then
    printf '{"connected":false,"profile":null,"ssid":null,"signal":null,"profiles":%s}\n' "${profiles_json}"
    return
  fi

  ssid="$(nmcli -g 802-11-wireless.ssid connection show "${profile}" 2>/dev/null || true)"
  if [[ -z "${ssid}" || "${ssid}" == "--" ]]; then
    ssid=""
  fi

  signal="$(nmcli -t -f IN-USE,SSID,SIGNAL dev wifi list ifname "${dev}" 2>/dev/null \
    | awk -F: '$1 == "*" { print $3; exit }')"

  PROFILE="${profile}" SSID="${ssid}" SIGNAL="${signal:-}" PROFILES="${profiles_json}" \
    python3 <<'PY'
import json, os

signal_raw = os.environ.get("SIGNAL", "")
signal = None
if signal_raw.isdigit():
    signal = int(signal_raw)

ssid = os.environ.get("SSID") or None

print(json.dumps({
    "connected": True,
    "profile": os.environ["PROFILE"],
    "ssid": ssid,
    "signal": signal,
    "profiles": json.loads(os.environ["PROFILES"]),
}))
PY
}

switch_network() {
  local conn="${1:-}"

  if [[ -z "${conn}" ]]; then
    echo "missing profile name" >&2
    exit 1
  fi

  if ! profile_is_wifi "${conn}"; then
    echo "unknown WiFi profile: ${conn}" >&2
    exit 1
  fi

  nmcli connection up "${conn}"
  emit_status
}

case "${1:-}" in
  status) emit_status ;;
  switch) switch_network "${2:-}" ;;
  *)
    echo "usage: $0 status|switch <profile-name>" >&2
    exit 1
    ;;
esac
