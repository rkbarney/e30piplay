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
#   S52_SKIP_REACT_CARPLAY_APPIMAGE=1   # skip upstream Electron download (offline / headless)
#   REACT_CARPLAY_VERSION=4.0.5         # passed through to install-react-carplay-appimage.sh
#
# Do NOT use `source` or `. setup.sh`.
# =============================================================================
set -euo pipefail

SERVICE_USER="$USER"
S52_UID="$(id -u)"
APP_DIR="${APP_DIR:-$HOME/e30piplay}"
S52_DISPLAY_ROTATE="${S52_DISPLAY_ROTATE:-1}"
S52_CUSTOM_HDMI="${S52_CUSTOM_HDMI:-0}"
S52_SKIP_REACT_CARPLAY_APPIMAGE="${S52_SKIP_REACT_CARPLAY_APPIMAGE:-0}"

echo ""
echo "=== S52 Solutions — Pi OS Lite + cage ==="
echo "    APP_DIR=$APP_DIR"
echo "    display_rotate=$S52_DISPLAY_ROTATE  S52_CUSTOM_HDMI=$S52_CUSTOM_HDMI"
echo "    skip AppImage=${S52_SKIP_REACT_CARPLAY_APPIMAGE} (set S52_SKIP_REACT_CARPLAY_APPIMAGE=1 to skip Electron download)"
echo ""

if [[ ! -f /etc/debian_version ]]; then
  echo "This script expects Raspberry Pi OS / Debian." >&2
  exit 1
fi

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
SOURCE_DIR="$(cd "$(dirname -- "$SCRIPT_PATH")" && pwd)"

# ── 1. Packages ───────────────────────────────────────────────────────────────
echo "[1/10] Updating system…"
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
echo "[2/10] Installing Node.js…"
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
echo "[3/10] Installing app → $APP_DIR …"
mkdir -p "$APP_DIR"
rsync -a --exclude node_modules --exclude .git "$SOURCE_DIR/" "$APP_DIR/"
cd "$APP_DIR"
npm install --silent
npm run build

WEB_ROOT="/var/www/s52-display"
echo "[3b/10] Publishing web root → $WEB_ROOT …"
sudo mkdir -p "$WEB_ROOT"
sudo rsync -a --delete "$APP_DIR/dist/" "$WEB_ROOT/"
sudo chown -R root:www-data "$WEB_ROOT"
sudo find "$WEB_ROOT" -type d -exec chmod 755 {} \;
sudo find "$WEB_ROOT" -type f -exec chmod 644 {} \;

