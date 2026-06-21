#!/usr/bin/env bash
# Apply the S52 react-carplay DongleConfig overrides (dpi / resolution / band /
# media buffer) from scripts/s52-carplay-config.json into the Pi's live config
# at ~/.config/react-carplay/config.json, then restart CarPlay so they take hold.
#
# This is the ONE place to change CarPlay screen sizing on the Pi:
#   1. edit scripts/s52-carplay-config.json   (e.g. bump "dpi")
#   2. bash scripts/s52-apply-carplay-config.sh
#
# setup.sh runs this automatically, so a full re-deploy also re-applies it.
set -euo pipefail

SRC="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/s52-carplay-config.json"
DST="${S52_CARPLAY_CONFIG:-${HOME}/.config/react-carplay/config.json}"

if [[ ! -f "$SRC" ]]; then
  echo "ERROR: ${SRC} not found" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 required to merge ${DST}" >&2
  exit 1
fi

mkdir -p "$(dirname "$DST")"

python3 - "$SRC" "$DST" <<'PY'
import json, os, sys
src, dst = sys.argv[1], sys.argv[2]
overrides = {k: v for k, v in json.load(open(src)).items() if not k.startswith("_")}
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

echo "Applied S52 CarPlay config -> ${DST}"

# Restart the AppImage so node-carplay re-sends the new DongleConfig. The labwc
# autostart loop respawns it within ~3s. Kill by PID (not pkill -f, which would
# also match this script's own command line).
if pgrep -x react-carplay >/dev/null 2>&1; then
  for p in $(pgrep -x react-carplay); do kill -9 "$p" 2>/dev/null || true; done
  echo "Restarted react-carplay (autostart will respawn it)."
else
  echo "react-carplay not running; new config applies on next launch."
fi
