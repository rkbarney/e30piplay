# e30piplay (S52 Solutions Display)

Custom Raspberry Pi 5 touchscreen UI for a BMW E30 dashboard clock location.
The app provides a stylized boot sequence, three clock faces, and a CarPlay
placeholder flow designed for Carlinkit + `react-carplay`.

## What it does

- Shows a terminal-style boot screen and logo intro
- Cycles between three clock faces (`Factory`, `Digital`, `S52 Analog`)
- Uses `-` to cycle clock faces and `+` to enter/exit CarPlay
- Runs in a fixed 320x480 design viewport with auto scaling
- Supports kiosk exit via localhost helper when launched with kiosk scripts

## Stack

- React 18 + Vite
- ESLint (React + Hooks rules)
- Chromium kiosk mode on Raspberry Pi OS
- Optional Nginx + systemd services via `setup.sh`

## Project layout

```text
.
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── global.css
│   └── components/
│       ├── DisplaySwitcher.jsx
│       ├── BootScreen.jsx
│       ├── LogoIntro.jsx
│       ├── FactoryClock.jsx
│       ├── DigitalClock.jsx
│       ├── AnalogClock.jsx
│       ├── CarPlayReceiver.jsx
│       ├── ViewportScale.jsx
│       └── KioskExit.jsx
├── public/
├── scripts/
├── setup.sh
└── PROJECT_BRIEF.md
```

## Local development

```bash
npm install
npm run dev
```

Open the Vite URL and test with a 320x480 viewport for realistic layout.

## Quality checks

```bash
npm run lint
npm run build
```

## Raspberry Pi deployment

The one-shot setup script installs system dependencies, builds the app, publishes
`dist` to Nginx root, and installs helper scripts/services.

```bash
bash setup.sh
```

After setup, start the kiosk UI manually from desktop:

```bash
s52-car-display
```

Useful runtime files:

- Kiosk launcher: `scripts/s52-kiosk-launch.sh`
- Exit helper server: `scripts/s52-kiosk-exit-server.py`
- Display config template: `scripts/s52-display-layout.conf.example`

## CarPlay integration status

`src/components/CarPlayReceiver.jsx` is intentionally a placeholder.
When the dongle and dependency are ready:

```bash
npm install react-carplay
```

Then replace the placeholder renderer with the real `react-carplay` component.

## Notes

- This repository currently uses the local folder name `tinycarplay`.
- You can publish it to GitHub as `e30piplay` without changing runtime behavior.
