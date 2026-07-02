#!/usr/bin/env bash
# Bluetooth audio (car stereo / BT speaker) control for the Settings UI.
# Runs as the kiosk user: bluetoothctl needs the `bluetooth` group (setup.sh),
# pactl needs the user's own PipeWire session. Only the raspotify conf edit
# sudo's internally (covered by the setup.sh sudoers file).
#
# Commands (all emit JSON on stdout; human-readable errors on stderr):
#   status                       adapter/paired/connected + audio-output mode
#   scan                         ~12s discovery, then status + "devices" list
#   pair <MAC>                   pair + trust + connect, then route audio to BT
#   connect <MAC>                connect a paired device, then route audio to BT
#   disconnect <MAC>             drop the link (PipeWire falls back to aux)
#   forget <MAC>                 unpair/remove the device
#   output bluetooth|aux         switch where all audio goes
#
# Routing model ("bluetooth with aux fallback"):
#   aux mode        → PULSE_SINK pinned to the USB DAC (original behavior).
#   bluetooth mode  → PULSE_SINK removed; apps follow the PipeWire default
#                     sink, which we point at the bluez sink. WirePlumber
#                     stores the default by node name, so when the head unit
#                     drops off, audio falls back to the USB DAC (aux), and
#                     when it auto-reconnects the BT sink becomes default
#                     again — no daemon or hook needed.
set -euo pipefail

BTCTL=bluetoothctl
AUDIO_ENV="${HOME}/.config/s52-carplay-audio.env"
RASPOTIFY_CONF="/etc/raspotify/conf"
MAC_RE='^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$'
SCAN_SECONDS="${S52_BT_SCAN_SECONDS:-12}"

fail() {
  echo "$*" >&2
  exit 1
}

require_mac() {
  [[ "${1:-}" =~ $MAC_RE ]] || fail "invalid Bluetooth address: ${1:-<empty>}"
}

have_bluetoothctl() { command -v "$BTCTL" &>/dev/null; }
have_pactl() { command -v pactl &>/dev/null; }

adapter_present() {
  have_bluetoothctl && [[ -n "$($BTCTL list 2>/dev/null)" ]]
}

adapter_powered() {
  $BTCTL show 2>/dev/null | grep -q 'Powered: yes'
}

power_on() {
  $BTCTL power on >/dev/null 2>&1 || true
}

read_env_var() {
  local name="$1"
  [[ -f "$AUDIO_ENV" ]] || return 0
  sed -n "s/^export ${name}=//p" "$AUDIO_ENV" | head -1 | sed "s/^[\"']//;s/[\"']\$//"
}

audio_mode() {
  local mode
  mode="$(read_env_var S52_AUDIO_OUTPUT)"
  [[ "$mode" == "bluetooth" ]] && echo bluetooth || echo aux
}

# First connected bluez sink (PipeWire: bluez_output.<MAC>.1 / Pulse: bluez_sink.…).
any_bt_sink() {
  have_pactl || return 0
  pactl list sinks short 2>/dev/null | awk '{print $2}' | grep -m1 '^bluez_' || true
}

# Wired fallback sink: recorded S52_AUX_SINK, else pre-BT PULSE_SINK, else the
# first non-bluez/non-HDMI sink (prefer USB-ish names, same as pi-audio-usb-default.sh).
aux_sink() {
  local sink
  sink="$(read_env_var S52_AUX_SINK)"
  if [[ -z "$sink" || "$sink" == bluez_* ]]; then
    sink="$(read_env_var PULSE_SINK)"
  fi
  if [[ -z "$sink" || "$sink" == bluez_* ]]; then
    sink="$(pick_wired_sink || true)"
  fi
  printf '%s' "$sink"
}

