# LIVI receiver trial — replacing Electron react-carplay (issue #23)

Goal: stop CarPlay dropping while driving (and needing a **manual restart**) by
swapping the receiver app — **not** the dongle. iPhone CarPlay is wireless-only
with any Carlinkit autobox, so the lever we have left is a better-engineered
receiver on the *same* dongle.

## Why LIVI

| | react-carplay (current) | **LIVI** (trial) |
|---|---|---|
| Stack | Electron, **software GL (llvmpipe)** — CPU paints video | Electron + **native GStreamer HW decode** (v4l2, zero-copy) |
| Dongle | Carlinkit autobox `1314:152x` | same dongle (CPC200-CCPA family) |
| iPhone | wireless | wireless |
| Fit | our AppImage/labwc kiosk | same shape (AppImage/Wayland) |

The software-GL CPU paint is our leading suspect for the in-car stutter and for
drops not recovering cleanly. LIVI's hardware pipeline removes that variable.

**Fallback:** [FastCarPlay](https://github.com/niellun/FastCarPlay) (C++, build
from source) if LIVI is unworkable.

## A/B design (non-destructive)

react-carplay stays installed and is the **default**. The kiosk autostart picks
the receiver from `S52_CARPLAY_RECEIVER` (`react-carplay` default, or `livi`).
Nothing about the current boot changes until you set the flag.

- Installer: `scripts/s52-install-livi.sh` — installs LIVI's AppImage to
  `~/apps/LIVI.AppImage` + launcher `~/.local/bin/s52-livi`, GStreamer deps, and
  the Pi v4l2codecs HEVC patch. Does **not** touch react-carplay; strips LIVI's
  own XDG autostart so it can't double-launch and fight for the dongle.
- Autostart: `scripts/s52-labwc-autostart.sh` runs `s52-livi` (no software-GL
  forcing) when `S52_CARPLAY_RECEIVER=livi`, else the unchanged react-carplay loop.

## Steps (on the Pi)

```sh
# 0. Pre-req check — LIVI's Pi HW-decode path targets Debian 13 (Trixie).
ssh s52 'cat /etc/os-release | grep -E "VERSION_CODENAME|PRETTY_NAME"'
#   trixie  -> good.  bookworm -> LIVI may launch but HW decode (the point)
#   may be unavailable; decide whether to upgrade the Pi OS first.

# 1. Install LIVI alongside react-carplay (non-destructive).
ssh s52 'bash ~/e30piplay/scripts/s52-install-livi.sh'

# 2. Smoke test by hand (kiosk still on react-carplay) — does it find the dongle?
#    labwc must be running (s52-cage-kiosk active). LIVI needs WAYLAND_DISPLAY or
#    its nested compositor tries DRM and fails with "Cannot create session".
ssh s52 'XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 ~/.local/bin/s52-livi'   # Ctrl-C to stop

# 3. Make LIVI the booted receiver (survives reboot — no SSH in the car):
ssh s52 'bash ~/e30piplay/scripts/s52-enable-livi-receiver.sh'

# 4. Revert anytime:
ssh s52 'bash ~/e30piplay/scripts/s52-enable-livi-receiver.sh react-carplay'
```

## Open integration items (resolve on the Pi)

- **Window focus / `+` handoff.** The UI focuses CarPlay via `wlrctl` on
  `app_id:react-carplay` (`scripts/s52-carplay-switch.sh`, `s52-labwc-rc.xml`
  window rule). LIVI's window class is **`dev.f-io.livi`**. Confirm the live
  app_id with `wlrctl toplevel list`, then add a matching rule + switch target so
  the `+` button and the auto-iconify behave the same. (For the first drive test
  LIVI can just run full-screen; polish the handoff once it proves it holds.)
- **Audio routing.** LIVI uses the GStreamer/Pulse path; confirm it lands on the
  USB DAC sink (our `~/.config/s52-carplay-audio.env` `PULSE_SINK`) → Kenwood AUX,
  not HDMI.
- **Resolution/insets.** Set LIVI's stream resolution + safe-area to the 480×640
  portrait panel (LIVI config, not the react-carplay DongleConfig).

## Success criteria (A/B over a real drive)

Restore the **flight recorder** first (issue tracks this) so the drive is
measured, then compare LIVI vs react-carplay on the same route:

1. Holds the link — far fewer / no full disconnects.
2. **Auto-recovers** without a manual restart if it does blip.
3. No audio skips; CPU load down vs the llvmpipe path.

Keep whichever wins. If LIVI still drops unacceptably, the remaining honest path
is native nav (no radio) — out of scope for this branch.
