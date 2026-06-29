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
#   3. The upstream react-carplay AppImage (or LIVI) — pre-loaded but
#      auto-iconified by the windowRule in ~/.config/labwc/rc.xml. The user
#      never sees its "looking for dongle" startup; by the time they tap
#      `+`, it is warm.
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
# behaviour is byte-for-byte identical unless this is set). Set
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

# Cursor visibility used to be guessed here (USB-DAC / touchscreen presence)
# and enforced with `unclutter`. That never actually worked: unclutter only
# hides the X11 root cursor, and s52-kiosk-inner.sh launches Chromium with
# --ozone-platform=wayland (no XWayland) — so unclutter had no cursor to hide,
# and the pointer stayed visible in the car regardless of the heuristic.
# Cursor visibility is now controlled entirely inside the React app: the
# global `cursor: none` in src/global.css, overridden by a `.show-cursor`
# class on <body> that the Settings screen's "Show mouse" toggle sets
# (src/useSettings.js). Flip it on at the bench, off for the car — no
# detection heuristics, no Pi-side service.
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
          # Capture path — Siri / phone call mic (same as react-carplay branch).
          amixer -c "${USB_ALSA_CARD}" sset Capture 90% >/dev/null 2>&1 || true
          amixer -c "${USB_ALSA_CARD}" sset Capture cap >/dev/null 2>&1 || true
          amixer -c "${USB_ALSA_CARD}" sset Capture on >/dev/null 2>&1 || true
          amixer -c "${USB_ALSA_CARD}" sset 'Mic Capture' 90% >/dev/null 2>&1 || true
          amixer -c "${USB_ALSA_CARD}" sset 'Mic Capture' cap >/dev/null 2>&1 || true
          amixer -c "${USB_ALSA_CARD}" sset Mic 90% >/dev/null 2>&1 || true
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

# Background Organic Maps (Flatpak app.organicmaps.desktop) — same pre-warm/
# iconify trick as react-carplay above, so the ORGANIC MAPS face's button is an
# instant wlrctl focus instead of a cold Qt + map-load start.
#
# CAVEAT (unverified on real hardware): rc.xml iconifies app_id
# "app.organicmaps.desktop"; if Organic Maps reports a different app_id under
# Wayland/Xwayland it will sit on top of the kiosk at boot — check
# `wlrctl toplevel list` after first boot and adjust both the rc.xml identifier
# and S52_MAPS_APP_ID (carplay-server) to match.
#
# Flatpak needs the Wayland socket + a session bus; the labwc kiosk session
# exports WAYLAND_DISPLAY, which `flatpak run` inherits.
MAPS_FLATPAK_REF="${S52_MAPS_FLATPAK_REF:-app.organicmaps.desktop}"
MAPS_LOG="${S52_MAPS_LOG:-/tmp/organicmaps.log}"
MAPS_START_DELAY="${S52_MAPS_START_DELAY:-5}"
if command -v flatpak >/dev/null 2>&1 && flatpak info "${MAPS_FLATPAK_REF}" >/dev/null 2>&1; then
  (
    sleep "${MAPS_START_DELAY}"
    while true; do
      flatpak run "${MAPS_FLATPAK_REF}" \
        2>&1 | { if command -v systemd-cat >/dev/null 2>&1; then tee -a "${MAPS_LOG}" | systemd-cat -t s52-organicmaps-app; else cat >>"${MAPS_LOG}"; fi; } || true
      sleep 3
    done
  ) &
else
  echo "[$(date)] Organic Maps flatpak (${MAPS_FLATPAK_REF}) not installed; run setup.sh or 'flatpak install flathub app.organicmaps.desktop'" >&2
fi
