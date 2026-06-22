#!/usr/bin/env bash
# Idempotent GPS puck provisioning: gpsd packages, udev → /dev/gps0, systemd.
# Invoked from setup.sh and s52-deploy.sh (both run as root).
set -euo pipefail

APP_DIR="${APP_DIR:-/home/${SUDO_USER:-$(id -un)}/e30piplay}"
SOURCE_DIR="${SOURCE_DIR:-$APP_DIR}"

echo "[gps] Installing gpsd packages…"
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq gpsd gpsd-clients

echo "[gps] Installing udev rule → /dev/gps0…"
install -m 644 "$SOURCE_DIR/scripts/99-gps.rules" /etc/udev/rules.d/99-gps.rules
udevadm control --reload-rules
udevadm trigger --subsystem-match=tty 2>/dev/null || true

echo "[gps] Configuring /etc/default/gpsd…"
tee /etc/default/gpsd > /dev/null <<'GPSD'
START_DAEMON="true"
GPSD_OPTIONS="-n"
DEVICES="-s 4800 /dev/gps0"
USBAUTO="false"
GPSD

systemctl enable gpsd 2>/dev/null || true
systemctl restart gpsd 2>/dev/null || true

mkdir -p "$APP_DIR/drive-logs"
chown "${SUDO_USER:-$(id -un)}:${SUDO_USER:-$(id -un)}" "$APP_DIR/drive-logs" 2>/dev/null || true

echo "[gps] Done. Verify: ls -l /dev/gps0 && gpspipe -w -n 5 | grep TPV"
