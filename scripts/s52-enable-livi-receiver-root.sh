#!/usr/bin/env bash
# Root-only steps for s52-enable-livi-receiver.sh — invoked via sudo -n
# (NOPASSWD in /etc/sudoers.d/s52-carplay-launcher).
#
# Installs only from the trusted app tree recorded by setup.sh (/etc/s52-app-dir).
# Never accepts a caller-supplied repo path (privilege-escalation guard).
set -euo pipefail

RECEIVER="${1:?receiver required (livi|react-carplay)}"

case "${RECEIVER}" in
  livi|react-carplay) ;;
  *) echo "invalid receiver: ${RECEIVER}" >&2; exit 2 ;;
esac

if [[ -r /etc/s52-app-dir ]]; then
  APP_DIR="$(tr -d '[:space:]' < /etc/s52-app-dir)"
else
  S52_USER="${SUDO_USER:-$(id -un)}"
  APP_DIR="/home/${S52_USER}/e30piplay"
fi

APP_DIR="$(realpath "${APP_DIR}")"
case "${APP_DIR}" in
  /home/*) ;;
  *) echo "refusing untrusted APP_DIR: ${APP_DIR}" >&2; exit 1 ;;
esac

SWITCH_SRC="${APP_DIR}/scripts/s52-carplay-switch.sh"
if [[ ! -f "${SWITCH_SRC}" ]]; then
  echo "missing trusted switch script: ${SWITCH_SRC}" >&2
  exit 1
fi

DROPIN="/etc/systemd/system/s52-cage-kiosk.service.d/receiver.conf"

install -m 755 "${SWITCH_SRC}" /usr/local/bin/s52-carplay-switch.sh

if [ "${RECEIVER}" = "livi" ]; then
  mkdir -p /etc/systemd/system/s52-cage-kiosk.service.d
  cat > "${DROPIN}" <<EOF
[Service]
Environment=S52_CARPLAY_RECEIVER=livi
EOF
else
  rm -f "${DROPIN}"
fi

systemctl daemon-reload
systemctl restart s52-carplay
systemctl restart s52-cage-kiosk
