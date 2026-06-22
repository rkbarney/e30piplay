#!/usr/bin/env bash
# Idempotent GPS puck provisioning: gpsd packages, udev → /dev/gps0, standalone
# systemd unit. Debian's socket-activated gpsd often fails silently on Prolific
# BU-353-class pucks (067b:23a3 @ 4800 baud) — see Linux GPS install guides.
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

# Legacy /etc/default/gpsd — keep for packages that read it; OPTIONS must be set
# or systemd warns on every start.
echo "[gps] Writing /etc/default/gpsd…"
tee /etc/default/gpsd > /dev/null <<'GPSD'
START_DAEMON="false"
GPSD_OPTIONS="-n"
DEVICES="/dev/gps0"
USBAUTO="false"
OPTIONS=""
GPSD

echo "[gps] Disabling socket-activated gpsd (known USB puck footgun)…"
systemctl stop gpsd gpsd.socket 2>/dev/null || true
systemctl disable gpsd gpsd.socket 2>/dev/null || true
systemctl mask gpsd.socket 2>/dev/null || true

echo "[gps] Installing standalone gpsd unit…"
install -m 644 "$SOURCE_DIR/scripts/s52-gpsd-standalone.service" \
  /etc/systemd/system/s52-gpsd-standalone.service
systemctl daemon-reload
systemctl enable s52-gpsd-standalone.service
systemctl restart s52-gpsd-standalone.service

mkdir -p "$APP_DIR/drive-logs"
chown "${SUDO_USER:-$(id -un)}:${SUDO_USER:-$(id -un)}" "$APP_DIR/drive-logs" 2>/dev/null || true

# If the puck speaks SiRF binary instead of NMEA, switch it once (no-op for NMEA).
if [[ -e /dev/gps0 ]] && command -v gpsctl >/dev/null; then
  systemctl stop s52-gpsd-standalone.service 2>/dev/null || true
  stty -F /dev/gps0 4800 cs8 -cstopb -parenb raw -echo 2>/dev/null || true
  gpsctl -n -D 4 /dev/gps0 2>/dev/null || true
  systemctl start s52-gpsd-standalone.service
fi

echo "[gps] Done."
echo "    ls -l /dev/gps0"
echo "    systemctl status s52-gpsd-standalone"
echo "    gpspipe -w -n 20 | grep TPV"
