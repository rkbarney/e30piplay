#!/usr/bin/env bash
# Install rhysmorgan134/react-carplay Linux arm64 AppImage on Raspberry Pi OS.
# Also invoked automatically at the end of setup.sh unless S52_SKIP_REACT_CARPLAY_APPIMAGE=1.
# Standalone: bash scripts/install-react-carplay-appimage.sh
#
# This is the upstream Electron app — NOT embedded in e30piplay's Chromium kiosk.
# On Pi OS Lite you may need to stop cage before running (see messages at end).
set -euo pipefail

VERSION="${REACT_CARPLAY_VERSION:-4.0.5}"
APP_DIR="${HOME}/apps"
IMAGE="${APP_DIR}/react-carplay-${VERSION}-arm64.AppImage"
URL="https://github.com/rhysmorgan134/react-carplay/releases/download/v${VERSION}/react-carplay-${VERSION}-arm64.AppImage"

if ! getconf LONG_BIT 2>/dev/null | grep -q 64; then
  echo "This AppImage is arm64 only." >&2
  exit 1
fi

echo "=== react-carplay AppImage v${VERSION} (upstream Electron) ==="

sudo apt-get update -qq
sudo apt-get install -y -qq curl

# AppImage needs FUSE2 stack on Bookworm
if ! dpkg -s libfuse2 &>/dev/null; then
  sudo apt-get install -y -qq libfuse2 || sudo apt-get install -y -qq fuse3 libfuse3-3
fi

mkdir -p "$APP_DIR" "${HOME}/.local/bin"

echo "Downloading..."
curl -fsSL "$URL" -o "${IMAGE}.part"
mv "${IMAGE}.part" "$IMAGE"
chmod +x "$IMAGE"

echo "udev (Carlinkit + common MTK IDs)..."
sudo tee /etc/udev/rules.d/52-react-carplay-carlinkit.rules >/dev/null <<'EOF'
SUBSYSTEM=="usb", ATTRS{idVendor}=="1314", ATTRS{idProduct}=="152*", MODE="0660", GROUP="plugdev"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0e8d", MODE="0660", GROUP="plugdev"
EOF
sudo udevadm control --reload-rules
sudo usermod -aG plugdev "$USER" || true

# --- Linux patches applied to the extracted asar (re-run re-applies both):
#
# 1) electron.systemPreferences.askForMediaAccess is macOS-only. On Linux this
#    call throws an unhandled rejection that prevents mic streams from
#    initialising (react-carplay#107). We guard the call.
#
# 2) The BrowserWindow is created with `show: false` and only revealed on
#    `ready-to-show`. That event fires when the compositor presents the first
#    frame — which works with hardware GBM, but under the software-GL path we
#    use to dodge the Mesa 25.0.7 GBM/dma_buf regression (see
#    s52-labwc-autostart.sh), the frame callback on a hidden/unmapped Wayland
#    surface never completes, so ready-to-show never fires and no window maps.
#    We flip `show: false` -> `show: true` so the toplevel maps unconditionally;
#    labwc's windowRule iconifies it until the user taps `+`.
#
# We extract the AppImage, patch, and run from the extracted tree so the patch
# survives future kiosk restarts without re-downloading.
EXTRACTED="${APP_DIR}/react-carplay-${VERSION}-arm64-extracted"
PATCH_OK=0
echo "Applying Linux mic patch (react-carplay#107)..."
if command -v node >/dev/null 2>&1; then
  # Extract AppImage into versioned directory (safe to re-run — rm first).
  rm -rf "${EXTRACTED}"
  mkdir -p "${EXTRACTED}"
  cd "${EXTRACTED}"
  "${IMAGE}" --appimage-extract >/dev/null 2>&1 && mv squashfs-root/* . && rmdir squashfs-root 2>/dev/null || true
  cd "$APP_DIR"
  ASAR="${EXTRACTED}/resources/app.asar"
  if [ -f "${ASAR}" ]; then
    PATCH_WORK="/tmp/rc-app-patch-$$"
    rm -rf "${PATCH_WORK}"
    if npx --yes @electron/asar extract "${ASAR}" "${PATCH_WORK}" 2>/dev/null; then
      MAIN_JS="${PATCH_WORK}/out/main/index.js"
      if [ -f "${MAIN_JS}" ]; then
        node -e "
const fs = require('fs');
const f = process.argv[1];
let s = fs.readFileSync(f, 'utf8');
// Patch 1: guard macOS-only askForMediaAccess (react-carplay#107).
const before = 'electron.systemPreferences.askForMediaAccess(\"microphone\");';
const after  = 'if (typeof electron.systemPreferences.askForMediaAccess === \"function\") { electron.systemPreferences.askForMediaAccess(\"microphone\"); }';
if (s.includes(before)) { s = s.replace(before, after); process.stdout.write('mic: patched\n'); }
else if (s.includes(after)) { process.stdout.write('mic: already patched\n'); }
else { process.stdout.write('mic: line not found — skipping\n'); }
// Patch 2: show window unconditionally (software-GL path never fires ready-to-show).
const m = s.match(/show:\s*false,/);
if (m) { s = s.replace(/show:\s*false,/, 'show: true,'); process.stdout.write('show: patched\n'); }
else if (/show:\s*true,/.test(s)) { process.stdout.write('show: already patched\n'); }
else { process.stdout.write('show: pattern not found — skipping\n'); }
fs.writeFileSync(f, s);
" "${MAIN_JS}"
        npx @electron/asar pack "${PATCH_WORK}" "${ASAR}" 2>/dev/null && PATCH_OK=1 || true
      fi
      rm -rf "${PATCH_WORK}"
    fi
  fi
fi

if [ "${PATCH_OK}" -eq 1 ]; then
  cat > "${HOME}/.local/bin/react-carplay" <<EOF
#!/bin/bash
APPDIR="${EXTRACTED}"
export APPDIR
exec "\${APPDIR}/AppRun" "\$@"
EOF
  echo "Launcher points to patched extracted build."
else
  echo "Warning: mic patch could not be applied (node/npx missing or AppImage layout changed)." >&2
  echo "         Falling back to unpatched AppImage — mic may not work on Linux." >&2
  cat > "${HOME}/.local/bin/react-carplay" <<EOF
#!/bin/bash
exec "${IMAGE}" "\$@"
EOF
fi
chmod +x "${HOME}/.local/bin/react-carplay"

echo ""
echo "Installed: ${IMAGE}"
echo "Launcher:   ~/.local/bin/react-carplay"
echo ""
echo "Pi OS Lite + cage: Electron needs a display stack. Typical tries:"
echo "  1) Stop kiosk, run standalone (may use DRM/fallback — try first):"
echo "       sudo systemctl stop s52-cage-kiosk"
echo "       ~/.local/bin/react-carplay --no-sandbox"
echo "  2) If that fails, upstream targets Desktop sessions — see:"
echo "       https://github.com/rhysmorgan134/react-carplay"
echo ""
echo "New shell or: newgrp plugdev   # USB permissions"
echo "===================="