# ── 4. nginx ───────────────────────────────────────────────────────────────────
echo "[4/10] Configuring nginx…"
sudo tee /etc/nginx/sites-available/s52 > /dev/null <<'NGINX'
server {
    listen 80 default_server;
    root /var/www/s52-display;
    index index.html;

    # ^~ stops regex/other locations from stealing /api/* ; POST must not hit try_files (→ 405).
    location ^~ /api {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

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

# ── 5. CarPlay launcher API + sudo helper ─────────────────────────────────────
echo "[5/10] CarPlay launcher API (carplay-server.cjs + switch script)…"
# install(1) fails with "same file" when SOURCE_DIR == APP_DIR (common: bash setup.sh from ~/e30piplay).
# That aborts set -e before the systemd unit is updated — stale carplay-server.js keeps broken ExecStart.
if [[ -f "$APP_DIR/carplay-server.cjs" ]] && cmp -s "$SOURCE_DIR/carplay-server.cjs" "$APP_DIR/carplay-server.cjs"; then
  chmod 644 "$APP_DIR/carplay-server.cjs" || true
else
  install -m 644 "$SOURCE_DIR/carplay-server.cjs" "$APP_DIR/carplay-server.cjs"
fi
rm -f "$APP_DIR/carplay-server.js"

sudo tee /etc/systemd/system/s52-carplay.service > /dev/null <<SERVICE
[Unit]
Description=S52 CarPlay launcher API (switch kiosk / Electron)
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node $APP_DIR/carplay-server.cjs
Restart=on-failure
RestartSec=3
Environment=PORT=3001

[Install]
WantedBy=multi-user.target
SERVICE

sudo install -m 755 "$SOURCE_DIR/scripts/s52-carplay-switch.sh" /usr/local/bin/s52-carplay-switch.sh

sudo tee /etc/sudoers.d/s52-carplay-launcher > /dev/null <<SUDOERS
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/local/bin/s52-carplay-switch.sh
SUDOERS
sudo chmod 440 /etc/sudoers.d/s52-carplay-launcher
sudo visudo -cf /etc/sudoers.d/s52-carplay-launcher

sudo systemctl daemon-reload
sudo systemctl enable s52-carplay
sudo systemctl restart s52-carplay || true

# ── 6. Carlinkit udev ─────────────────────────────────────────────────────────
echo "[6/10] Carlinkit udev rules…"
sudo tee /etc/udev/rules.d/99-carlinkit.rules > /dev/null <<'UDEV'
SUBSYSTEM=="usb", ATTRS{idVendor}=="1314", ATTRS{idProduct}=="152*", MODE="0660", GROUP="plugdev"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0e8d", MODE="0660", GROUP="plugdev"
UDEV
sudo udevadm control --reload-rules

# ── 7. Groups + linger ────────────────────────────────────────────────────────
echo "[7/10] User groups + systemd linger…"
sudo usermod -aG plugdev,video,render,input "$SERVICE_USER"
if getent group seat >/dev/null; then
  sudo usermod -aG seat "$SERVICE_USER"
fi
sudo loginctl enable-linger "$SERVICE_USER"
sudo systemctl start "user@${S52_UID}.service" 2>/dev/null || true

# ── 8. Display firmware (/boot/firmware/config.txt) ──────────────────────────
echo "[8/10] config.txt (display_rotate + optional HDMI mode)…"
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
echo "[9/10] cage kiosk service + console autologin…"
mkdir -p "/home/$SERVICE_USER/.local/bin"
mkdir -p "/home/$SERVICE_USER/.config"

install -m 755 "$SOURCE_DIR/scripts/s52-kiosk-inner.sh" "/home/$SERVICE_USER/.local/bin/s52-kiosk-inner.sh"
install -m 755 "$SOURCE_DIR/scripts/s52-react-carplay-inner.sh" "/home/$SERVICE_USER/.local/bin/s52-react-carplay-inner.sh"
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

sudo tee /etc/systemd/system/s52-cage-react-carplay.service > /dev/null <<SERVICE
[Unit]
Description=S52 cage + react-carplay Electron (from kiosk CarPlay screen)
After=network-online.target nginx.service
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
Environment=XDG_RUNTIME_DIR=/run/user/${S52_UID}
SupplementaryGroups=video render input plugdev
ExecStartPre=/bin/bash -c 'for i in {1..120}; do [[ -d /run/user/${S52_UID} ]] && exit 0; sleep 0.25; done; exit 1'
ExecStart=/usr/bin/cage -- /home/${SERVICE_USER}/.local/bin/s52-react-carplay-inner.sh
Restart=no
ExecStopPost=/usr/bin/systemctl start s52-cage-kiosk.service

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload

echo "[9b/10] Console autologin (tty1 — skips login: prompt on HDMI)…"
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
sudo tee /etc/systemd/system/getty@tty1.service.d/autologin.conf > /dev/null <<AUTOLOGIN
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin ${SERVICE_USER} --noclear %I \$TERM
AUTOLOGIN
sudo systemctl daemon-reload

# ── 10. Upstream react-carplay Electron (AppImage) ─────────────────────────────
if [[ "${S52_SKIP_REACT_CARPLAY_APPIMAGE}" == "1" ]]; then
  echo "[10/10] Skipping react-carplay AppImage (S52_SKIP_REACT_CARPLAY_APPIMAGE=1)."
  echo "        Install later: bash $APP_DIR/scripts/install-react-carplay-appimage.sh"
else
  echo "[10/10] Installing react-carplay AppImage (rhysmorgan134/react-carplay)…"
  export REACT_CARPLAY_VERSION="${REACT_CARPLAY_VERSION:-4.0.5}"
  if bash "$SOURCE_DIR/scripts/install-react-carplay-appimage.sh"; then
    echo "    react-carplay launcher: ~/.local/bin/react-carplay"
  else
    echo "" >&2
    echo "  WARNING: AppImage step failed (network, wrong arch, or GitHub rate limit)." >&2
    echo "           The kiosk works; install Electron when ready:" >&2
    echo "             bash $APP_DIR/scripts/install-react-carplay-appimage.sh" >&2
    echo "" >&2
  fi
fi

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
echo "             sudo systemctl restart s52-cage-kiosk s52-carplay"
echo ""
echo "  Logs:     journalctl -u s52-cage-kiosk -f"
echo "  Stop UI:  sudo systemctl stop s52-cage-kiosk"
echo ""
echo "  CarPlay:  Use + → Open CarPlay on the display (Electron via cage). Quit Electron → kiosk returns."
echo "            SSH: sudo /usr/local/bin/s52-carplay-switch.sh return"
echo "============================================"
echo ""
