#!/bin/bash
# =============================================================================
# S52 Solutions — Raspberry Pi 5 (Pi OS Lite + cage + Chromium kiosk + nginx)
#
# 1. Flash Raspberry Pi OS Lite (64-bit) with SSH enabled (Raspberry Pi Imager).
# 2. Clone this repo to ~/e30piplay (default), or set APP_DIR before running.
# 3. bash setup.sh && sudo reboot
#
# Optional environment (defaults shown):
#   APP_DIR=~/e30piplay
#   S52_DISPLAY_ROTATE=1     # 0 normal, 1=90° CW, 2=180°, 3=270°
#   S52_CUSTOM_HDMI=0        # 1 = add hdmi_group/mode/cvt example for 480×320 panel
#
# Do NOT use `source` or `. setup.sh`.
# =============================================================================
set -euo pipefail

SERVICE_USER="$USER"
S52_UID="$(id -u)"
APP_DIR="${APP_DIR:-$HOME/e30piplay}"
S52_DISPLAY_ROTATE="${S52_DISPLAY_ROTATE:-1}"
S52_CUSTOM_HDMI="${S52_CUSTOM_HDMI:-0}"

echo ""
echo "=== S52 Solutions — Pi OS Lite + cage ==="
echo "    APP_DIR=$APP_DIR"
echo "    display_rotate=$S52_DISPLAY_ROTATE  S52_CUSTOM_HDMI=$S52_CUSTOM_HDMI"
echo ""

if [[ ! -f /etc/debian_version ]]; then
  echo "This script expects Raspberry Pi OS / Debian." >&2
  exit 1
fi

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
SOURCE_DIR="$(cd "$(dirname -- "$SCRIPT_PATH")" && pwd)"

# ── 1. Packages ───────────────────────────────────────────────────────────────
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
    echo "    NodeSource failed (HTTP ${HTTP_CODE:-error}). Installing Debian nodejs…"
    sudo apt-get install -y nodejs npm
  fi
  rm -f /tmp/nodesource_setup.sh
fi
echo "    Node $(node -v) / npm $(npm -v)"

# ── 3. App ───────────────────────────────────────────────────────────────────
echo "[3/9] Installing app → $APP_DIR …"
mkdir -p "$APP_DIR"
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

# ── 4. nginx ───────────────────────────────────────────────────────────────────
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
  echo "    WARNING: homepage returned HTTP $CODE — sudo tail -50 /var/log/nginx/error.log" >&2
fi

# ── 5. CarPlay placeholder ─────────────────────────────────────────────────────
echo "[5/9] CarPlay backend placeholder…"
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

if [[ ! -f "$APP_DIR/carplay-server.js" ]]; then
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

# ── 7. Groups + linger ────────────────────────────────────────────────────────
echo "[7/9] User groups + systemd linger…"
sudo usermod -aG plugdev,video,render,input "$SERVICE_USER"
if getent group seat >/dev/null; then
  sudo usermod -aG seat "$SERVICE_USER"
fi
sudo loginctl enable-linger "$SERVICE_USER"
sudo systemctl start "user@${S52_UID}.service" 2>/dev/null || true

# ── 8. Display firmware (/boot/firmware/config.txt) ──────────────────────────
echo "[8/9] config.txt (display_rotate + optional HDMI mode)…"
CONFIG="/boot/firmware/config.txt"
[[ -f "$CONFIG" ]] || CONFIG="/boot/config.txt"

sudo sed -i '/^# --- S52 e30piplay begin/,/^# --- S52 e30piplay end/d' "$CONFIG" 2>/dev/null || true
sudo sed -i '/^# S52 Solutions/d' "$CONFIG" 2>/dev/null || true
sudo sed -i '/^# S52 Phase 2/d' "$CONFIG" 2>/dev/null || true
sudo sed -i '/^display_rotate=/d' "$CONFIG"
sudo sed -i '/^hdmi_group=/d' "$CONFIG"
sudo sed -i '/^hdmi_mode=/d' "$CONFIG"
sudo sed -i '/^hdmi_cvt=/d' "$CONFIG"
sudo sed -i '/^hdmi_drive=/d' "$CONFIG"