pick_wired_sink() {
  have_pactl || return 1
  local line lower
  while read -r line; do
    lower="$(echo "$line" | tr '[:upper:]' '[:lower:]')"
    case "$lower" in
      *bluez* | *hdmi* | *vc4hdmi*) continue ;;
      *usb* | *dac* | *cmedia* | *c-media* | *fosi* | *sabrent* | *ugreen* | *generic_usb*)
        echo "$line" | awk '{print $2}'
        return 0
        ;;
    esac
  done < <(pactl list sinks short 2>/dev/null)
  while read -r line; do
    lower="$(echo "$line" | tr '[:upper:]' '[:lower:]')"
    case "$lower" in
      *bluez* | *hdmi* | *vc4hdmi*) continue ;;
    esac
    echo "$line" | awk '{print $2}'
    return 0
  done < <(pactl list sinks short 2>/dev/null)
  return 1
}

device_info() {
  $BTCTL info "$1" 2>/dev/null || true
}

device_connected() {
  device_info "$1" | grep -q 'Connected: yes'
}

device_paired() {
  device_info "$1" | grep -q 'Paired: yes'
}

# "Device <MAC> <Name>" lines → "MAC<TAB>Name", skipping entries whose name is
# just the MAC with dashes (BlueZ placeholder for nameless beacons).
parse_device_lines() {
  awk '/^Device /{
    mac=$2; name=$0; sub(/^Device [^ ]+ /, "", name)
    dashmac=mac; gsub(/:/, "-", dashmac)
    if (name != dashmac && name != "") printf "%s\t%s\n", mac, name
  }'
}

list_paired() {
  { $BTCTL devices Paired 2>/dev/null || $BTCTL paired-devices 2>/dev/null || true; } \
    | parse_device_lines
}

list_known() {
  $BTCTL devices 2>/dev/null | parse_device_lines
}

# Rewrite ~/.config/s52-carplay-audio.env for the chosen mode, preserving
# unrelated lines (ALSA_CARD, PULSE_SOURCE, comments).
write_audio_env() {
  local mode="$1" aux="$2" tmp
  mkdir -p "${HOME}/.config"
  tmp="$(mktemp "${HOME}/.config/.s52-audio-env.XXXXXX")"
  if [[ -f "$AUDIO_ENV" ]]; then
    grep -v -E '^export (PULSE_SINK|S52_AUX_SINK|S52_AUDIO_OUTPUT)=' "$AUDIO_ENV" >"$tmp" || true
  fi
  {
    echo "export S52_AUDIO_OUTPUT=${mode}"
    if [[ -n "$aux" ]]; then
      printf 'export S52_AUX_SINK=%q\n' "$aux"
    fi
    # bluetooth mode: no PULSE_SINK — follow the PipeWire default sink so the
    # BT↔aux fallback happens automatically as the head unit comes and goes.
    if [[ "$mode" == "aux" && -n "$aux" ]]; then
      printf 'export PULSE_SINK=%q\n' "$aux"
    fi
  } >>"$tmp"
  mv "$tmp" "$AUDIO_ENV"
  chmod 600 "$AUDIO_ENV"
}

# librespot pins its Pulse device via LIBRESPOT_DEVICE (beats env/default), so
# flip it with the mode. Best effort: raspotify may not be installed, and sudo
# may be unavailable off-Pi.
update_raspotify() {
  local mode="$1" aux="$2"
  [[ -f "$RASPOTIFY_CONF" ]] || return 0
  sudo -n sed -i '/^#\{0,1\}LIBRESPOT_DEVICE=/d' "$RASPOTIFY_CONF" 2>/dev/null || return 0
  if [[ "$mode" == "aux" && -n "$aux" ]]; then
    printf 'LIBRESPOT_DEVICE="%s"\n' "$aux" | sudo -n tee -a "$RASPOTIFY_CONF" >/dev/null 2>&1 || true
  fi
  sudo -n systemctl restart raspotify 2>/dev/null || true
}

# LIVI (alternate CarPlay receiver) pins its GStreamer pulsesink through
# audioOutputDevice — re-sync its config with the new mode (this restarts
# LIVI). react-carplay needs nothing: it follows PULSE_SINK / the default sink.
update_livi() {
  local recv_env="${HOME}/.config/s52-carplay-receiver.env" app_dir
  { [[ -f "$recv_env" ]] && grep -q '^S52_CARPLAY_RECEIVER=.*livi' "$recv_env"; } || return 0
  app_dir="$(cat /etc/s52-app-dir 2>/dev/null || true)"
  [[ -n "$app_dir" && -f "$app_dir/scripts/s52-apply-livi-config.sh" ]] || return 0
  bash "$app_dir/scripts/s52-apply-livi-config.sh" >/dev/null 2>&1 || true
}

