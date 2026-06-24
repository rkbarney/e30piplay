#!/usr/bin/env bash
# Root-only steps for s52-enable-livi-receiver.sh — invoked via sudo -n
# (NOPASSWD in /etc/sudoers.d/s52-carplay-launcher).
set -euo pipefail

RECEIVER="${1:?receiver required (livi|react-carplay)}"
REPO="${2:?repo path required}"

case "${RECEIVER}" in
  livi|react-carplay) ;;
  *) echo "invalid receiver: ${RECEIVER}" >&2; exit 2 ;;
esac

DROPIN="/etc/systemd/system/s52-cage-kiosk.service.d/receiver.conf"

install -m 755 "${REPO}/scripts/s52-carplay-switch.sh" /usr/local/bin/s52-carplay-switch.sh

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
