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
#   1. swaybg — solid-black wallpaper layer; we sleep briefly after it so
#      its surface commits before Chromium maps (avoids a one-frame race
#      with labwc's empty scene). Chromium uses opaque black via
#      --default-background-color=000000 in s52-kiosk-inner.sh.
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

# Solid-black background layer underneath every client.
if command -v swaybg >/dev/null 2>&1; then
  swaybg --color '#000000' >/dev/null 2>&1 &
fi
# Let swaybg win the first-frame race vs labwc's initial clear before
# Chromium maps its toplevel (tunable: S52_SWAYBG_SETTLE_SEC, default 0.2).
SWAYBG_SETTLE="${S52_SWAYBG_SETTLE_SEC:-0.2}"
sleep "${SWAYBG_SETTLE}" 2>/dev/null || sleep 1

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
    # Optional: ~/.config/s52-carplay-audio.env (e.g. PULSE_SINK=...) so
    # react-carplay uses the USB DAC instead of HDMI. See
    # scripts/s52-carplay-audio.env.example in the repo.
    CARPLAY_AUDIO_ENV="${HOME}/.config/s52-carplay-audio.env"
    if [ -f "${CARPLAY_AUDIO_ENV}" ]; then
      echo "[$(date)] sourcing ${CARPLAY_AUDIO_ENV}"
      # shellcheck disable=SC1090
      . "${CARPLAY_AUDIO_ENV}"
    fi
    # USB class-compliant DACs often expose an "Extension Unit" that defaults
    # to off — analog out stays silent until turned on (resets on reboot).
    USB_ALSA_CARD="${ALSA_CARD:-${S52_USB_ALSA_CARD:-Audio}}"
    # When PULSE_SINK is set (PipeWire + libpulse), let Electron use Pulse; do not
    # also pass --alsa-output-device or Chromium can bypass the Pulse default.
    CARPLAY_ALSA_FLAG=""
    if [ -z "${PULSE_SINK:-}" ] && command -v amixer >/dev/null 2>&1 && amixer -c "${USB_ALSA_CARD}" info >/dev/null 2>&1; then
      CARPLAY_ALSA_FLAG="--alsa-output-device=plughw:CARD=${USB_ALSA_CARD},DEV=0"
    fi
    GPU_FLAG="--disable-gpu"
    if [ "${S52_CARPLAY_GPU:-0}" = "1" ]; then
      GPU_FLAG=""
    fi
    while true; do
      if command -v amixer >/dev/null 2>&1; then
        # Some USB DACs flip "Extension Unit" off when PCM is touched — set PCM first, unmute last.
        amixer -c "${USB_ALSA_CARD}" sset PCM 100% >/dev/null 2>&1 || true
        amixer -c "${USB_ALSA_CARD}" sset 'Extension Unit' on >/dev/null 2>&1 || true
        # 3.5mm mic / line-in on the same USB sound card (best-effort unmute).
        amixer -c "${USB_ALSA_CARD}" sset Capture 90% >/dev/null 2>&1 || true
        amixer -c "${USB_ALSA_CARD}" sset Capture cap >/dev/null 2>&1 || true
        amixer -c "${USB_ALSA_CARD}" sset Capture on >/dev/null 2>&1 || true
        amixer -c "${USB_ALSA_CARD}" sset 'Mic Capture' 90% >/dev/null 2>&1 || true
        amixer -c "${USB_ALSA_CARD}" sset 'Mic Capture' cap >/dev/null 2>&1 || true
        amixer -c "${USB_ALSA_CARD}" sset Mic 90% >/dev/null 2>&1 || true
      fi
      "${CARPLAY_LAUNCHER}" --no-sandbox \
        ${GPU_FLAG} \
        ${CARPLAY_ALSA_FLAG} \
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
