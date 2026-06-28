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
| Car | 1989 BMW 325i Sedan — Delphi Grey Metallic, tan/Natur Beige interior |
| Engine | S52 3.2L bottom end / M50 non-Vanos head swap (BAR certified, CA) |
| Chassis VIN | WBAAD1307K8835704 |
| Engine VIN | WBSCD9325WEE7712 |
| Owner / home | Dave, El Sobrante CA |
| Audio | Kenwood head unit (Bluetooth), JL subs; USB + AUX |
| Head unit inputs | USB + AUX |
| Clock opening | 76mm wide × 84mm tall (portrait) |

---

## Hardware

| Component | Model | Status |
|---|---|---|
| Display | Waveshare 2.8" HDMI Capacitive Touch, 480×640 portrait | ✅ Installed |
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

### HAL (default boot screen)
- Voice-driven assistant: offline wake-word + whisper.cpp STT, Claude Haiku for intent/replies, Piper TTS in a cloned HAL 9000 voice
- Can navigate the whole UI by voice ("HAL, switch to CarPlay", "HAL, show the clock", etc.)

### OEM Clock (Factory)
- White on black, no numbers
- Cartesian cross at 12/3/6/9 with spoke marks at other hours
- Rounded square face matching factory E30 clock shape
- `-` / `+` buttons below

### Digital Clock
- Red LED aesthetic matching OEM E30 digital clock
- AM/PM indicator
- OEM button labels: h/DAT, HOUR, TEMP / min/DAT, DATE, MEMO

### Navigation (prototype)
- Offline turn-by-turn via [Organic Maps](https://organicmaps.app/) (Flatpak
  `app.organicmaps.desktop`), OSM vector map data
- Pre-warmed at boot (iconified) same as CarPlay; `−` cycles to it, tap to focus
- No destination input on-device yet (tiny screen) — planned: enter start/stop on a
  phone-served mirror page (geocoded via Nominatim) while on the car's hotspot

### System
- OTA / update screen — pull latest code, switch branches, view WiFi profiles

### Games
- ROM emulator screen

### CarPlay
- Full-screen CarPlay via upstream Electron project (not embedded here yet)
- Press `+` on any face to enter
- Press `+` again to return to the previous face

---

## Navigation

| Button | Action |
|---|---|
| `−` | Cycle faces: HAL → Factory → Digital → System → Navigation → Games → HAL |
| `+` | Enter CarPlay (from any face) / Exit CarPlay back to the last face |

---

## Physical Installation

```
[iPhone] ──wireless──► [Carlinkit dongle]──USB──► [Pi 5]
                                                      │
                                          ┌───────────┼───────────┐
                                       micro HDMI   USB-C      USB-A
                                          │         power        │
                                       [Display]  [Buck conv]  [USB DAC]
                                       (E30 dash)  (ACC 12V)     │
                                                              [Kenwood AUX]
```

### Mounting
- Display flush in E30 clock opening (portrait, PCB behind dash panel)
- Pi 5 mounted behind dash with VHB tape or velcro
- Power tapped from stereo ACC 12V line via buck converter
- AUX cable to Kenwood head unit

### Power Chain
```
ACC 12V (stereo wire)
  └─► [solder splice + XT30 inline connector]
        └─► [12V→5V 5A buck converter]
              └─► USB-C → Pi 5
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
│       ├── Hal.jsx               # Voice assistant screen
│       ├── FactoryClock.jsx      # OEM white analog clock
│       ├── DigitalClock.jsx      # OEM red LED digital clock
│       ├── SystemScreen.jsx      # OTA / update screen
│       ├── Games.jsx             # ROM emulator screen
│       ├── CarPlayReceiver.jsx   # “Open CarPlay” → POST /api → cage + Electron AppImage
│       ├── MapsReceiver.jsx      # “Open Maps” → POST /api → wlrctl focus on Organic Maps
│       └── ViewportScale.jsx     # Scales fixed 320×480 UI to the real screen
├── public/
│   └── BMW-Logo-1970-1989.png
├── setup.sh                      # Pi OS Lite + cage + nginx (one shot)
├── carplay-server.cjs            # Launcher API (localhost + nginx /api/)
├── scripts/                      # Voice sidecar, WiFi/branch/update helpers, etc.
├── docs/
│   └── environment.md            # As-built hardware/software (source of truth)
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
DevTools → Device toolbar → Custom → **320 × 480**

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
