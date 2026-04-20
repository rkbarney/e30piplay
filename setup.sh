#!/bin/bash
# =============================================================================
# S52 Solutions — Raspberry Pi 5 Display Setup
# Run once after flashing Pi OS:  bash setup.sh
# Do NOT use `source` or `. setup.sh` — that breaks path detection.
# =============================================================================
set -e

APP_DIR="/home/$USER/s52-display"
SERVICE_USER="$USER"

echo ""
echo "=== S52 Solutions Display Setup ==="
echo ""

# ── 1. System packages ────────────────────────────────────────────────────────
echo "[1/8] Updating system..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
  nginx \
  chromium \
  unclutter \
  xdotool \
  libgtk-3-0 \
  alsa-utils \
  openssh-server \
  avahi-daemon \
  wlr-randr

# Remote access: SSH + mDNS (ssh admin@<hostname>.local from your Mac)
sudo systemctl enable ssh
sudo systemctl start ssh
sudo systemctl enable avahi-daemon
sudo systemctl restart avahi-daemon

# ── 2. Node.js (v20 LTS via NodeSource, Debian fallback if NodeSource errors) ─
echo "[2/8] Installing Node.js..."
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* ]]; then
  NS_URL="https://deb.nodesource.com/setup_20.x"
  HTTP_CODE=$(curl -sS -o /tmp/nodesource_setup.sh -w "%{http_code}" --max-time 60 "$NS_URL") || true
  if [[ "$HTTP_CODE" == "200" ]] && sudo -E bash /tmp/nodesource_setup.sh; then
    sudo apt-get install -y nodejs
  else
    echo "    NodeSource failed (HTTP ${HTTP_CODE:-error}). Installing nodejs from Debian repos..."
    sudo apt-get install -y nodejs npm
  fi
  rm -f /tmp/nodesource_setup.sh
fi
echo "    Node $(node -v) / npm $(npm -v)"

# ── 3. Copy app files ─────────────────────────────────────────────────────────
echo "[3/8] Installing app..."
mkdir -p "$APP_DIR"
# If running from a USB drive or cloned repo, copy everything here.
# Adjust SOURCE_DIR if your files are elsewhere (e.g. /media/usb/s52-display).
SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
SOURCE_DIR="$(cd "$(dirname -- "$SCRIPT_PATH")" && pwd)"
rsync -a --exclude node_modules --exclude .git "$SOURCE_DIR/" "$APP_DIR/"
cd "$APP_DIR"
npm install --silent
npm run build

# nginx runs as www-data; serving from /home/user/... often breaks (700 home → 500/403).
# Deploy built assets where www-data can always read.
WEB_ROOT="/var/www/s52-display"
echo "[3b/8] Publishing web root → $WEB_ROOT ..."
sudo mkdir -p "$WEB_ROOT"
sudo rsync -a --delete "$APP_DIR/dist/" "$WEB_ROOT/"
sudo chown -R root:www-data "$WEB_ROOT"
sudo find "$WEB_ROOT" -type d -exec chmod 755 {} \;
sudo find "$WEB_ROOT" -type f -exec chmod 644 {} \;

# ── 4. nginx — serve the built app ────────────────────────────────────────────
echo "[4/8] Configuring nginx..."
sudo tee /etc/nginx/sites-available/s52 > /dev/null <<'NGINX'
server {
    listen 80 default_server;
    root /var/www/s52-display;
    index index.html;

    # Static assets
    location / {
        try_files $uri $uri/ /index.html;
    }

    # CarPlay WebSocket proxy (react-carplay backend on port 3001)
    location /ws {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/s52 /etc/nginx/sites-enabled/s52
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
sudo systemctl enable nginx

CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/ || echo "000")
if [[ "$CODE" == "200" ]]; then
  echo "    Homepage responds: HTTP $CODE"
else
  echo "    WARNING: homepage returned HTTP $CODE — run: sudo tail -50 /var/log/nginx/error.log" >&2
fi

# ── 5. CarPlay backend service (react-carplay) ────────────────────────────────
# This service will do nothing until you:
#   cd ~/s52-display && npm install react-carplay
#   Then update src/components/CarPlayReceiver.jsx with the real component.
echo "[5/8] Setting up CarPlay service..."
sudo tee /etc/systemd/system/s52-carplay.service > /dev/null <<SERVICE
[Unit]
Description=S52 CarPlay Backend (react-carplay)
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node $APP_DIR/carplay-server.js
Restart=on-failure
RestartSec=3
Environment=PORT=3001

[Install]
WantedBy=multi-user.target
SERVICE

# Placeholder carplay server — replace when react-carplay is installed
if [ ! -f "$APP_DIR/carplay-server.js" ]; then
  cat > "$APP_DIR/carplay-server.js" <<'JS'
// Placeholder — replace with react-carplay server when dongle arrives
// See: https://github.com/rhysmorgan134/react-carplay
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('CarPlay backend placeholder\n');
});
server.listen(process.env.PORT || 3001, () => {
  console.log('CarPlay placeholder listening on', process.env.PORT || 3001);
});
JS
fi

sudo systemctl daemon-reload
sudo systemctl enable s52-carplay
sudo systemctl start s52-carplay

