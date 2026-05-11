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
├── docker/
│   └── phase2-web/
├── public/
├── scripts/
├── docker-compose.phase2.yml
├── setup.sh
└── PROJECT_BRIEF.md
```

## Local development

```bash
npm install
npm run dev
```

Open the Vite URL and test with a 320x480 viewport for realistic layout.

### Phase 2 stack on macOS (Docker — nginx like the Pi)

Phase 2 targets Raspberry Pi OS **Lite** + **nginx** + **cage** + Chromium (see [docs/linux-deployment-paths.md](docs/linux-deployment-paths.md)). Docker Desktop does not expose a host Wayland socket the way a Linux desktop does, so **macOS is best used to iterate on the built UI served by nginx**; cage + fullscreen Chromium should be exercised on the Pi (or a Linux machine) before you rely on them in the car.

1. Install [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) and start it (Apple Silicon is a good match for `linux/arm64` Pi images; Intel Mac works too for this nginx-only setup).
2. From the repo root:

   ```bash
   docker compose -f docker-compose.phase2.yml up --build
   ```

   Or:

   ```bash
   ./scripts/docker-phase2-nginx-up.sh
   ```

3. Open [http://localhost:8080](http://localhost:8080) and use devtools device mode (~320×480) for layout checks.

On a **Linux** host with Wayland, you can smoke-test **cage + Chromium** against local nginx using the command in `docs/linux-deployment-paths.md` (Docker section under Phase 2).

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
- Boot branding helper: `scripts/s52-boot-branding.sh`

## Factory-style boot branding (hide Raspberry Pi login/branding)

If you want the Pi to look like an OEM car unit at boot (no Raspberry Pi splash,
minimal console noise, custom `s52 tech loading` splash), run:

```bash
chmod +x scripts/s52-boot-branding.sh
sudo scripts/s52-boot-branding.sh apply
sudo reboot
```

What this changes on the Pi:

- Disables firmware splash (`disable_splash=1`)
- Updates kernel cmdline for `quiet splash` boot
- Installs Plymouth and sets a custom `s52-tech` theme text splash
- Backs up original boot files to `/etc/s52-boot-branding-backup`

To verify:

```bash
sudo scripts/s52-boot-branding.sh status
```

To roll back to previous behavior:

```bash
sudo scripts/s52-boot-branding.sh revert
sudo reboot
```

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
