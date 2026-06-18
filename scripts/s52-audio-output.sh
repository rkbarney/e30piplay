#!/usr/bin/env bash
# Switch the CarPlay audio OUTPUT between the analog USB adapter (AUX), the
# Kenwood over Bluetooth, or HDMI — and make the choice stick.
#
# What it does:
#   1. Picks the matching PipeWire sink and makes it the default (full volume,
#      unmuted).
#   2. Moves any *currently playing* streams (react-carplay, etc.) to it right
#      away via `pactl move-sink-input`, so the switch is live — no reboot.
#   3. Persists `PULSE_SINK` in ~/.config/s52-carplay-audio.env so the choice
#      survives a reboot (the labwc autostart sources that file when it launches
#      react-carplay).
#
# Usage:
#   s52-audio-output.sh aux      # C-Media USB adapter -> 3.5mm -> Kenwood AUX
#   s52-audio-output.sh bt       # Bluetooth (Kenwood must be connected first:
#                                #   s52-bt.sh connect)
#   s52-audio-output.sh hdmi     # HDMI audio (the dash screen, if it has sound)
#   s52-audio-output.sh status   # show current routing + available sinks
#
# Run as the kiosk user (the one running labwc/PipeWire, usually `admin`).
set -euo pipefail

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
ENV_FILE="${HOME}/.config/s52-carplay-audio.env"

have() { command -v "$1" >/dev/null 2>&1; }

if ! have pactl; then
  echo "pactl not found. Install it (client-only, talks to PipeWire):" >&2
  echo "  sudo apt-get install -y pulseaudio-utils" >&2
  exit 1
fi

# Echo the full node.name of the first sink matching an extended-regex.
sink_name_matching() {
  local re="$1"
  pactl list short sinks | awk '{print $2}' | grep -iE "$re" | head -1
}

resolve_sink() {
  case "$1" in
    aux|analog|usb)
      # C-Media / generic USB analog output that feeds the 3.5mm AUX cable.
      sink_name_matching 'alsa_output\..*(c-media|usb_audio_device|usb-).*analog'
      ;;
    bt|bluetooth|kenwood)
      sink_name_matching '^bluez_output\.'
      ;;
    hdmi)
      sink_name_matching 'alsa_output\..*(hdmi|vc4)'
      ;;
    *)
      # Treat the argument as an explicit sink name (or regex).
      sink_name_matching "$1"
      ;;
  esac
}

persist_pulse_sink() {
  local name="$1"
  mkdir -p "$(dirname "$ENV_FILE")"
  touch "$ENV_FILE"
  if grep -q '^export PULSE_SINK=' "$ENV_FILE"; then
    # `|` delimiter is safe: sink names never contain it.
    sed -i "s|^export PULSE_SINK=.*|export PULSE_SINK=${name}|" "$ENV_FILE"
  else
    printf 'export PULSE_SINK=%s\n' "$name" >>"$ENV_FILE"
  fi
  chmod 600 "$ENV_FILE"
}

show_status() {
  echo "Default sink : $(pactl get-default-sink 2>/dev/null || echo '?')"
  echo "Persisted    : $(grep -E '^export PULSE_SINK=' "$ENV_FILE" 2>/dev/null | sed 's/^export PULSE_SINK=//' || echo '(none)')"
  echo
  echo "Available sinks:"
  pactl list short sinks | awk '{printf "  %s  %s\n", $1, $2}'
}

TARGET="${1:-status}"

if [ "$TARGET" = "status" ]; then
  show_status
  exit 0
fi

# Machine-readable: print just the current output token (aux|bt|hdmi|unknown).
if [ "$TARGET" = "current" ]; then
  cur="$(pactl get-default-sink 2>/dev/null || true)"
  case "$cur" in
    bluez_output.*)            echo bt ;;
    *hdmi*|*vc4*)              echo hdmi ;;
    *analog*|*c-media*|*usb*)  echo aux ;;
    *)                         echo unknown ;;
  esac
  exit 0
fi

NAME="$(resolve_sink "$TARGET" || true)"

if [ -z "${NAME:-}" ]; then
  echo "No sink found for '${TARGET}'." >&2
  if [ "$TARGET" = "bt" ] || [ "$TARGET" = "bluetooth" ] || [ "$TARGET" = "kenwood" ]; then
    echo "Bluetooth sink only appears once the Kenwood is connected. Try:" >&2
    echo "  s52-bt.sh connect" >&2
  fi
  echo >&2
  show_status >&2
  exit 1
fi

echo "Switching audio output -> ${NAME}"
pactl set-default-sink "$NAME"

# Move everything currently playing onto the new sink (live switch).
pactl list short sink-inputs | awk '{print $1}' | while read -r si; do
  [ -n "$si" ] && pactl move-sink-input "$si" "$NAME" 2>/dev/null || true
done

# Full volume + unmute on the new default.
if have wpctl; then
  wpctl set-volume @DEFAULT_AUDIO_SINK@ 1.0 2>/dev/null || true
  wpctl set-mute @DEFAULT_AUDIO_SINK@ 0 2>/dev/null || true
fi

persist_pulse_sink "$NAME"

echo "Done. Persisted to ${ENV_FILE} (survives reboot)."
echo
show_status
