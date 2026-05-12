#!/bin/sh
# labwc autostart for the S52 kiosk.
#
# IMPORTANT: labwc runs this file as `sh autostart` (see autostart.c —
# execlp("sh", "sh", path, NULL)). It does NOT honor the shebang, so this
# script must stay POSIX-sh compatible — no `[[ ... ]]`, no bash arrays,
# no `function` keyword. The previous bash version errored out on line 48
# (`GPU_FLAGS=()`), which killed every command below it including the
# react-carplay launch loop — which is why /api/carplay-ready never went
# true and the React splash hung forever.
#
# We start three clients of the labwc session:
#   1. swaybg — solid-black wallpaper layer, kills Chromium's pre-CSS
#      white first-paint flash (Chromium runs with a transparent window
#      background via --default-background-color=00000000).
#   2. Chromium kiosk (s52-kiosk-inner.sh) — the visible window on boot.
#   3. The upstream react-carplay AppImage — pre-loaded but auto-iconified
#      by the windowRule in ~/.config/labwc/rc.xml. The user never sees its
#      "looking for dongle" startup; by the time they tap `+`, it is warm.
#
# Tapping `+` posts /api/launch-react-carplay → carplay-server.cjs →
# s52-carplay-switch.sh → wlrctl toplevel focus app_id:react-carplay. That
# is the entire "launch" path — instant focus, no VT switching, no service
# restart, no terminal flash.

exec >>/tmp/s52-labwc-autostart.log 2>&1
echo "[$(date)] labwc autostart"

CARPLAY_LAUNCHER="${HOME}/.local/bin/react-carplay"
CARPLAY_LOG="${S52_CARPLAY_LOG:-/tmp/react-carplay.log}"
CARPLAY_START_DELAY="${S52_CARPLAY_START_DELAY:-4}"

# Solid-black background layer underneath every client (kills Chromium's
# pre-CSS white first-paint flash, since Chromium runs with a transparent
# window background — see --default-background-color=00000000).
if command -v swaybg >/dev/null 2>&1; then
  swaybg --color '#000000' >/dev/null 2>&1 &
fi

# Hide the pointer when not in use.
if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0.1 -root >/dev/null 2>&1 &
fi

"${HOME}/.local/bin/s52-kiosk-inner.sh" &

# Background CarPlay. Pi 5 V3D init races with Chromium's GPU process on cold
# boot — we delay a few seconds and force software paint on the AppImage so
# both don't fight for the GPU. (CarPlay video is decoded inside the dongle
# and composited via Wayland; software paint is fine for the chrome around
# it.) Override with S52_CARPLAY_GPU=1 if you want hardware accel.
if [ -x "${CARPLAY_LAUNCHER}" ]; then
  (
    sleep "${CARPLAY_START_DELAY}"
    GPU_FLAG="--disable-gpu"
    if [ "${S52_CARPLAY_GPU:-0}" = "1" ]; then
      GPU_FLAG=""
    fi
    while true; do
      "${CARPLAY_LAUNCHER}" --no-sandbox \
        ${GPU_FLAG} \
        --ozone-platform=wayland \
        --enable-features=UseOzonePlatform \
        --password-store=basic \
        >>"${CARPLAY_LOG}" 2>&1 || true
      sleep 3
    done
  ) &
else
  echo "[$(date)] missing ${CARPLAY_LAUNCHER}; run install-react-carplay-appimage.sh" >&2
fi
