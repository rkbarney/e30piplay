#!/usr/bin/env bash
# Install the LIVI CarPlay/Android-Auto receiver (f-io/LIVI) ALONGSIDE the
# existing react-carplay AppImage — non-destructively — so we can A/B them.
#
# Why LIVI: it is an Electron app like react-carplay (so it fits our labwc /
# AppImage kiosk model) BUT it decodes CarPlay video through a native GStreamer
# hardware pipeline (v4l2 on the Pi 5, zero-copy) instead of the software-GL
# (llvmpipe) CPU paint react-carplay is stuck on here. That CPU paint is the
# leading software suspect for the in-car stutter / drops-needing-manual-restart
# (see GitHub issue #23 and docs/livi-receiver-trial.md).
#
# This script does NOT touch react-carplay and does NOT change which receiver
# boots. To actually run LIVI, set S52_CARPLAY_RECEIVER=livi for the kiosk
# session (see the trial doc) — default stays react-carplay.
#
# Run on the Pi:  bash ~/e30piplay/scripts/s52-install-livi.sh
set -euo pipefail

APP_DIR="${HOME}/apps"
LIVI_APPIMAGE="${APP_DIR}/LIVI.AppImage"
LAUNCHER="${HOME}/.local/bin/s52-livi"
REPO="f-io/LIVI"

echo "=== LIVI receiver install (alongside react-carplay) ==="

# --- 0. Sanity: this is meant for the Pi (Debian/Wayland), not the dev box. ---
if ! command -v apt-get >/dev/null 2>&1; then
  echo "!! apt-get not found — run this ON THE PI, not the Mac/dev box." >&2
  exit 1
fi

# LIVI's Pi path is validated on Raspberry Pi OS Trixie / Debian 13. It may run
# on Bookworm but the GStreamer v4l2codecs HW decode is the whole point, so flag
# the OS rather than silently degrading.
if [ -r /etc/os-release ]; then
  . /etc/os-release
  echo "[os] ${PRETTY_NAME:-unknown}"
  case "${VERSION_CODENAME:-}" in
    trixie|forky|sid) : ;;  # Debian 13+ — supported
    *) echo "!! WARNING: LIVI's Pi HW-decode path targets Debian 13 (Trixie)."
       echo "   You appear to be on '${VERSION_CODENAME:-?}'. LIVI may still launch,"
       echo "   but hardware video decode (the reason we're trying it) may be"
       echo "   unavailable until the Pi is on Trixie. Continuing in 5s — Ctrl-C to stop."
       sleep 5 ;;
  esac
fi

# --- 1. Runtime deps: GStreamer HW pipeline + LIVI's support stack. ---
echo "[1] Installing GStreamer + support packages (sudo)…"
sudo apt-get update -y
sudo apt-get install -y --no-install-recommends \
  curl ca-certificates jq \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad \
  gstreamer1.0-gl gstreamer1.0-libav gstreamer1.0-tools \
  python3-dbus python3-gi \
  || { echo "!! apt install failed"; exit 1; }

# --- 2. Download the latest arm64 AppImage. ---
echo "[2] Resolving latest ${REPO} arm64 AppImage…"
mkdir -p "${APP_DIR}" "${HOME}/.local/bin"
RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")"
LIVI_TAG="$(printf '%s\n' "$RELEASE_JSON" | jq -r '.tag_name')"
ASSET_URL="$(printf '%s\n' "$RELEASE_JSON" \
  | jq -r '.assets[] | select(.name | test("arm64\\.AppImage$")) | .browser_download_url' \
  | head -n1)"
if [ -z "${ASSET_URL}" ] || [ "${ASSET_URL}" = "null" ]; then
  echo "!! Could not find an arm64.AppImage asset in the latest ${REPO} release." >&2
  echo "   Check https://github.com/${REPO}/releases and set the URL by hand." >&2
  exit 1
