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
    | awk -F: '$2 ~ /^(802-11-wireless|wifi)$/ && $1 != "" { print $1 }' \
    | sort
}

profile_is_wifi() {
  local conn="${1:-}"
  [[ -n "${conn}" ]] || return 1
  nmcli -t -f NAME,TYPE connection show 2>/dev/null \
    | awk -F: -v c="${conn}" '$2 ~ /^(802-11-wireless|wifi)$/ && $1 == c { found=1 } END { exit !found }'
}

target_ssid_for_profile() {
  local conn="${1:-}"
  nmcli -g 802-11-wireless.ssid connection show "${conn}" 2>/dev/null || true
}

# iPhone hotspot names often use U+2019 (’) while manual entry uses ASCII '.
normalize_ssid_py() {
  python3 <<'PY'
import sys
print(sys.stdin.read().translate(str.maketrans({"\u2019": "'", "\u2018": "'"})).strip(), end="")
PY
}

scan_ssids() {
  local dev="${1:-}"
  nmcli -t -f SSID dev wifi list ifname "${dev}" 2>/dev/null
}

refresh_wifi_scan() {
  local dev="${1:-}"
  nmcli dev wifi rescan ifname "${dev}" >/dev/null 2>&1 || true
  sleep 2
}

# Return the scanned SSID that matches the profile SSID (exact or apostrophe-normalized).
visible_scan_ssid() {
  local dev="${1:-}" want="${2:-}"
  [[ -n "${dev}" && -n "${want}" ]] || return 0

  refresh_wifi_scan "${dev}"

  local scan_ssid want_norm scan_norm
  want_norm="$(printf '%s' "${want}" | normalize_ssid_py)"

  while IFS= read -r scan_ssid; do
    [[ -n "${scan_ssid}" ]] || continue
    if [[ "${scan_ssid}" == "${want}" ]]; then
      printf '%s' "${scan_ssid}"
      return 0
    fi
    scan_norm="$(printf '%s' "${scan_ssid}" | normalize_ssid_py)"
    if [[ -n "${want_norm}" && "${scan_norm}" == "${want_norm}" ]]; then
      printf '%s' "${scan_ssid}"
      return 0
    fi
  done < <(scan_ssids "${dev}")

  return 1
}

ssid_visible() {
  local dev="${1:-}" ssid="${2:-}"
  [[ -n "${dev}" && -n "${ssid}" ]] || return 0
  visible_scan_ssid "${dev}" "${ssid}" >/dev/null
}

sync_profile_ssid_from_scan() {
  local conn="${1:-}" dev="${2:-}" profile_ssid="${3:-}" scan_ssid=""

  scan_ssid="$(visible_scan_ssid "${dev}" "${profile_ssid}" || true)"
  [[ -n "${scan_ssid}" ]] || return 1

  if [[ "${scan_ssid}" != "${profile_ssid}" ]]; then
    nmcli connection modify "${conn}" 802-11-wireless.ssid "${scan_ssid}" >/dev/null
  fi
  printf '%s' "${scan_ssid}"
}

nmcli_fail_message() {
  local out="${1:-}"
  if [[ "${out}" == *"ssid-not-found"* ]] || [[ "${out}" == *"No network with SSID"* ]]; then
    echo "That network is not in range. Turn on the hotspot or move closer, then try again."
  elif [[ "${out}" == *"Secrets were required"* ]] || [[ "${out}" == *"secrets"* ]]; then
    echo "WiFi password missing for this profile. Re-add the network on the Pi (see scripts/s52-add-wifi-hotspot.sh)."
  elif [[ "${out}" == *"permission"* ]] || [[ "${out}" == *"not authorized"* ]]; then
    echo "Not allowed to change WiFi. Run setup.sh on the Pi or use: sudo install ... s52-wifi-switch.sh"
  else
    echo "${out:-WiFi connection activation failed. Check: journalctl -u NetworkManager -b --no-pager | tail -30}"
  fi
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

  local dev target_ssid nm_out nm_rc

  dev="$(wifi_device || true)"
  target_ssid="$(target_ssid_for_profile "${conn}")"
  if [[ -n "${dev}" && -n "${target_ssid}" && "${target_ssid}" != "--" ]]; then
    if ! synced_ssid="$(sync_profile_ssid_from_scan "${conn}" "${dev}" "${target_ssid}")"; then
      printf "Network %s is not in range. Turn on the hotspot or move closer, then try again.\n" "${target_ssid}" >&2
      exit 1
    fi
    target_ssid="${synced_ssid}"
  fi

  if ! nm_out="$(nmcli connection up "${conn}" 2>&1)"; then
    nm_rc=$?
    echo "$(nmcli_fail_message "${nm_out}")" >&2
    exit "${nm_rc}"
  fi
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
