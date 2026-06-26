#!/usr/bin/env bash
# NOPASSWD via /etc/sudoers.d/s52-carplay-launcher — restart kiosk compositor
# (Chromium/labwc). Invoked as: sudo -n /usr/local/bin/s52-restart-kiosk.sh
set -euo pipefail
systemctl restart s52-cage-kiosk.service
