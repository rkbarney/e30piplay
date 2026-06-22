#!/usr/bin/env bash
# Quick Mac bench test for the USB GPS puck — run after plugging in.
# Expect Prolific 067b:23a3 → /dev/cu.usbserial-* or /dev/cu.P* (after driver install)
set -euo pipefail

shopt -s nullglob
ports=(/dev/cu.usbserial* /dev/cu.usbmodem* /dev/cu.P* /dev/tty.usbserial* /dev/tty.usbmodem* /dev/tty.P*)
if ((${#ports[@]} == 0)); then
  if system_profiler SPUSBDataType 2>/dev/null | grep -qiE 'prolific|067b:23a3|USB-Serial Controller'; then
    echo "USB puck detected, but macOS did not create a serial port."
    echo ""
    echo "Modern macOS needs Prolific's driver extension:"
    echo "  1. Mac App Store → search \"PL2303 Serial\" (Prolific Technology Inc.)"
    echo "  2. Install and open the app; approve the driver in System Settings"
    echo "     → Privacy & Security → Driver Extensions → enable PL2303Serial"
    echo "  3. Replug the puck, then: ls /dev/cu.P* /dev/cu.usbserial*"
    echo ""
    echo "See: https://kb.plugable.com/serial-adapter/how-to-install-prolific-serial-port-drivers-on-macos"
    exit 1
  fi
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