# ── 6. Carlinkit dongle udev rules ────────────────────────────────────────────
echo "[6/8] Adding Carlinkit udev rules..."
sudo tee /etc/udev/rules.d/99-carlinkit.rules > /dev/null <<'UDEV'
# Carlinkit Wireless CarPlay dongle
SUBSYSTEM=="usb", ATTRS{idVendor}=="1314", ATTRS{idProduct}=="152*", MODE="0660", GROUP="plugdev"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0e8d", MODE="0660", GROUP="plugdev"
UDEV
sudo udevadm control --reload-rules
sudo usermod -aG plugdev "$SERVICE_USER"

# ── 7. Display: rotation + resolution + no sleep ──────────────────────────────
echo "[7/8] Configuring display..."
CONFIG="/boot/firmware/config.txt"
[ -f "$CONFIG" ] || CONFIG="/boot/config.txt"

# Remove prior S52 firmware lines (avoid duplicates if setup is re-run)
sudo sed -i '/^# S52 Solutions/d' "$CONFIG"
sudo sed -i '/^display_rotate/d' "$CONFIG"
sudo sed -i '/^hdmi_group/d'     "$CONFIG"
sudo sed -i '/^hdmi_mode/d'      "$CONFIG"
sudo sed -i '/^hdmi_cvt/d'       "$CONFIG"
sudo sed -i '/^hdmi_drive/d'     "$CONFIG"

# Pi OS Bookworm + labwc: portrait and mode for the car panel are set per-output
# by wlr-randr in s52-kiosk-launch.sh (~/.config/s52-display-layout.conf).
# Firmware hdmi_cvt + display_rotate affect KMS globally and break a second HDMI
# used as a normal desktop monitor — leave them commented unless this Pi has
# only the car display connected (then uncomment the optional block below).
sudo tee -a "$CONFIG" > /dev/null <<'DISPLAY'

# S52 Solutions — car HDMI: use ~/.config/s52-display-layout.conf + wlr-randr
# Optional single-head only (uncomment if no second monitor on HDMI):
# hdmi_group=2
# hdmi_mode=87
# hdmi_cvt=480 320 60 6 0 0 0
# hdmi_drive=1
# display_rotate=1
DISPLAY

# Disable screen blanking system-wide
sudo tee /etc/X11/xorg.conf.d/10-no-blanking.conf > /dev/null <<'XORG'
Section "ServerFlags"
    Option "BlankTime"  "0"
    Option "StandbyTime" "0"
    Option "SuspendTime" "0"
    Option "OffTime" "0"
EndSection
XORG

# ── 8. Car display — manual command only (no autostart; use Pi as normal desktop + Cursor) ─
echo "[8/8] Car display launcher (on demand)..."
mkdir -p "/home/$SERVICE_USER/.config/autostart"
mkdir -p "/home/$SERVICE_USER/.local/bin"
mkdir -p "/home/$SERVICE_USER/.local/share/applications"

rm -f "/home/$SERVICE_USER/.config/autostart/s52-kiosk.desktop"
install -m 755 "$SOURCE_DIR/scripts/s52-kiosk-launch.sh" "/home/$SERVICE_USER/.local/bin/s52-kiosk-launch.sh"
install -m 755 "$SOURCE_DIR/scripts/s52-kiosk-exit-server.py" "/home/$SERVICE_USER/.local/bin/s52-kiosk-exit-server.py"
install -m 755 "$SOURCE_DIR/scripts/s52-car-display" "/home/$SERVICE_USER/.local/bin/s52-car-display"

cp "$SOURCE_DIR/scripts/s52-display-layout.conf.example" "/home/$SERVICE_USER/.config/s52-display-layout.conf.example"
if [ ! -f "/home/$SERVICE_USER/.config/s52-display-layout.conf" ]; then
  cp "/home/$SERVICE_USER/.config/s52-display-layout.conf.example" "/home/$SERVICE_USER/.config/s52-display-layout.conf"
fi

# Optional: app-menu shortcut (launch car UI when you want; not on login)
tee "/home/$SERVICE_USER/.local/share/applications/s52-car-display.desktop" > /dev/null <<DESKTOP
[Desktop Entry]
Type=Application
Name=S52 Car Display
Comment=Fullscreen car UI — run when ready (not on boot)
Exec=/home/$SERVICE_USER/.local/bin/s52-car-display
Icon=applications-internet
Terminal=false
Categories=Utility;
DESKTOP

# No unlock prompt if you re-enable keyring autostart later
for keyring in gnome-keyring-secrets.desktop gnome-keyring-ssh.desktop gnome-keyring-pkcs11.desktop gnome-keyring-gpg.desktop; do
  tee "/home/$SERVICE_USER/.config/autostart/$keyring" > /dev/null <<'KEYRING'
[Desktop Entry]
Hidden=true
KEYRING
done

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Reboot:  sudo reboot   (optional)"
echo ""
echo "  Car display is NOT auto-started."
echo "  When you want kiosk / car UI, in a terminal run:   s52-car-display"
echo "  (Ensure PATH includes ~/.local/bin — open a new terminal after first setup.)"
echo "  Or start “S52 Car Display” from the app menu."
echo "  Exit kiosk: close Chromium or  pkill chromium"
echo ""
echo "  HDMI / Wayland layout: ~/.config/s52-display-layout.conf"
echo ""
echo "  When Carlinkit dongle arrives:"
echo "  cd ~/s52-display"
echo "  npm install react-carplay"
echo "  (then update CarPlayReceiver.jsx)"
echo "============================================"
echo ""
