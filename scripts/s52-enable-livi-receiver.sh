#!/usr/bin/env bash
# Make LIVI the booted CarPlay receiver — survives reboot. Idempotent.
#
# Writes the systemd drop-in + API/switch env file, refreshes labwc autostart/rc.xml
# and the switch script from this repo, applies S52 LIVI display config, then
# restarts the kiosk + carplay API. Run on the Pi after s52-install-livi.sh:
#
#   bash ~/e30piplay/scripts/s52-enable-livi-receiver.sh
#
# Revert to react-carplay:
#   bash ~/e30piplay/scripts/s52-enable-livi-receiver.sh react-carplay
set -euo pipefail

REPO="$(cd "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
RECEIVER="${1:-livi}"
RECEIVER_ENV="${HOME}/.config/s52-carplay-receiver.env"

case "${RECEIVER}" in
  livi)
    APP_ID="dev.f-io.livi"
    ;;
  react-carplay)
    APP_ID="react-carplay"
    ;;
  *)
    echo "usage: $0 [livi|react-carplay]" >&2
    exit 2
    ;;
esac

echo "=== enable CarPlay receiver: ${RECEIVER} (app_id=${APP_ID}) ==="

mkdir -p "${HOME}/.config"
cat > "${RECEIVER_ENV}" <<EOF
S52_CARPLAY_RECEIVER=${RECEIVER}
S52_CARPLAY_APP_ID=${APP_ID}
EOF
echo "  wrote ${RECEIVER_ENV}"

mkdir -p "${HOME}/.config/labwc"
install -m 755 "${REPO}/scripts/s52-labwc-autostart.sh" "${HOME}/.config/labwc/autostart"
install -m 644 "${REPO}/scripts/s52-labwc-rc.xml" "${HOME}/.config/labwc/rc.xml"
echo "  refreshed labwc autostart + rc.xml"

if [ "${RECEIVER}" = "livi" ]; then
  if [ ! -x "${HOME}/.local/bin/s52-livi" ]; then
    echo "!! s52-livi missing — run scripts/s52-install-livi.sh first" >&2
    exit 1
  fi
  bash "${REPO}/scripts/s52-apply-livi-config.sh"
fi

if [ ! -x /usr/local/bin/s52-enable-livi-receiver-root.sh ]; then
  echo "!! ${REPO}/scripts/s52-enable-livi-receiver-root.sh not installed — re-run setup.sh on the Pi" >&2
  exit 1
fi
sudo -n /usr/local/bin/s52-enable-livi-receiver-root.sh "${RECEIVER}" "${REPO}"

echo "=== done — reboot-safe. Receiver=${RECEIVER}, app_id=${APP_ID} ==="
