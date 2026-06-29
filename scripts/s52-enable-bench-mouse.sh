#!/usr/bin/env bash
# Enable a visible, moving mouse cursor on the deployed kiosk UI for bench
# debugging. Patches /var/www/s52-display after rsync — car installs leave
# this off (default). Run from setup.sh with --bench / S52_BENCH=1, or by hand
# after any manual deploy:
#   sudo bash ~/e30piplay/scripts/s52-enable-bench-mouse.sh
set -euo pipefail

WEB_ROOT="${S52_WEB_ROOT:-/var/www/s52-display}"
MARKER='s52-bench-show-cursor'

run_root() {
  if [[ "$(id -u)" -eq 0 ]] || [[ -w "$WEB_ROOT" ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

if [[ ! -d "$WEB_ROOT" ]]; then
  echo "Web root missing: $WEB_ROOT — run setup.sh or rsync dist/ first." >&2
  exit 1
fi

shopt -s nullglob
css_files=("$WEB_ROOT"/assets/*.css)
if [[ ${#css_files[@]} -eq 0 ]]; then
  echo "No CSS in $WEB_ROOT/assets/ — npm run build + deploy first." >&2
  exit 1
fi

_backup_suffix() {
  date +%Y%m%d
}

for css in "${css_files[@]}"; do
  if grep -q 'cursor:none' "$css"; then
    run_root cp -a "$css" "${css}.bak-cursor-$(_backup_suffix)"
    run_root perl -pi -e 's/cursor:none/cursor:auto/g' "$css"
    echo "    Patched $(basename "$css"): cursor:none → cursor:auto"
  elif grep -q 'cursor:auto' "$css"; then
    echo "    Already patched: $(basename "$css")"
  else
    echo "    WARNING: no cursor:none in $(basename "$css") — skipped" >&2
  fi
done

HTML="$WEB_ROOT/index.html"
if [[ ! -f "$HTML" ]]; then
  echo "Missing $HTML" >&2
  exit 1
fi

if grep -q "$MARKER" "$HTML"; then
  echo "    index.html already has bench cursor bootstrap ($MARKER)"
else
  run_root cp -a "$HTML" "${HTML}.bak-cursor-$(_backup_suffix)"
  HTML="$HTML" run_root env HTML="$HTML" python3 <<'PY'
from pathlib import Path
import os

html = Path(os.environ["HTML"])
text = html.read_text()
if "</head>" not in text:
    raise SystemExit(f"{html}: no </head> tag")
inject = """    <!-- s52-bench-show-cursor -->
    <script>
      (function () {
        try {
          var k = 's52-settings';
          var s = JSON.parse(localStorage.getItem(k) || '{}');
          s.showMouse = true;
          localStorage.setItem(k, JSON.stringify(s));
        } catch (e) {}
        document.documentElement.classList.add('show-cursor');
      })();
    </script>
    <style>html, body { cursor: auto !important; }</style>
  </head>"""
html.write_text(text.replace("</head>", inject, 1))
print("    Injected bench cursor bootstrap into index.html")
PY
fi

echo "    Bench mouse cursor enabled under $WEB_ROOT"
