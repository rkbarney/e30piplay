# e30piplay (S52 Solutions Display)

Custom Raspberry Pi 5 touchscreen UI for a BMW E30 dashboard clock location.
The app provides a stylized boot sequence, three clock faces, and a CarPlay
entry screen that hands the display to the upstream Electron **`react-carplay`** AppImage on the Pi (see README).

## What it does

- Shows a terminal-style boot screen and logo intro
- Cycles between three clock faces (`Factory`, `Digital`, `S52 Analog`)
- Uses `-` to cycle clock faces and `+` to open the CarPlay screen (launch Electron from there on the Pi)
- Runs in a fixed 320x480 design viewport with auto scaling
- Supports kiosk exit via localhost helper when launched with kiosk scripts

## Stack

- React 18 + Vite
- ESLint (React + Hooks rules)
- Chromium kiosk (Wayland / labwc, multi-client) on Raspberry Pi OS Lite
- Nginx + systemd via `setup.sh`

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
│   └── web/
├── public/
├── scripts/
├── docker-compose.yml
├── setup.sh
├── docs/
│   └── linux-deployment-paths.md
└── PROJECT_BRIEF.md
```

## Local development

```bash
npm install
npm run dev
```

Open the Vite URL and test with a 320x480 viewport for realistic layout.

### Docker on macOS (nginx + built UI only)

The Pi stack is **Lite + cage + Chromium**; Docker Desktop on macOS cannot mirror that fully. Use Compose to serve the **same nginx-style static bundle** as the Pi for UI checks only ([docs/linux-deployment-paths.md](docs/linux-deployment-paths.md)).

1. Install [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) and start it.
2. From the repo root:

   ```bash
   docker compose up --build
   ```

   Or: `./scripts/docker-nginx-up.sh`

3. Open [http://localhost:8080](http://localhost:8080) — devtools device mode ~320×480.

## Quality checks

```bash
npm run lint
npm run build
```

## Raspberry Pi deployment

**Image:** [Raspberry Pi Imager](https://www.raspberrypi.com/software/) → **Raspberry Pi OS Lite (64-bit)** → flash SD.

**SSH:** Turn **SSH** on in Imager’s **gear icon** (set hostname, username, and password there too). If you skipped it, `ssh user@pi-ip` will fail or **connection refused** until SSH is enabled (easiest fix: re-flash with SSH on, or enable from local keyboard on the Pi: `sudo systemctl enable --now ssh` after installing `openssh-server`).

**Ethernet:** Works independently of Wi‑Fi; ignore rfkill Wi‑Fi messages if you’re on wired LAN.

**First login:** Raspberry Pi OS Lite does **not** always ship with **`git`** installed. After SSH works:

```bash
sudo apt update
sudo apt install -y git
```

**Install path:** clone this repo to **`~/e30piplay`** (default used by `setup.sh`). To use another directory, run `APP_DIR=/path/to/repo bash setup.sh`.

```bash
git clone -b experiment/pios-lite-cage https://github.com/rkbarney/e30piplay.git ~/e30piplay
cd ~/e30piplay
bash setup.sh
sudo reboot
```

(Use `main` instead of `experiment/pios-lite-cage` if you deploy from that branch.)


`setup.sh` is intended as a **single appliance installer**: it installs **labwc**, **wlrctl**, **seatd**, **Chromium**, **nginx**, **Node**, publishes **`dist/`** to **`/var/www/s52-display`**, **`location /api/`** → **`carplay-server.cjs`** (POST flips labwc focus kiosk ↔ Electron CarPlay via `wlrctl`), **downloads the upstream react-carplay AppImage** (unless **`S52_SKIP_REACT_CARPLAY_APPIMAGE=1`** for offline installs), applies **`display_rotate`** / optional HDMI mode in **`/boot/firmware/config.txt`**, enables **`s52-cage-kiosk`** (runs labwc; Chromium **and** the AppImage are clients), **`s52-carplay`**, **TTY1 autologin**, Carlinkit **udev**, and **NOPASSWD** **`/usr/local/bin/s52-carplay-switch.sh`**. labwc autostart and rc.xml are installed to `~/.config/labwc/`. Override rotation: `S52_DISPLAY_ROTATE=0 bash setup.sh`. Custom 480×320-style mode: `S52_CUSTOM_HDMI=1 bash setup.sh`. AppImage version: **`REACT_CARPLAY_VERSION=…`** (default **4.0.5**).

**Already ran `setup.sh` before autologin was added?** Over SSH (as the user that should autologin):

```bash
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
sudo tee /etc/systemd/system/getty@tty1.service.d/autologin.conf > /dev/null <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $(whoami) --noclear %I \$TERM
EOF
sudo systemctl daemon-reload
sudo reboot
```

(Physical access = logged-in shell on the console — normal tradeoff for a dedicated dash unit.)


**Iterate UI without re-running full setup:**

```bash
cd ~/e30piplay && git pull && npm ci && npm run build
sudo rsync -a --delete dist/ /var/www/s52-display/
sudo systemctl restart s52-cage-kiosk s52-carplay
```

**Refresh nginx, systemd, launcher scripts, or retry AppImage download:** run **`bash setup.sh`** again from **`~/e30piplay`** (safe; idempotent). Example offline omit Electron download: **`S52_SKIP_REACT_CARPLAY_APPIMAGE=1 bash setup.sh`**.

**SSH helpers**

- Restart kiosk: `s52-car-display` (uses sudo).
- Logs: `journalctl -u s52-cage-kiosk -f`
- Stop UI for maintenance: `sudo systemctl stop s52-cage-kiosk`

**Open CarPlay → HTTP 405:** nginx is handling **`POST /api/…`** as the SPA (**`try_files`** falls through to **`index.html`**; POST to a static file → **405**). Fix by deploying the **`location ^~ /api`** block from this repo — easiest: **`cd ~/e30piplay && git pull && bash setup.sh`** (rewrites **`/etc/nginx/sites-available/s52`**), then **`sudo nginx -t && sudo systemctl reload nginx`**. Also check **`systemctl is-active s52-carplay`** (logs: **`journalctl -u s52-carplay -n 30`**).

**HTTP 502** or journal **`require is not defined`** on **`carplay-server.js`:** the unit must run **`carplay-server.cjs`**, not **`carplay-server.js`**, because **`package.json`** has **`"type": "module"`**. Running **`setup.sh` from `~/e30piplay`** used to make **`install`** fail (“same file”), so **`systemd`** never updated and kept **`carplay-server.js`**. **`git pull && bash setup.sh`** fixes that (and removes stray **`carplay-server.js`**). Check **`systemctl cat s52-carplay | grep ExecStart`**.

**If the kiosk restarts in a loop** and logs show **`systemd-inhibit` / Interactive authentication required**:

1. **Update the installed launcher** (the service does **not** read `~/e30piplay/scripts/` — only `~/.local/bin/s52-kiosk-inner.sh`). On the Pi, after `git pull`:

   ```bash
   cd ~/e30piplay && git pull && bash scripts/pi-fix-kiosk-launcher.sh
   ```

   Or manually:

   ```bash
   cd ~/e30piplay && git pull
   install -m 755 ~/e30piplay/scripts/s52-kiosk-inner.sh ~/.local/bin/s52-kiosk-inner.sh
   grep INHIBIT_CMD ~/.local/bin/s52-kiosk-inner.sh && echo 'Still old launcher — fix install' || echo 'Launcher OK (no INHIBIT_CMD)'
   sudo systemctl restart s52-cage-kiosk
   ```

2. The script runs **`/usr/lib/chromium/chromium`** only (never **`chromium`** from PATH), so a Debian **`/usr/bin/chromium`** wrapper cannot inject **`systemd-inhibit`**.

EGL warnings from cage alone are often harmless.

Runtime references:

- labwc autostart (launches Chromium + AppImage as siblings): `scripts/s52-labwc-autostart.sh` → `~/.config/labwc/autostart`
- CarPlay USB audio template: `scripts/s52-carplay-audio.env.example` → `~/.config/s52-carplay-audio.env.example` (see **USB audio** below)
- labwc rc.xml (windowRule iconifies AppImage on first map): `scripts/s52-labwc-rc.xml` → `~/.config/labwc/rc.xml`
- Chromium wrapper (foreground kiosk window): `scripts/s52-kiosk-inner.sh` (installed to `~/.local/bin`)
- CarPlay focus bridge: **`carplay-server.cjs`** + **`scripts/s52-carplay-switch.sh`** → **`/usr/local/bin/s52-carplay-switch.sh`** (`wlrctl toplevel focus|minimize app_id:react-carplay`)
- Exit helper: `scripts/s52-kiosk-exit-server.py`
- Optional kiosk URL / ports: `scripts/s52-display-layout.conf.example` → `~/.config/s52-display-layout.conf`
- Boot branding: `scripts/s52-boot-branding.sh`

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

**`npm install react-carplay` will 404.** The project [rhysmorgan134/react-carplay](https://github.com/rhysmorgan134/react-carplay) is an **Electron** application; it is **not** published as an npm package you can drop into this Vite + Chromium kiosk.

**On the Pi today:** **`setup.sh`** installs the upstream **AppImage** by default (`~/.local/bin/react-carplay`). The AppImage is **pre-loaded at boot** as a sibling labwc client of Chromium (auto-iconified by a windowRule on `react-carplay`), so by the time the user taps **`+`** the dongle-detection / "connecting phone" splash is already past. Tap **`+`** → **POST `/api/launch-react-carplay`** → **`carplay-server.cjs`** runs **`wlrctl toplevel focus app_id:react-carplay`** — instant focus, no service churn, no terminal flash, no white loading screen. Return path: **`/api/return-to-kiosk`** → **`wlrctl toplevel minimize app_id:react-carplay`**.

**SSH escape hatch:** `sudo /usr/local/bin/s52-carplay-switch.sh return`.

**Still not implemented:** decoding CarPlay purely inside the Chromium window (would need e.g. **`node-carplay`** + video/WebSocket bridge).

**Desktop dev:** set **`VITE_S52_API_BASE=http://your-pi-host`** when running **`npm run dev`** so the **`+`** CarPlay screen’s POST hits the Pi launcher API.

