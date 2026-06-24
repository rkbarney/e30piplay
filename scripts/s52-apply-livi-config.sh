#!/usr/bin/env bash
# Apply S52 LIVI display tuning from scripts/s52-livi-config.json into
# ~/.config/LIVI/config.json, then restart LIVI so the phone renegotiates stream size.
#
#   1. edit scripts/s52-livi-config.json
#   2. bash scripts/s52-apply-livi-config.sh
set -euo pipefail

SRC="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/s52-livi-config.json"
DST="${S52_LIVI_CONFIG:-${HOME}/.config/LIVI/config.json}"

if [[ ! -f "$SRC" ]]; then
  echo "ERROR: ${SRC} not found" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 required to merge ${DST}" >&2
  exit 1
fi

mkdir -p "$(dirname "$DST")"

# Route LIVI's audio to the same USB DAC react-carplay uses, instead of
# whatever PipeWire's default sink happens to be (see
# scripts/s52-carplay-audio.env.example / pi-audio-usb-default.sh, which
# discover and write PULSE_SINK). LIVI reads this as audioOutputDevice and
# passes it straight to its GStreamer pulsesink — the LIVI equivalent of
# react-carplay's --alsa-output-device flag.
CARPLAY_AUDIO_ENV="${HOME}/.config/s52-carplay-audio.env"
if [[ -f "${CARPLAY_AUDIO_ENV}" ]]; then
  # shellcheck disable=SC1090
  . "${CARPLAY_AUDIO_ENV}"
fi

python3 - "$SRC" "$DST" "${PULSE_SINK:-}" <<'PY'
import json, os, sys
src, dst, pulse_sink = sys.argv[1], sys.argv[2], sys.argv[3]
overrides = {k: v for k, v in json.load(open(src)).items() if not k.startswith("_")}
if pulse_sink:
    overrides["audioOutputDevice"] = pulse_sink
cfg = {}
if os.path.exists(dst):
    try:
        cfg = json.load(open(dst))
    except Exception:
        cfg = {}
for k, v in overrides.items():
    print(f"  {k}: {cfg.get(k, '(unset)')} -> {v}")
cfg.update(overrides)
json.dump(cfg, open(dst, "w"), indent=2)
PY

echo "Applied S52 LIVI config -> ${DST}"

if pgrep -x livi >/dev/null 2>&1; then
  pkill -x livi 2>/dev/null || true
  for _ in $(seq 1 10); do pgrep -x livi >/dev/null || break; sleep 1; done
  if pgrep -x livi >/dev/null 2>&1; then
    pkill -9 -x livi 2>/dev/null || true
  fi
  echo "Restarted LIVI (autostart will respawn). Reconnect iPhone if stream size unchanged."
else
  echo "LIVI not running; new config applies on next launch."
fi
