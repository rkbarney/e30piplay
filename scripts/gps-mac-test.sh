#!/usr/bin/env bash
# Quick Mac bench test for the USB GPS puck — run after plugging in.
# Expect Prolific 067b:23a3 → /dev/cu.usbserial-* or /dev/tty.usbserial-*
set -euo pipefail

shopt -s nullglob
ports=(/dev/cu.usbserial* /dev/cu.usbmodem* /dev/tty.usbserial* /dev/tty.usbmodem*)
if ((${#ports[@]} == 0)); then
  echo "No USB serial port found. Plug in the GPS puck and retry."
  echo "  system_profiler SPUSBDataType | grep -A6 -i prolific"
  exit 1
fi

port="${ports[0]}"
echo "Using $port at 4800 baud (BU-353 / Prolific default)…"
echo "Press Ctrl-C to stop. You should see \$GPGGA / \$GPRMC lines within a few seconds."
echo "---"
stty -f "$port" 4800 cs8 -cstopb -parenb -ixon -ixoff -crtscts raw -echo
cat "$port"
