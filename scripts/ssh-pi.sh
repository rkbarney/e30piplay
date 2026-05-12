#!/usr/bin/env bash
# Connect to the Pi. Override host if mDNS is flaky:
#   S52_HOST=192.168.1.93 ./scripts/ssh-pi.sh
set -euo pipefail
USER_NAME="${S52_USER:-admin}"
TARGET="${S52_HOST:-s52.local}"
exec ssh -o ConnectTimeout=10 -o ServerAliveInterval=5 "${USER_NAME}@${TARGET}" "$@"
