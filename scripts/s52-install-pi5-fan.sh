#!/usr/bin/env bash
# Configure the Pi 5 PWM fan (Argon Neo connects to the board header) to spin
# early — effectively always-on in the car — instead of the default ~47°C kick-in.
#
# Run on the Pi:  bash ~/e30piplay/scripts/s52-install-pi5-fan.sh
# Requires reboot to apply config.txt changes.
set -euo pipefail

CONFIG="${S52_BOOT_CONFIG:-/boot/firmware/config.txt}"
MARKER="# s52-pi5-fan-always-on"

if [[ ! -f "$CONFIG" ]]; then
  echo "ERROR: ${CONFIG} not found" >&2
  exit 1
fi

if grep -qF "$MARKER" "$CONFIG" 2>/dev/null; then
  echo "Fan config already present in ${CONFIG}"
else
  echo "Appending Pi 5 fan curve to ${CONFIG}…"
  sudo tee -a "$CONFIG" > /dev/null <<EOF

${MARKER}
# Spin from ~25°C (always-on once the Pi is warm). Ramp speed with temp.
dtparam=cooling_fan=on
dtparam=fan_temp0=25000,fan_temp0_hyst=0,fan_temp0_speed=100
dtparam=fan_temp1=45000,fan_temp1_hyst=2000,fan_temp1_speed=160
dtparam=fan_temp2=52000,fan_temp2_hyst=2000,fan_temp2_speed=220
dtparam=fan_temp3=60000,fan_temp3_hyst=2000,fan_temp3_speed=255
EOF
  echo "Done. Reboot required: sudo reboot"
fi

if [[ -r /sys/class/thermal/cooling_device0/cur_state ]]; then
  echo "Current fan state: $(cat /sys/class/thermal/cooling_device0/cur_state)/$(cat /sys/class/thermal/cooling_device0/max_state)  temp=$(vcgencmd measure_temp 2>/dev/null || true)"
fi