# Point the default sink at the target and drag currently-playing streams over
# so the switch is audible immediately (streams opened with an explicit
# PULSE_SINK don't follow default-sink changes on their own).
route_to_sink() {
  local target="$1" id rest
  pactl set-default-sink "$target" 2>/dev/null || true
  while read -r id rest; do
    [[ -n "$id" ]] && pactl move-sink-input "$id" "$target" 2>/dev/null || true
  done < <(pactl list short sink-inputs 2>/dev/null)
}

apply_output() {
  local mode="$1" aux target
  [[ "$mode" == "bluetooth" || "$mode" == "aux" ]] || fail "output must be 'bluetooth' or 'aux'"
  have_pactl || fail "PipeWire/pactl not available — Bluetooth audio needs the PipeWire stack (re-run setup.sh)."

  aux="$(aux_sink)"
  if [[ "$mode" == "bluetooth" ]]; then
    target="$(any_bt_sink)"
    [[ -n "$target" ]] || fail "No Bluetooth audio device connected — connect your stereo first."
  else
    target="$aux"
    [[ -n "$target" ]] || fail "No wired (USB/aux) output found — is the USB DAC plugged in?"
  fi

  route_to_sink "$target"
  write_audio_env "$mode" "$aux"
  update_raspotify "$mode" "$aux"
  update_livi
  # HAL voice reads the audio env at service start; nudge it onto the new route.
  systemctl --user restart s52-hal-voice.service 2>/dev/null || true
}

# ── JSON emission ─────────────────────────────────────────────────────────────

# emit_status [devices_tsv]: devices_tsv lines are "MAC<TAB>NAME<TAB>paired<TAB>connected".
emit_status() {
  local devices_tsv="${1:-}"
  local available=false powered=false mode bt_sink default_sink paired_tsv="" mac name

  if adapter_present; then
    available=true
    adapter_powered && powered=true
  fi
  mode="$(audio_mode)"
  bt_sink="$(any_bt_sink)"
  default_sink="$(pactl get-default-sink 2>/dev/null || true)"

  if [[ "$available" == true ]]; then
    while IFS=$'\t' read -r mac name; do
      [[ -n "$mac" ]] || continue
      if device_connected "$mac"; then
        paired_tsv+="${mac}	${name}	1	1"$'\n'
      else
        paired_tsv+="${mac}	${name}	1	0"$'\n'
      fi
    done < <(list_paired)
  fi

  AVAILABLE="$available" POWERED="$powered" MODE="$mode" BT_SINK="$bt_sink" \
  DEFAULT_SINK="$default_sink" PAIRED_TSV="$paired_tsv" DEVICES_TSV="$devices_tsv" \
    python3 <<'PY'
import json, os

def parse(tsv):
    out = []
    for line in tsv.splitlines():
        parts = line.split("\t")
        if len(parts) < 4 or not parts[0]:
            continue
        out.append({
            "mac": parts[0],
            "name": parts[1],
            "paired": parts[2] == "1",
            "connected": parts[3] == "1",
        })
    return out

paired = parse(os.environ.get("PAIRED_TSV", ""))
mode = os.environ.get("MODE") or "aux"
bt_sink = os.environ.get("BT_SINK") or None
default_sink = os.environ.get("DEFAULT_SINK") or None
connected = [d for d in paired if d["connected"]]

# In bluetooth mode apps follow the default sink (PULSE_SINK is unset), so the
# actual route is what the default points at — a present-but-not-default bluez
# sink still plays through aux. Require both: the sink exists AND is default
# (a just-vanished sink can leave a stale default name for a moment).
bt_active = bool(mode == "bluetooth" and bt_sink and default_sink and default_sink.startswith("bluez_"))

status = {
    "available": os.environ.get("AVAILABLE") == "true",
    "powered": os.environ.get("POWERED") == "true",
    "mode": mode,
    "btSink": bt_sink,
    "defaultSink": default_sink,
    "effectiveOutput": "bluetooth" if bt_active else "aux",
    "connected": connected[0] if connected else None,
    "paired": paired,
}
devices_tsv = os.environ.get("DEVICES_TSV", "")
if devices_tsv.strip():
    status["devices"] = parse(devices_tsv)
print(json.dumps(status))
PY
}

