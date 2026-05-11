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
| Display | OSOYOO 3.5" HDMI Capacitive Touch, 480×320 | 🛒 Order |
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
| CarPlay receiver | react-carplay (github.com/rhysmorgan134/react-carplay) |
| Static server | nginx |
| CarPlay backend | Node.js service (systemd) |
| Browser | Chromium in kiosk mode |

---

## Display Screens

### Boot Sequence
- ASCII terminal aesthetic, Courier New font
- M-TECH logo + S52 Solutions branding
- Scrolling system init messages
- Progress bar 0→100%

### Logo Intro
- BMW logo (1970–1989 era) spins in fast, decelerates, settles
- Fades into clock face

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
- Full-screen react-carplay receiver (placeholder until dongle arrives)
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
│       ├── BootScreen.jsx        # ASCII terminal boot
│       ├── LogoIntro.jsx         # BMW logo spin animation
│       ├── FactoryClock.jsx      # OEM white analog clock
│       ├── DigitalClock.jsx      # OEM red LED digital clock
│       ├── AnalogClock.jsx       # S52 amber analog clock
│       └── CarPlayReceiver.jsx   # CarPlay (placeholder → react-carplay)
├── public/
│   └── BMW-Logo-1970-1989.png
├── setup.sh                      # Pi OS Lite + cage + nginx (one shot)
├── carplay-server.js             # CarPlay backend (placeholder)
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

# 4. When Carlinkit dongle arrives:
cd ~/e30piplay
npm install react-carplay
# Update src/components/CarPlayReceiver.jsx
npm run build
sudo rsync -a --delete dist/ /var/www/s52-display/
sudo systemctl restart s52-carplay nginx s52-cage-kiosk
```
