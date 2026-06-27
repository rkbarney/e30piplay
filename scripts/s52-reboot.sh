#!/usr/bin/env bash
# NOPASSWD via /etc/sudoers.d/s52-carplay-launcher — reboot the Pi.
# Invoked as: sudo -n /usr/local/bin/s52-reboot.sh
set -euo pipefail
systemctl reboot
