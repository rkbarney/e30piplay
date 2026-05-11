#!/bin/bash
# =============================================================================
# S52 Solutions — Phase 2 setup (Raspberry Pi OS Lite + cage + Chromium kiosk)
# Flash Pi OS Lite (64-bit Bookworm), boot once with SSH, clone this repo, then:
#   bash setup-phase2.sh
# Do NOT use `source` or `. setup-phase2.sh`.
# =============================================================================
set -euo pipefail

APP_DIR="/home/$USER/tinycarplay"
SERVICE_USER="$USER"
S52_UID="$(id -u)"

echo ""
echo "=== S52 Solutions Display Setup — Phase 2 (Pi OS Lite + cage) ==="
echo ""

if [[ ! -f /etc/debian_version ]]; then
  echo "This script expects Raspberry Pi OS / Debian." >&2
  exit 1
fi

if systemd-analyze default >/dev/null 2>&1 && ! dpkg -l | grep -q '^ii.*libwayland-server0'; then
  : #Lite might still have minimal wayland - optional sanity check skipped
fi

# ── 1. System packages ────────────────────────────────────────────────────────
echo "[1/9] Updating system…"
sudo apt-get update -qq
sudo apt-get install -y -qq \
  cage \
  seatd \
  chromium \
  nginx \
  curl \
  alsa-utils \
  openssh-server \
  avahi-daemon \
  python3 \
  rsync \
  git

sudo systemctl enable ssh
sudo systemctl start ssh
sudo systemctl enable avahi-daemon
sudo systemctl restart avahi-daemon

# wlroots-based compositors often expect seatd on headless/systemd boots.
sudo systemctl enable seatd
sudo systemctl restart seatd

# ── 2. Node.js ─────────────────────────────────────────────────────────────────
echo "[2/9] Installing Node.js…"
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* ]]; then
  NS_URL="https://deb.nodesource.com/setup_20.x"
  HTTP_CODE=$(curl -sS -o /tmp/nodesource_setup.sh -w "%{http_code}" --max-time 60 "$NS_URL") || true
  if [[ "$HTTP_CODE" == "200" ]] && sudo -E bash /tmp/nodesource_setup.sh; then
    sudo apt-get install -y nodejs
  else
    echo "    NodeSource failed (HTTP ${HTTP_CODE:-error}). Using Debian nodejs…"
    sudo apt-get install -y nodejs npm
  fi
  rm -f /tmp/nodesource_setup.sh
fi
echo "    Node $(node -v) / npm $(npm -v)"

# ── 3. App install ───────────────────────────────────────────────────────────
echo "[3/9] Installing app…"
mkdir -p "$APP_DIR"
SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
SOURCE_DIR="$(cd "$(dirname -- "$SCRIPT_PATH")" && pwd)"
rsync -a --exclude node_modules --exclude .git "$SOURCE_DIR/" "$APP_DIR/"
cd "$APP_DIR"
npm install --silent
npm run build

WEB_ROOT="/var/www/s52-display"
echo "[3b/9] Publishing web root → $WEB_ROOT …"
sudo mkdir -p "$WEB_ROOT"
sudo rsync -a --delete "$APP_DIR/dist/" "$WEB_ROOT/"
sudo chown -R root:www-data "$WEB_ROOT"
sudo find "$WEB_ROOT" -type d -exec chmod 755 {} \;
sudo find "$WEB_ROOT" -type f -exec chmod 644 {} \;

