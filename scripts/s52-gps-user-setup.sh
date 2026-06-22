#!/usr/bin/env bash
# Bench fallback when system gpsd is not installed yet (no sudo for apt).
# Extracts gpsd debs to ~/local/gpsd-root and runs gpsd as a user service on
# /dev/gps0 or /dev/ttyUSB0. Prefer scripts/s52-gps-setup.sh (via setup/deploy)
# for the in-car install.
set -euo pipefail

GPS_ROOT="${GPS_ROOT:-$HOME/local/gpsd-root}"
GPSD_BIN="$GPS_ROOT/usr/sbin/gpsd"
GPSPIPE_BIN="$GPS_ROOT/usr/bin/gpspipe"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$UNIT_DIR/s52-gpsd.service"

device_path() {
  if [[ -e /dev/gps0 ]]; then
    echo /dev/gps0
  elif [[ -e /dev/ttyUSB0 ]]; then
    echo /dev/ttyUSB0
  else
    echo "No GPS serial device found (/dev/gps0 or /dev/ttyUSB0)." >&2
    exit 1
  fi
}

if [[ ! -x "$GPSD_BIN" ]]; then
  echo "==> Downloading gpsd packages (no root required)…"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  cd "$tmp"
  apt-get download gpsd gpsd-clients
  mkdir -p "$GPS_ROOT"
  for deb in gpsd_*.deb gpsd-clients_*.deb; do
    dpkg-deb -x "$deb" "$GPS_ROOT"
  done
fi

DEV="$(device_path)"
mkdir -p "$UNIT_DIR"

cat > "$UNIT_FILE" <<UNIT
[Unit]
Description=S52 user gpsd (bench fallback)
After=default.target

[Service]
ExecStart=$GPSD_BIN -N -n $DEV
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now s52-gpsd.service

echo "==> User gpsd running on $DEV"
echo "    gpspipe: $GPSPIPE_BIN"
"$GPSPIPE_BIN" -w -n 3 | grep TPV || true