# ── Commands ──────────────────────────────────────────────────────────────────

cmd_status() {
  emit_status
}

cmd_scan() {
  adapter_present || fail "No Bluetooth adapter found on this Pi."
  power_on
  # --timeout makes bluetoothctl exit after N seconds of discovery; found
  # devices stay in the BlueZ cache for the listing below.
  $BTCTL --timeout "$SCAN_SECONDS" scan on >/dev/null 2>&1 || true

  local devices_tsv="" mac name p c
  while IFS=$'\t' read -r mac name; do
    [[ -n "$mac" ]] || continue
    p=0; c=0
    device_paired "$mac" && p=1
    device_connected "$mac" && c=1
    devices_tsv+="${mac}	${name}	${p}	${c}"$'\n'
  done < <(list_known)
  emit_status "$devices_tsv"
}

# Pairing from a headless box: register a NoInputNoOutput agent so "Just Works"
# / auto-confirm pairing succeeds without a keyboard. Car head units typically
# show the PIN on their own screen and accept without confirmation here.
cmd_pair() {
  local mac="$1"
  require_mac "$mac"
  adapter_present || fail "No Bluetooth adapter found on this Pi."
  power_on

  if ! device_paired "$mac"; then
    {
      printf 'agent NoInputNoOutput\ndefault-agent\nscan on\n'
      sleep 3
      printf 'pair %s\n' "$mac"
      sleep 15
      printf 'scan off\nquit\n'
    } | $BTCTL >/dev/null 2>&1 || true
    device_paired "$mac" || fail "Pairing failed — put the stereo in pairing mode and try again."
  fi
  cmd_connect "$mac"
}

cmd_connect() {
  local mac="$1"
  require_mac "$mac"
  adapter_present || fail "No Bluetooth adapter found on this Pi."
  power_on
  $BTCTL trust "$mac" >/dev/null 2>&1 || true

  if ! device_connected "$mac"; then
    timeout 30 $BTCTL connect "$mac" >/dev/null 2>&1 || true
    device_connected "$mac" || fail "Could not connect — is the stereo on and in range?"
  fi

  # Wait for PipeWire to expose the A2DP sink, then route audio to it. The
  # user just connected a speaker — bluetooth output is clearly the intent.
  local i
  for ((i = 0; i < 10; i++)); do
    [[ -n "$(any_bt_sink)" ]] && break
    sleep 1
  done
  if [[ -n "$(any_bt_sink)" ]]; then
    apply_output bluetooth
  fi
  emit_status
}

cmd_disconnect() {
  local mac="$1"
  require_mac "$mac"
  timeout 15 $BTCTL disconnect "$mac" >/dev/null 2>&1 || true
  emit_status
}

cmd_forget() {
  local mac="$1"
  require_mac "$mac"
  timeout 15 $BTCTL disconnect "$mac" >/dev/null 2>&1 || true
  $BTCTL remove "$mac" >/dev/null 2>&1 || true
  emit_status
}

cmd_output() {
  apply_output "${1:-}"
  emit_status
}

case "${1:-}" in
  status) cmd_status ;;
  scan) cmd_scan ;;
  pair) cmd_pair "${2:-}" ;;
  connect) cmd_connect "${2:-}" ;;
  disconnect) cmd_disconnect "${2:-}" ;;
  forget) cmd_forget "${2:-}" ;;
  output) cmd_output "${2:-}" ;;
  *)
    echo "usage: $0 status|scan|pair <MAC>|connect <MAC>|disconnect <MAC>|forget <MAC>|output bluetooth|aux" >&2
    exit 1
    ;;
esac
