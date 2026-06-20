# S52 Solutions — E30 CarPlay Display

## Overview

Custom digital display for a 1980s BMW E30 with S52 engine swap. Replaces the
original analog clock with a small touchscreen running a CarPlay receiver,
analog clock faces, and a custom boot sequence. All built around a
terminal/retro aesthetic matching the BMW M-TECH branding.

---

## Vehicle

| | |
|---|---|
| Car | BMW E30 (early 1980s–1990s) |
| Engine | S52 3.2L I6 swap |
| Audio | Alpine system, Kenwood head unit |
| Head unit inputs | USB + AUX |
| Clock opening | 76mm wide × 84mm tall (portrait) |

---

## Hardware

| Component | Model | Status |
|---|---|---|
| Display | Waveshare 2.8" HDMI Capacitive Touch, 480×640 | ✅ Installed |
| Computer | Raspberry Pi 5 (8GB) | ✅ Ordered |
| Pi case | Official Pi 5 case with fan | ✅ Ordered |
| CarPlay dongle | Carlinkit Wireless CarPlay (USB) | ✅ Ordered |
| Audio DAC | USB to 3.5mm adapter | ✅ Ordered |
| AUX cable | 3.5mm male-to-male | ✅ Ordered |

---

## Software Stack

| Layer | Technology |
|---|---|
| OS | Raspberry Pi OS Lite (64-bit) + cage |
| UI framework | React + Vite |
| CarPlay receiver | [react-carplay](https://github.com/rhysmorgan134/react-carplay) (Electron — use Releases / setup-pi.sh; not npm-in-this-repo) |
| Static server | nginx |
| CarPlay backend | Node.js service (systemd) |
| Browser | Chromium in kiosk mode |

---

## Display Screens

### Boot / Logo Intro
- **No terminal boot screen.** The old ASCII "S52 Solutions" boot sequence was
  removed (2026-06-19); boot goes straight to the spinning roundel.
- BMW logo (1970–1989 era) spins in fast, decelerates, settles, then cross-fades
  into the clock face (~5.2 s total).
- Roundel is scaled near edge-to-edge (`objectFit: cover`) on a **white**
  background — the screen flips to **black** when the clock face mounts.
- Roundel center is aligned to the clock face center (no jump on transition).

### OEM Clock (default)
- White on black, no numbers
- Cartesian cross at 12/3/6/9 with spoke marks at other hours
- Rounded square face matching factory E30 clock shape
- `-` / `+` buttons below

### Digital Clock
- Red LED aesthetic matching OEM E30 digital clock
- AM/PM indicator
- OEM button labels: h/DAT, HOUR, TEMP / min/DAT, DATE, MEMO

### S52 Clock
- Amber on black (BMW factory instrument colour)
- 12/3/6/9 numerals, animated hands, digital readout

### CarPlay
- Full-screen CarPlay via upstream Electron project (not embedded here yet)
- Press `+` on any clock face to enter
- Press `+` again to return to clock

---

## Navigation

| Button | Action |
|---|---|
| `−` | Cycle clock faces: OEM → Digital → S52 → OEM |
| `+` | Enter CarPlay (from any clock) / Exit CarPlay |

---

## Physical Installation

```
[iPhone] ──wireless──► [Carlinkit dongle]──USB──► [Pi 5]
                                                      │
                                          ┌───────────┼───────────┐
                                       micro HDMI   USB-C      USB-A
                                          │         power        │
                                       [Display] [Supercap UPS] [USB DAC]
                                       (E30 dash)  (ACC 12V)     │
                                                              [Kenwood AUX]
```

### Mounting
- Display flush in E30 clock opening (portrait, PCB behind dash panel)
- Pi 5 mounted behind dash with VHB tape or velcro
- **Carlinkit dongle:** direct to a Pi USB port (not through the USB3 hub); keep the dongle body
  **physically away from the Pi and its USB3 ports** — glove-box proximity to the Pi may cause
  2.4 GHz / USB3 interference (see HANDOFF issue #2). A short USB extension can relocate the
  dongle while keeping a direct port connection.
- Power tapped from stereo switched-ignition line via a supercap UPS (replaces
  the old buck — it rides through the crank voltage sag; see HANDOFF issue #1)
- AUX cable to Kenwood head unit

### Power fix (install pending — parts ordered)

**Goal:** Pi 5 not auto-booting after engine crank — plain buck browns out during crank voltage
sag; replace with Fockety supercap UPS + TVS diodes on input and output.

**Parts ordered:** Fockety supercap UPS (9–24 V → 5 V/3 A, 4S), Chanzon 1.5KE24A (input TVS),
P6KE6.8A (output TVS). Full step-by-step install checklist and post-crank test procedure are in
`HANDOFF.md` issue #1.

### Power Chain
```
Switched-ignition 12V (terminal 15 / purple accessory wire)
  │   (stays live through crank on the E30 — voltage just sags)
  └─► [Add-a-Circuit fuse tap / Posi connector]   (solderless)
        └─► [Fockety supercap UPS  9–24V in → 5V/3A out, 4S]
              │   (bridges the crank sag; TVS diode clamped on DC_IN and DC_OUT)
              └─► USB-C (≥4A) → Pi 5
```

---

## Project Structure

```
e30piplay/
├── src/
│   ├── App.jsx
│   ├── global.css
│   └── components/
│       ├── DisplaySwitcher.jsx   # Screen routing, button logic
│       ├── LogoIntro.jsx         # BMW roundel spin animation (boot)
│       ├── FactoryClock.jsx      # OEM white analog clock
│       ├── DigitalClock.jsx      # OEM red LED digital clock
│       ├── AnalogClock.jsx       # S52 amber analog clock
│       └── CarPlayReceiver.jsx   # “Open CarPlay” → POST /api → cage + Electron AppImage
├── public/
│   └── BMW-Logo-1970-1989.png
├── setup.sh                      # Pi OS Lite + cage + nginx (one shot)
├── carplay-server.cjs            # Launcher API (localhost + nginx /api/)
├── SHOPPING_LIST.md
└── PROJECT_BRIEF.md
```

---

## Development

```bash
npm run dev        # Local dev server at localhost:5173
npm run build      # Production build → dist/
```

Test at exact screen resolution in Chrome:
DevTools → Device toolbar → Custom → **480 × 640**

---

## Pi Deployment

```bash
# 1. Flash Pi OS Lite (64-bit) with SSH (Pi Imager)
# 2. Clone repo to ~/e30piplay
# 3. Run setup (once):
bash setup.sh
sudo reboot

# 4. CarPlay: setup.sh installs the upstream Electron AppImage and kiosk → cage handoff (README).
```