# ── 4. nginx ─────────────────────────────────────────────────────────────────
echo "[4/9] Configuring nginx…"
sudo tee /etc/nginx/sites-available/s52 > /dev/null <<'NGINX'
server {
    listen 80 default_server;
    root /var/www/s52-display;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

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

# ── 5. CarPlay backend ────────────────────────────────────────────────────────
echo "[5/9] CarPlay placeholder service…"
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

if [ ! -f "$APP_DIR/carplay-server.js" ]; then
  cat > "$APP_DIR/carplay-server.js" <<'JS'
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
sudo systemctl restart s52-carplay || true

# ── 6. Carlinkit udev ─────────────────────────────────────────────────────────
echo "[6/9] Carlinkit udev rules…"
sudo tee /etc/udev/rules.d/99-carlinkit.rules > /dev/null <<'UDEV'
SUBSYSTEM=="usb", ATTRS{idVendor}=="1314", ATTRS{idProduct}=="152*", MODE="0660", GROUP="plugdev"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0e8d", MODE="0660", GROUP="plugdev"
UDEV
sudo udevadm control --reload-rules

# ── 7. Groups / linger (required for /run/user/$UID when no desktop login) ────
echo "[7/9] User groups + systemd linger…"
sudo usermod -aG plugdev,video,render,input "$SERVICE_USER"
if getent group seat >/dev/null; then
  sudo usermod -aG seat "$SERVICE_USER"
fi
sudo loginctl enable-linger "$SERVICE_USER"
sudo systemctl start "user@${S52_UID}.service" 2>/dev/null || true

# ── 8. Display firmware notes + kiosk binaries ────────────────────────────────
echo "[8/9] Display config + kiosk scripts…"
CONFIG="/boot/firmware/config.txt"
[[ -f "$CONFIG" ]] || CONFIG="/boot/config.txt"

sudo sed -i '/^# S52 Phase 2/d' "$CONFIG" 2>/dev/null || true
sudo tee -a "$CONFIG" > /dev/null <<'DISPLAY'

# S52 Phase 2 — Pi OS Lite + cage: rotation/mode here (not wlr-randr).
# Uncomment ONE setup after measuring your panel. See docs/phase2-getting-started.md
# Example: 90° clockwise for portrait HDMI:
# display_rotate=1
# Custom mode (example only — tune for your display):
# hdmi_group=2
# hdmi_mode=87
# hdmi_cvt=480 320 60 6 0 0 0
# hdmi_drive=1
DISPLAY

mkdir -p "/home/$SERVICE_USER/.local/bin"
mkdir -p "/home/$SERVICE_USER/.config"

install -m 755 "$SOURCE_DIR/scripts/s52-phase2-kiosk-inner.sh" "/home/$SERVICE_USER/.local/bin/s52-phase2-kiosk-inner.sh"
install -m 755 "$SOURCE_DIR/scripts/s52-kiosk-exit-server.py" "/home/$SERVICE_USER/.local/bin/s52-kiosk-exit-server.py"

cp "$SOURCE_DIR/scripts/s52-display-layout.conf.example" "/home/$SERVICE_USER/.config/s52-display-layout.conf.example"
if [[ ! -f "/home/$SERVICE_USER/.config/s52-display-layout.conf" ]]; then
  cp "/home/$SERVICE_USER/.config/s52-display-layout.conf.example" "/home/$SERVICE_USER/.config/s52-display-layout.conf"
fi

install -m 755 "$SOURCE_DIR/scripts/s52-boot-branding.sh" "/home/$SERVICE_USER/.local/bin/s52-boot-branding.sh" 2>/dev/null || true

# ── 9. systemd: cage kiosk ────────────────────────────────────────────────────
echo "[9/9] systemd unit s52-cage-kiosk.service …"

sudo tee /etc/systemd/system/s52-cage-kiosk.service > /dev/null <<SERVICE
[Unit]
Description=S52 cage + Chromium kiosk (Phase 2)
After=network-online.target nginx.service
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
Environment=XDG_RUNTIME_DIR=/run/user/${S52_UID}
SupplementaryGroups=video render input plugdev
# Wait for user runtime dir (loginctl linger)
ExecStartPre=/bin/bash -c 'for i in {1..120}; do [[ -d /run/user/${S52_UID} ]] && exit 0; sleep 0.25; done; exit 1'
ExecStart=/usr/bin/cage -- /home/${SERVICE_USER}/.local/bin/s52-phase2-kiosk-inner.sh
Restart=on-failure
RestartSec=4

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable s52-cage-kiosk.service
sudo systemctl restart s52-cage-kiosk.service || {
  echo ""
  echo "  WARNING: s52-cage-kiosk failed to start. After reboot it often comes up cleanly."
  echo "  Logs: journalctl -u s52-cage-kiosk -b --no-pager"
  echo ""
}

echo ""
echo "============================================"
echo "  Phase 2 setup complete"
echo ""
echo "  Reboot recommended (seatd + linger + DRM):"
echo "    sudo reboot"
echo ""
echo "  Useful commands:"
echo "    sudo systemctl status s52-cage-kiosk nginx"
echo "    journalctl -u s52-cage-kiosk -f"
echo "    sudo systemctl stop s52-cage-kiosk    # maintenance shell / HDMI console"
echo ""
echo "  Display rotation: edit sudo nano /boot/firmware/config.txt"
echo "    (see block marked \"S52 Phase 2\")"
echo ""
echo "  Full walkthrough: docs/phase2-getting-started.md"
echo "============================================"
echo ""
