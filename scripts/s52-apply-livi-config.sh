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

echo "Applied S52 LIVI config -> ${DST}"

if pgrep -x livi >/dev/null 2>&1; then
  for p in $(pgrep -x livi); do kill -9 "$p" 2>/dev/null || true; done
  echo "Restarted LIVI (autostart will respawn). Reconnect iPhone if stream size unchanged."
else
  echo "LIVI not running; new config applies on next launch."
fi