**If AppImage failed during setup** (no network, wrong arch): `bash ~/e30piplay/scripts/install-react-carplay-appimage.sh` then **`sudo systemctl restart s52-cage-kiosk`** if needed.

**Manual AppImage-only** (same script **`setup`** runs internally):

```bash
bash ~/e30piplay/scripts/install-react-carplay-appimage.sh
```

Or fetch the installer raw from GitHub (use your branch or `main` if unsure):

```bash
curl -fsSL https://raw.githubusercontent.com/rkbarney/e30piplay/main/scripts/install-react-carplay-appimage.sh | bash
```

## USB audio (CarPlay / Spotify)

**`setup.sh`** installs **PipeWire** (`pipewire-pulse`, `wireplumber`), **`pulseaudio-utils`** (`pactl`), and **`alsa-utils`**, then tries **`scripts/pi-audio-usb-default.sh`** so a **USB→3.5mm DAC** is the default for **react-carplay** (Electron). **Plug the DAC before or during setup** if you want that step to succeed on the first run.

What is configured on the Pi:

- **`~/.config/labwc/autostart`** — before each react-carplay start: unmutes common USB DAC mixers (**PCM** then **Extension Unit**), sources **`~/.config/s52-carplay-audio.env`** if present.
- **`~/.config/s52-carplay-audio.env`** — `PULSE_SINK` and/or `ALSA_CARD`; template: **`~/.config/s52-carplay-audio.env.example`** (also under `scripts/s52-carplay-audio.env.example` in the repo).

**If you add the DAC later** (or changed USB ports), SSH to the Pi and run (as the kiosk user, from the repo clone):

```bash
bash ~/e30piplay/scripts/pi-audio-usb-default.sh
sudo systemctl restart s52-cage-kiosk
```

**Do not** run `pi-audio-usb-default.sh` on your Mac; it is Pi-only (the script exits on non-Linux).

## Notes

- On the Pi, `setup.sh` defaults to **`~/e30piplay`** for the installed copy (`APP_DIR`).
