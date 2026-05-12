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
- Chromium kiosk (Wayland / cage) on Raspberry Pi OS Lite
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


`setup.sh` installs **cage**, **seatd**, **Chromium**, **nginx**, **Node**, publishes `dist/` to `/var/www/s52-display`, applies **`display_rotate`** (and optional custom HDMI mode) in **`/boot/firmware/config.txt`**, enables **`s52-cage-kiosk`** (kiosk at boot), enables **TTY1 console autologin** for your user (no `login:` prompt on HDMI after reboot), and scaffolds CarPlay placeholder + udev. Override rotation before setup: `S52_DISPLAY_ROTATE=0 bash setup.sh`. Custom 480×320-style mode: `S52_CUSTOM_HDMI=1 bash setup.sh`.

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


**Iterate without re-flashing:**

```bash
cd ~/e30piplay && git pull && npm ci && npm run build
sudo rsync -a --delete dist/ /var/www/s52-display/
sudo systemctl restart s52-cage-kiosk
```

**SSH helpers**

- Restart kiosk: `s52-car-display` (uses sudo).
- Logs: `journalctl -u s52-cage-kiosk -f`
- Stop UI for maintenance: `sudo systemctl stop s52-cage-kiosk`

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

- Cage Chromium wrapper: `scripts/s52-kiosk-inner.sh` (installed to `~/.local/bin`)
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

`src/components/CarPlayReceiver.jsx` is intentionally a placeholder.
When the dongle and dependency are ready:

```bash
cd ~/e30piplay
npm install react-carplay
```

Then replace the placeholder renderer with the real `react-carplay` component; rebuild and `rsync` `dist/` as above.

## Notes

- On the Pi, `setup.sh` defaults to **`~/e30piplay`** for the installed copy (`APP_DIR`).
