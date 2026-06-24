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
# Which CarPlay receiver to boot. Default react-carplay (the proven path —
# behaviour is byte-for-behaviour identical unless this is set). Set
# S52_CARPLAY_RECEIVER=livi to A/B the LIVI receiver (HW GStreamer decode) that
# scripts/s52-install-livi.sh puts at ~/.local/bin/s52-livi. See issue #23 /
# docs/livi-receiver-trial.md.
CARPLAY_RECEIVER="${S52_CARPLAY_RECEIVER:-react-carplay}"
LIVI_LAUNCHER="${S52_LIVI_LAUNCHER:-${HOME}/.local/bin/s52-livi}"

# Solid-black background layer underneath every client.
if command -v swaybg >/dev/null 2>&1; then
  swaybg --color '#000000' >/dev/null 2>&1 &
fi
# Let swaybg win the first-frame race vs labwc's initial clear before
# Chromium maps its toplevel (tunable: S52_SWAYBG_SETTLE_SEC, default 0.2).
SWAYBG_SETTLE="${S52_SWAYBG_SETTLE_SEC:-0.2}"
sleep "${SWAYBG_SETTLE}" 2>/dev/null || sleep 1

# Hide the pointer once the car's audio out (USB DAC -> Kenwood AUX) is
# plugged in — that's the reliable "installed in the car, not sitting on the
# bench with a debugging mouse" signal. Touchscreen presence is a secondary
# signal for installs that never use a USB DAC. Polled every few seconds so
# plugging/unplugging the DAC while the kiosk is running takes effect without
# a reboot — no separate restart needed when the Pi leaves/returns to the car.
# Override: S52_HIDE_CURSOR=1 (always hide) or S52_HIDE_CURSOR=0 (always show).
hide_cursor_mode="${S52_HIDE_CURSOR:-auto}"
cursor_poll_sec="${S52_CURSOR_POLL_SEC:-5}"

usb_audio_out_present() {
  if command -v wpctl >/dev/null 2>&1 && wpctl status 2>/dev/null | grep -qi 'usb audio'; then
    return 0
  fi
  if command -v pactl >/dev/null 2>&1 && pactl list sinks short 2>/dev/null \
      | grep -vi 'hdmi\|vc4hdmi' | grep -qi 'usb\|dac\|cmedia\|c-media\|fosi\|sabrent\|ugreen'; then
    return 0
  fi
  if command -v aplay >/dev/null 2>&1 && aplay -l 2>/dev/null | grep -qi usb; then
    return 0
  fi
  return 1
}

touchscreen_present() {
  for namefile in /sys/class/input/event*/device/name; do
    [ -f "$namefile" ] || continue
    name=$(cat "$namefile" 2>/dev/null || true)
    case $name in
      *[Tt]ouch*|*Wave*|*Goodix*|*ft5406*|*"Multi-Touch"*|*Touchscreen*)
        return 0
        ;;
    esac
  done
  return 1
}

if command -v unclutter >/dev/null 2>&1; then
  (
    unclutter_pid=""
    while true; do
      case "$hide_cursor_mode" in
        1) want_hide=1 ;;
        0) want_hide=0 ;;
        *)
          if usb_audio_out_present || touchscreen_present; then
            want_hide=1
          else
            want_hide=0
          fi
          ;;
      esac
      if [ "$want_hide" = "1" ]; then
        if [ -z "$unclutter_pid" ] || ! kill -0 "$unclutter_pid" 2>/dev/null; then
          unclutter -idle 0.1 -root >/dev/null 2>&1 &
          unclutter_pid=$!
        fi
      else
        if [ -n "$unclutter_pid" ] && kill -0 "$unclutter_pid" 2>/dev/null; then
          kill "$unclutter_pid" 2>/dev/null || true
        fi
        unclutter_pid=""
      fi
      sleep "$cursor_poll_sec"
    done
  ) &
fi

"${HOME}/.local/bin/s52-kiosk-inner.sh" &