{
  echo ""
  echo "# --- S52 e30piplay begin (re-run setup.sh to regenerate; or set S52_DISPLAY_ROTATE / S52_CUSTOM_HDMI)"
  echo "display_rotate=${S52_DISPLAY_ROTATE}"
  if [[ "${S52_CUSTOM_HDMI}" == "1" ]]; then
    echo "hdmi_group=2"
    echo "hdmi_mode=87"
    echo "hdmi_cvt=480 320 60 6 0 0 0"
    echo "hdmi_drive=1"
  fi
  echo "# --- S52 e30piplay end"
} | sudo tee -a "$CONFIG" > /dev/null

# ── 9. Kiosk scripts + systemd ────────────────────────────────────────────────
echo "[9/9] cage kiosk service + console autologin…"
mkdir -p "/home/$SERVICE_USER/.local/bin"
mkdir -p "/home/$SERVICE_USER/.config"

install -m 755 "$SOURCE_DIR/scripts/s52-kiosk-inner.sh" "/home/$SERVICE_USER/.local/bin/s52-kiosk-inner.sh"
install -m 755 "$SOURCE_DIR/scripts/s52-kiosk-exit-server.py" "/home/$SERVICE_USER/.local/bin/s52-kiosk-exit-server.py"
install -m 755 "$SOURCE_DIR/scripts/s52-car-display" "/home/$SERVICE_USER/.local/bin/s52-car-display"

cp "$SOURCE_DIR/scripts/s52-display-layout.conf.example" "/home/$SERVICE_USER/.config/s52-display-layout.conf.example"
if [[ ! -f "/home/$SERVICE_USER/.config/s52-display-layout.conf" ]]; then
  cp "/home/$SERVICE_USER/.config/s52-display-layout.conf.example" "/home/$SERVICE_USER/.config/s52-display-layout.conf"
fi

install -m 755 "$SOURCE_DIR/scripts/s52-boot-branding.sh" "/home/$SERVICE_USER/.local/bin/s52-boot-branding.sh" 2>/dev/null || true

sudo tee /etc/systemd/system/s52-cage-kiosk.service > /dev/null <<SERVICE
[Unit]
Description=S52 cage + Chromium kiosk
After=network-online.target nginx.service
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
Environment=XDG_RUNTIME_DIR=/run/user/${S52_UID}
SupplementaryGroups=video render input plugdev
ExecStartPre=/bin/bash -c 'for i in {1..120}; do [[ -d /run/user/${S52_UID} ]] && exit 0; sleep 0.25; done; exit 1'
ExecStart=/usr/bin/cage -- /home/${SERVICE_USER}/.local/bin/s52-kiosk-inner.sh
Restart=on-failure
RestartSec=4

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable s52-cage-kiosk.service
sudo systemctl restart s52-cage-kiosk.service || {
  echo ""
  echo "  NOTE: s52-cage-kiosk did not start cleanly yet — common before first reboot."
  echo "  Logs: journalctl -u s52-cage-kiosk -b --no-pager"
}

echo "[9b] Console autologin (tty1 — skips login: prompt on HDMI)…"
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
sudo tee /etc/systemd/system/getty@tty1.service.d/autologin.conf > /dev/null <<AUTOLOGIN
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin ${SERVICE_USER} --noclear %I \$TERM
AUTOLOGIN
sudo systemctl daemon-reload

echo ""
echo "============================================"
echo "  Setup complete"
echo ""
echo "  HDMI boots straight to your user + kiosk (console autologin tty1)."
echo "  Reboot now:  sudo reboot"
echo ""
echo "  App copy:  $APP_DIR"
echo "  Iteration:  cd $APP_DIR && git pull && npm ci && npm run build"
echo "             sudo rsync -a --delete dist/ /var/www/s52-display/"
echo "             sudo systemctl restart s52-cage-kiosk"
echo ""
echo "  Logs:     journalctl -u s52-cage-kiosk -f"
echo "  Stop UI:  sudo systemctl stop s52-cage-kiosk"
echo ""
echo "  CarPlay:  see README — upstream is Electron (github.com/rhysmorgan134/react-carplay), not npm install"
echo "            (then wire CarPlayReceiver.jsx — see README)"
echo "============================================"
echo ""
