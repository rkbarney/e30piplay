# Environment — as-built (canonical)

The facts that keep getting re-derived each session. Keep this current; it is the
single place to look up "what is actually installed."

## Hardware

| Part | This build |
|---|---|
| Vehicle | BMW E30, S52 swap; Kenwood head unit (USB + AUX in) |
| Compute | **Raspberry Pi 5 (8 GB)** (BCM2712) |
| Display | Waveshare 2.8″ HDMI capacitive touch, **480×640 portrait** (mounted flush in the factory clock opening) |
| CarPlay dongle | **Carlinkit "AutoKit" A15W**, AP `AutoKit-2041`, fw `2025.10.15.1127`, USB `1314:1520`. iPhone = **wireless only** (no wired data path). See `docs/carlinkit-dongle-reference.md`. |
| Audio out | USB DAC (C-Media / Unitek Y-247A) → 3.5 mm → Kenwood **AUX** |
| Mic | USB lavalier |
| Power | 12 V ACC → buck → Pi USB-C (`usb_max_current_enable=1`) |

## Software / OS

| | This build |
|---|---|
| OS | Raspberry Pi OS (Debian-based) — **exact release: _CONFIRM_** (`cat /etc/os-release`) |
| Session | labwc / Wayland kiosk (`s52-cage-kiosk`) + Chromium UI + receiver AppImage |
| CarPlay receiver | upstream **react-carplay 4.0.5** AppImage, forced to **software GL (llvmpipe)** due to a Mesa 25.0.7 V3D/GBM regression (see `scripts/s52-labwc-autostart.sh`) |

> **Why the OS matters right now:** the [LIVI](https://github.com/f-io/LIVI) receiver
> trial (issue #23) relies on the Pi's **v4l2 hardware-decode** path, which LIVI
> validates on **Raspberry Pi OS Trixie / Debian 13**. If this Pi is still on
> Bookworm (Debian 12), LIVI may launch but without the hardware decode that is
> the whole reason we're trying it — so confirm the release before/at install and
> decide whether to upgrade. `scripts/s52-install-livi.sh` warns if it isn't Trixie+.

## To finish documenting

- [ ] Exact OS release (`VERSION_CODENAME` from `/etc/os-release`) — fill into the table above.
