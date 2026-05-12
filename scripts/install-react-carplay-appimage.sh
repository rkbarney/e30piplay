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

cat > "${HOME}/.local/bin/react-carplay" <<EOF
#!/bin/bash
exec "${IMAGE}" "\$@"
EOF
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
