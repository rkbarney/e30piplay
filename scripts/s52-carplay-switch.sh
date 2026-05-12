#!/bin/bash
# Invoked via sudo -n by carplay-server.cjs (NOPASSWD in /etc/sudoers.d/s52-carplay-launcher).
set -euo pipefail
SC=/usr/bin/systemctl
case "${1:-}" in
  launch)
    "$SC" stop s52-cage-kiosk
    sleep 2
    "$SC" start s52-cage-react-carplay
    ;;
  return)
    "$SC" stop s52-cage-react-carplay
    ;;
  *)
    echo "usage: $0 launch|return" >&2
    exit 1
    ;;
esac
