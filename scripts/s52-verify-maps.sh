#!/usr/bin/env bash
# Pre-drive smoke test for the ORGANIC MAPS face. Run this on the Pi (parked or
# on the bench — you do NOT need to be driving) to confirm the nav handoff works
# before you rely on it in the car. It checks the three things that actually
# break:
#
#   1. Organic Maps is installed (flatpak).
#   2. It's running as a labwc toplevel AND the app_id matches what
#      carplay-server / rc.xml expect — the #1 silent failure (button does
#      nothing if the app_id differs).
#   3. carplay-server sees it (/api/maps-ready) — i.e. tapping the face will
#      focus it.
#
# Run inside the kiosk session so wlrctl can see the compositor, e.g. over SSH:
#   ssh s52 'XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 \
#            bash ~/e30piplay/scripts/s52-verify-maps.sh'
#
# Exit 0 = ready for the car. Non-zero = something to fix first (with the fix).
set -uo pipefail

EXPECTED_APP_ID="${S52_MAPS_APP_ID:-app.organicmaps.desktop}"
FLATPAK_REF="${S52_MAPS_FLATPAK_REF:-app.organicmaps.desktop}"
API="${S52_API_BASE:-http://127.0.0.1:3001}"
WLRCTL="$(command -v wlrctl || echo /usr/bin/wlrctl)"

fail=0
ok()   { echo "  ✓ $*"; }
bad()  { echo "  ✗ $*"; fail=1; }
note() { echo "    → $*"; }

echo "== 1. Organic Maps installed =="
if command -v flatpak >/dev/null 2>&1 && flatpak info "$FLATPAK_REF" >/dev/null 2>&1; then
  ok "flatpak $FLATPAK_REF is installed"
else
  bad "$FLATPAK_REF not installed"
  note "fix: flatpak install --user -y flathub app.organicmaps.desktop  (or rerun setup.sh)"
fi

echo "== 2. Running + app_id matches =="
if [ ! -x "$WLRCTL" ]; then
  bad "wlrctl not found — can't inspect the compositor"
  note "are you running this inside the kiosk session? (XDG_RUNTIME_DIR + WAYLAND_DISPLAY set)"
else
  toplevels="$("$WLRCTL" toplevel list 2>/dev/null || true)"
  if [ -z "$toplevels" ]; then
    bad "wlrctl saw no toplevels — is labwc (s52-cage-kiosk) running and WAYLAND_DISPLAY set?"
  else
    echo "    toplevels seen:"
    echo "$toplevels" | sed 's/^/      /'
    if echo "$toplevels" | grep -q "$EXPECTED_APP_ID"; then
      ok "found expected app_id '$EXPECTED_APP_ID' — the maps button will focus it"
    elif echo "$toplevels" | grep -qiE 'organic|omaps'; then
      actual="$(echo "$toplevels" | grep -iE 'organic|omaps' | head -1)"
      bad "Organic Maps is running but under a DIFFERENT app_id than expected"
      note "expected: $EXPECTED_APP_ID"
      note "seen:     $actual"
      note "fix: set S52_MAPS_APP_ID to the real app_id in carplay-server's env"
      note "     AND update the windowRule identifier in ~/.config/labwc/rc.xml,"
      note "     then restart the kiosk. Otherwise the face button does nothing."
    else
      bad "Organic Maps doesn't appear in the toplevel list at all"
      note "check /tmp/organicmaps.log — it may have crashed (GL/EGL) or not pre-warmed yet"
    fi
  fi
fi

echo "== 3. carplay-server sees it =="
resp="$(curl -s -o /dev/null -w '%{http_code}' "$API/api/maps-ready" 2>/dev/null || echo 000)"
if [ "$resp" = "200" ]; then
  ok "/api/maps-ready -> 200 (server reports ready)"
elif [ "$resp" = "503" ]; then
  bad "/api/maps-ready -> 503 (server can't find the toplevel — see check 2)"
else
  bad "/api/maps-ready -> $resp (is carplay-server running? systemctl status s52-carplay)"
fi

echo ""
if [ "$fail" -eq 0 ]; then
  echo "RESULT: ✓ ready — tap ORGANIC MAPS in the car with confidence."
  echo "        (Reminder: download a map region in OM first, or it's an empty globe.)"
else
  echo "RESULT: ✗ not ready — fix the ✗ items above before relying on it while driving."
fi
exit "$fail"
