# Linux deployment (reference)

Single supported stack for this repo:

## Current — Raspberry Pi OS Lite + cage + Chromium + nginx

**Install:** flash **Raspberry Pi OS Lite (64-bit)** with SSH enabled, clone repo to **`~/e30piplay`** (or set `APP_DIR`), run **`bash setup.sh`**, reboot.

**Runtime:**

- **`cage`** runs full-screen Wayland; **`s52-kiosk-inner.sh`** starts Chromium (`--ozone-platform=wayland --no-sandbox`) against **`http://localhost`** (nginx).
- **`seatd`** + **`loginctl enable-linger`** so `/run/user/$UID` exists without a desktop login.
- **Display rotation / custom HDMI timings:** written into **`/boot/firmware/config.txt`** by **`setup.sh`** (marker block `# --- S52 e30piplay begin` … `end`). Override defaults with env vars before running setup — see header comments in **`setup.sh`** (`S52_DISPLAY_ROTATE`, `S52_CUSTOM_HDMI`).
- **CarPlay launcher:** **`s52-carplay`** (**`carplay-server.cjs`** on **127.0.0.1:3001**) + nginx **`location /api/`** (POST switches **`s52-cage-kiosk`** ↔ **`s52-cage-react-carplay`**). **`setup.sh`** also downloads the upstream **react-carplay** AppImage unless **`S52_SKIP_REACT_CARPLAY_APPIMAGE=1`**. Optional **`/ws`** proxy remains for future use.

**Docker on Mac** cannot validate USB Carlinkit or Pi GPU; use **`docker compose up --build`** for nginx + static UI only.

---

## Future — Buildroot + SDL2/LVGL (optional)

Only if you drop Chromium for minimal boot time. See historical notes in git history or earlier revisions of this file for Buildroot outline; not automated in-repo today.

---

## Legacy — Pi OS Desktop + labwc + `wlr-randr`

Earlier bench workflow used full Desktop and **`s52-kiosk-launch.sh`**. That path has been **removed** from this repo in favor of Lite + cage only.
