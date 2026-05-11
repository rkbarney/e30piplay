# Linux Deployment Paths

Three options identified for the display OS, ordered by effort. The current
setup is Phase 1. Phases 2 and 3 are for later if boot time or stability
become a problem.

---

## Phase 1 — Pi OS Desktop + Chromium (current)

**Status:** Running in car. Keep this until ready to upgrade.

**How it works:**
- Raspberry Pi OS 64-bit (Bookworm) full desktop image
- Wayland compositor (labwc) runs the desktop
- `s52-kiosk-launch.sh` kills the panel/taskbar then opens Chromium in kiosk mode
- nginx serves the built React app on port 80
- `wlr-randr` configures display rotation

**Known boot time:** 35–50 seconds

**Rough edges:**
- Desktop environment is loaded and immediately killed — wasteful
- `xset` / `xdotool` / `unclutter` in the launch script are X11 tools; they silently
  fail under Wayland but are harmless no-ops
- Screen blanking is suppressed via `systemd-inhibit --what=idle:sleep` wrapping
  Chromium, which works under both X11 and Wayland at the logind level

---

## Phase 2 — Pi OS Lite + cage

**Status:** Not started. Do this when the car install is stable.

**How it works:**
- Raspberry Pi OS **Lite** 64-bit (no desktop, same kernel/drivers/apt ecosystem)
- `cage` replaces the entire desktop — it is a Wayland compositor designed to
  run exactly one app fullscreen and exit when that app closes
- Chromium runs inside cage; no panel, no taskbar, nothing else
- nginx and the systemd services are identical to Phase 1

**Key changes from Phase 1:**
```bash
# Install
sudo apt install cage chromium nginx alsa-utils openssh-server avahi-daemon

# Launch script simplifies to roughly:
cage -- chromium-browser \
  --kiosk \
  --no-sandbox \
  --app=http://localhost \
  --disable-features=Translate \
  --noerrdialogs \
  --disable-infobars \
  --check-for-update-interval=31536000
```

- `wlr-randr` does not work inside cage (cage is its own compositor); display
  rotation moves to `/boot/firmware/config.txt` (`display_rotate=1` for 90°)
- Autostart via a systemd service that runs as the login user, triggered after
  `network.target` and `nginx.service`
- `--no-sandbox` is required in cage (no user namespace separation in a single-app
  compositor context)

**Expected boot time:** 12–18 seconds

**Docker testing:** Run an `arm64v8/debian:bookworm` container, install cage +
chromium, pass your host Wayland socket in. Validates the service config and
launch script without touching the Pi.

```bash
docker run --rm \
  -e WAYLAND_DISPLAY=$WAYLAND_DISPLAY \
  -e XDG_RUNTIME_DIR=/tmp \
  -v $XDG_RUNTIME_DIR/$WAYLAND_DISPLAY:/tmp/$WAYLAND_DISPLAY \
  arm64v8/debian:bookworm \
  cage -- chromium --kiosk --no-sandbox http://localhost
```

---

## Phase 3 — Buildroot + SDL2 or LVGL (no Chromium)

**Status:** Not started. Do this only if Phase 2 boot time is unacceptable.

**Why this gets to 3–5 second boot:**
- Chromium is the single most painful package in Buildroot (~350 build deps,
  3–4 hour compile, breaks frequently). Removing it also removes the need for a
  full Wayland compositor.
- SDL2 or LVGL render directly to the kernel DRM/KMS framebuffer — no browser,
  no compositor.
- Buildroot produces a complete OS image from source; nothing unused is included.

**Rendering options:**

| Library | Fit for this project | Notes |
|---------|---------------------|-------|
| **SDL2** | Good | Easiest rewrite; Python/Pygame; well-tested in Buildroot (`BR2_PACKAGE_SDL2`) |
| **LVGL** | Best fit | Designed for automotive dashboards; clock/gauge widgets built in; Python bindings available (`BR2_PACKAGE_LVGL`) |
| **Qt/QML** | Overkill | QML is JSX-like; large build; `eglfs` backend skips compositor entirely |

**Starting point:**
Buildroot mainline ships `raspberrypi5_defconfig` which already handles the
BCM2712 kernel, bootloader chain, VC4 GPU driver, USB, ALSA, and SD card boot.
You add SDL2/LVGL + Python3 + GStreamer (for CarPlay H.264 decode) on top.

**CarPlay in Phase 3:**
- The Carlinkit dongle streams H.264 video over a USB network interface
- GStreamer (`BR2_PACKAGE_GSTREAMER2`) decodes and displays the stream via V4L2
  hardware decode on the Pi 5
- `node-carplay` (the CarPlay USB protocol layer) can run as a small Node.js
  daemon alongside the native UI, or be replaced with `acarplay` (C implementation)

**Build workflow is Docker-native:**
Buildroot's `utils/docker-run.sh` builds the entire OS image inside a container
on your dev machine. The Pi never needs a compiler.

```bash
git clone https://git.buildroot.net/buildroot
cd buildroot
make raspberrypi5_defconfig
# then enable SDL2/LVGL/GStreamer/Python3 in `make menuconfig`
utils/docker-run.sh make
# output: output/images/sdcard.img  → flash to SD
```

**UI rewrite:** The three clock faces are simple enough that an AI agent can
rewrite them in Python+Pygame or LVGL Python bindings in one session. The
animations are `draw_line`, `draw_circle`, trig for hand positions — identical
math to the current SVG code.

**Expected boot time:** 3–6 seconds from power to clock face visible
(2–4 seconds if using eMMC instead of SD card)

---

## Docker for Display Testing (all phases)

You can test the visual output without the Pi by forwarding your host display:

**X11:**
```bash
docker run --rm \
  -e DISPLAY=$DISPLAY \
  -v /tmp/.X11-unix:/tmp/.X11-unix \
  <image> chromium --kiosk --window-size=480,320 http://localhost
```

**Wayland:**
```bash
docker run --rm \
  -e WAYLAND_DISPLAY=$WAYLAND_DISPLAY \
  -e XDG_RUNTIME_DIR=/tmp \
  -v $XDG_RUNTIME_DIR/$WAYLAND_DISPLAY:/tmp/$WAYLAND_DISPLAY \
  <image> chromium --ozone-platform=wayland --kiosk http://localhost
```

**With the physical OSOYOO display:** Plug it into your dev machine via HDMI.
It appears as a regular monitor. Target Chromium at that output at 480×320
portrait. Touch input works too if you pass the USB through.

What Docker cannot test: Pi-specific GPU driver behavior and the Carlinkit dongle.