fi
echo "    -> ${ASSET_URL} (${LIVI_TAG})"
curl -fL --retry 4 --retry-delay 2 -o "${LIVI_APPIMAGE}.part" "${ASSET_URL}"
mv -f "${LIVI_APPIMAGE}.part" "${LIVI_APPIMAGE}"
chmod +x "${LIVI_APPIMAGE}"

# --- 3. Pi v4l2codecs HEVC crop patch (only for affected GStreamer 1.26.0–1.26.10). ---
GST_VER="$(gst-launch-1.0 --version 2>/dev/null | head -n1 | awk '{print $NF}')"
echo "[3] GStreamer ${GST_VER:-unknown}; applying Pi v4l2codecs patch if needed…"
if printf '%s\n' "$GST_VER" | grep -qE '^1\.26\.(0|1|2|3|4|5|6|7|8|9|10)$'; then
  PATCH_URL="https://raw.githubusercontent.com/${REPO}/${LIVI_TAG}/scripts/gstreamer/patch-pi-v4l2codecs.sh"
  curl -fsSL "${PATCH_URL}" -o /tmp/patch-pi-v4l2codecs.sh && bash /tmp/patch-pi-v4l2codecs.sh \
    || echo "   (patch step failed/non-fatal — note for the in-car test)"
else
  echo "    not in the affected range; skipping."
fi

# --- 4. Launcher shim. The kiosk autostart calls this when
#        S52_CARPLAY_RECEIVER=livi. Hardware GL/GStreamer — NO llvmpipe forcing. ---
echo "[4] Writing launcher ${LAUNCHER}"
cat > "${LAUNCHER}" <<EOF
#!/usr/bin/env sh
# LIVI launcher for the S52 kiosk. Wayland/Electron flags only; video decode is
# handled by LIVI's native GStreamer pipeline, so we do NOT force software GL.
#
# LIVI ships a nested compositor (livi-compositor). Without WAYLAND_DISPLAY it
# tries to grab DRM directly — which fails over SSH and when labwc already owns
# the display. Always attach to the labwc session (wayland-0).
export XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-/run/user/\$(id -u)}"
export WAYLAND_DISPLAY="\${WAYLAND_DISPLAY:-wayland-0}"
exec "${LIVI_APPIMAGE}" --no-sandbox \\
  --ozone-platform=wayland --enable-features=UseOzonePlatform \\
  --password-store=basic "\$@"
EOF
chmod +x "${LAUNCHER}"

# --- 5. Remove LIVI's own XDG autostart if its installer ever ran — our labwc
#        autostart owns launching, and a double-launch would fight for the dongle. ---
for f in "${HOME}/.config/autostart/LIVI.desktop" "${HOME}/Desktop/LIVI.desktop"; do
  [ -f "$f" ] && { echo "[5] Removing conflicting ${f}"; rm -f "$f"; }
done

echo "[6] Applying S52 480×640 LIVI display config…"
bash "$(dirname -- "${BASH_SOURCE[0]}")/s52-apply-livi-config.sh" || echo "   (apply-livi-config failed — run manually after editing s52-livi-config.json)"

cat <<EOF

=== LIVI installed (react-carplay untouched) ===
  AppImage : ${LIVI_APPIMAGE}
  Launcher : ${LAUNCHER}
  WM class : dev.f-io.livi   (for rc.xml window rules / wlrctl focus)

It will NOT boot until you opt in. To A/B test (see docs/livi-receiver-trial.md):

  1) Quick foreground smoke test (kiosk still running react-carplay):
       S52_CARPLAY_RECEIVER=livi  — or just run the launcher once by hand:
       ${LAUNCHER}
  2) Make LIVI the booted receiver:
       set S52_CARPLAY_RECEIVER=livi in the kiosk env, then
       sudo systemctl restart s52-cage-kiosk
  3) Revert anytime: unset the flag (default react-carplay) + restart the kiosk.
EOF