# Background CarPlay. Pi 5 V3D init races with Chromium's GPU process on cold
# boot — we delay a few seconds and force software paint on the AppImage so
# both don't fight for the GPU. (CarPlay video is decoded inside the dongle
# and composited via Wayland; software paint is fine for the chrome around
# it.) Override with S52_CARPLAY_GPU=1 if you want hardware accel.
#
# LIVI branch: when S52_CARPLAY_RECEIVER=livi we run the LIVI receiver instead.
# LIVI decodes CarPlay video through its own native GStreamer hardware pipeline,
# so we deliberately do NOT force software GL here (none of the
# LIBGL_ALWAYS_SOFTWARE / --disable-gpu / Vulkan-off treatment below) — that is
# react-carplay-specific. The react-carplay branch is unchanged. (issue #23)
if [ "${CARPLAY_RECEIVER}" = "livi" ]; then
  if [ -x "${LIVI_LAUNCHER}" ]; then
    (
      sleep "${CARPLAY_START_DELAY}"
      CARPLAY_AUDIO_ENV="${HOME}/.config/s52-carplay-audio.env"
      if [ -f "${CARPLAY_AUDIO_ENV}" ]; then
        echo "[$(date)] sourcing ${CARPLAY_AUDIO_ENV}"
        # shellcheck disable=SC1090
        . "${CARPLAY_AUDIO_ENV}"
      fi
      # USB class-compliant DACs often expose an "Extension Unit" that defaults
      # to off — analog out stays silent until turned on (resets on reboot).
      # LIVI routes its own audio via scripts/s52-apply-livi-config.sh
      # (audioOutputDevice), but the DAC's analog path still needs unmuting —
      # same as the react-carplay branch below.
      USB_ALSA_CARD="${ALSA_CARD:-${S52_USB_ALSA_CARD:-Audio}}"
      while true; do
        if command -v amixer >/dev/null 2>&1; then
          amixer -c "${USB_ALSA_CARD}" sset Speaker 100% unmute >/dev/null 2>&1 || true
          amixer -c "${USB_ALSA_CARD}" sset PCM 100% >/dev/null 2>&1 || true
          amixer -c "${USB_ALSA_CARD}" sset 'Extension Unit' on >/dev/null 2>&1 || true
        fi
        # LIVI ships a nested wlroots compositor. labwc's systemd unit sets
        # WLR_BACKENDS=drm,libinput for the kiosk session — if LIVI inherits
        # that, livi-compositor tries DRM, fails, and crash-loops (issue #23).
        WLR_BACKENDS=wayland "${LIVI_LAUNCHER}" \
          2>&1 | { if command -v systemd-cat >/dev/null 2>&1; then tee -a "${CARPLAY_LOG}" | systemd-cat -t s52-carplay-app; else cat >>"${CARPLAY_LOG}"; fi; } || true
        sleep 3
      done
    ) &
  else
    echo "[$(date)] S52_CARPLAY_RECEIVER=livi but ${LIVI_LAUNCHER} missing; run scripts/s52-install-livi.sh" >&2
  fi
elif [ -x "${CARPLAY_LAUNCHER}" ]; then
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
    # Mesa 25.0.7 (rpt) broke the GBM RGBA_8888 -> dma_buf export path on the
    # Pi's V3D. Even with --disable-gpu, Ozone/Wayland still asks Mesa's GBM to
    # allocate the presentation buffer, the export fails ("Failed to export
    # buffer to dma_buf: No such file or directory"), the GPU process dies
    # ("GPU process isn't usable. Goodbye."), and the AppImage crash-loops so
    # ready-to-show never fires and no toplevel appears. Forcing Mesa itself to
    # software (llvmpipe — far faster than softpipe) bypasses GBM/dma_buf
    # entirely; CarPlay video is decoded inside the dongle, so CPU paint of the
    # surrounding chrome is fine. Set S52_CARPLAY_GPU=1 to opt back into V3D
    # once Mesa is fixed upstream.
    # LIBGL_ALWAYS_SOFTWARE only forces software GL — Chromium/Dawn still probes
    # the hardware V3DV Vulkan driver, which on Mesa 25.0.7 reports insufficient
    # limits ("maxTextureDimension1D must be at least 8192") and wedges the
    # renderer at InitializeSupportedLimitsImpl, so ready-to-show never fires
    # and no window maps. Disabling Vulkan/WebGPU keeps everything on the
    # software GL path. react-carplay renders video via WebGL/JMuxer, not
    # WebGPU, so this is safe.
    GPU_FLAG="--disable-gpu"
    VULKAN_FLAG="--disable-features=Vulkan,WebGPU"
    if [ "${S52_CARPLAY_GPU:-0}" = "1" ]; then
      GPU_FLAG=""
      VULKAN_FLAG=""
    else
      export LIBGL_ALWAYS_SOFTWARE=1
      export GALLIUM_DRIVER="${S52_CARPLAY_GALLIUM_DRIVER:-llvmpipe}"
    fi
    while true; do
      if command -v amixer >/dev/null 2>&1; then
        # Force the analog output ON at boot so it can never come up muted/silent.
        # USB adapters name the output control differently: our C-Media/Unitek
        # Y-247A uses "Speaker"; many others use "PCM" (+ an "Extension Unit" that
        # defaults off and mutes the analog out). Set all of them best-effort.
        amixer -c "${USB_ALSA_CARD}" sset Speaker 100% unmute >/dev/null 2>&1 || true
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
      # Route react-carplay's stdout/stderr through the journal (tag
      # s52-carplay-app) so its lines are persistent + timestamped (the old
      # /tmp/react-carplay.log is wiped on reboot). This gives the flight
      # recorder a durable record of every (re)start of the AppImage — and any
      # connect/attach line it ever emits. Still tee to /tmp for live tailing.
      # Falls back to the /tmp log if systemd-cat is unavailable.
      "${CARPLAY_LAUNCHER}" --no-sandbox \
        ${GPU_FLAG} \
        ${VULKAN_FLAG} \
        ${CARPLAY_ALSA_FLAG} \
        --ozone-platform=wayland \
        --enable-features=UseOzonePlatform \
        --password-store=basic \
        --autoplay-policy=no-user-gesture-required \
        --disable-web-security \
        2>&1 | { if command -v systemd-cat >/dev/null 2>&1; then tee -a "${CARPLAY_LOG}" | systemd-cat -t s52-carplay-app; else cat >>"${CARPLAY_LOG}"; fi; } || true
      sleep 3
    done
  ) &
else
  echo "[$(date)] missing ${CARPLAY_LAUNCHER}; run install-react-carplay-appimage.sh" >&2
fi
