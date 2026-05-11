# Phase 2 — Pi OS Lite + cage (getting started)

This is the **full bench checklist**: flash once, run **`setup-phase2.sh`**, reboot. After that, iterate by **SSH + rebuild**, not by re-flashing.

Phase 2 replaces the full desktop (Phase 1) with **Raspberry Pi OS Lite**, **`cage`** (single-app Wayland compositor), and **Chromium kiosk** pointing at **nginx** on port 80. See also [`linux-deployment-paths.md`](linux-deployment-paths.md).

---

## What you need

| Item | Notes |
|------|--------|
| Raspberry Pi 5 | Matches repo assumptions |
| microSD card | Fresh flash recommended |
| Mac with [Raspberry Pi Imager](https://www.raspberrypi.com/software/) | Download Imager if needed |
| Ethernet | Your Pi is already on the LAN |
| This repo | Clone onto the Pi after first boot (or copy via USB) |

---

## 1. Flash the SD card (Mac)

1. Open **Raspberry Pi Imager**.
2. **Choose OS** → **Raspberry Pi OS (other)** → **Raspberry Pi OS Lite (64-bit)** — Bookworm-based Lite image for Pi 5.
3. **Choose storage** → your SD / USB stick (**everything on it will be erased**).
4. Click the **gear icon** (⚙️) **before** Write:
   - Set **hostname** (e.g. `s52-display`).
   - Set **username / password**.
   - Enable **SSH** (password authentication is fine for now).
   - Optionally **Wi‑Fi** if you stop using Ethernet later.
5. **Write**, wait for verify, then **eject** safely.

---

## 2. First boot — find the Pi on your network

1. Insert the card, power the Pi (Ethernet plugged in).
2. Wait ~1–2 minutes on first boot.
3. From your Mac, SSH in:
   ```bash
   ssh YOUR_USER@s52-display.local
   ```
   Replace hostname/user with what you set in Imager. If `.local` fails, use your router’s DHCP client list to get the Pi’s IP, then `ssh YOUR_USER@192.168.x.x`.

4. Update Lite once:
   ```bash
   sudo apt update && sudo apt upgrade -y
   sudo reboot
   ```

---

## 3. Put this project on the Pi

Pick one:

**Git (recommended)**

```bash
sudo apt install -y git
cd ~
git clone https://github.com/rkbarney/e30piplay.git tinycarplay
cd tinycarplay
```

If you use a private fork or branch (e.g. `experiment/pios-lite-cage`), check that branch out before setup:

```bash
git checkout experiment/pios-lite-cage   # example
```

**USB zip**

Copy the repo folder to the Pi under `/home/YOUR_USER/tinycarplay`, then `cd ~/tinycarplay`.

---

## 4. Run Phase 2 setup

From the repo root on the Pi:

```bash
cd ~/tinycarplay   # or wherever you cloned it
bash setup-phase2.sh
```

This installs **cage**, **seatd**, **Chromium**, **nginx**, **Node**, publishes **`dist/`** to `/var/www/s52-display`, installs **udev** rules for Carlinkit, enables **`systemd` linger** (needed for `/run/user/$UID` without a desktop login), and enables **`s52-cage-kiosk.service`** (auto kiosk at boot).

**Recommended:** reboot when the script finishes:

```bash
sudo reboot
```

---

## 5. HDMI / portrait / resolution (no `wlr-randr` in Lite)

Phase 2 does **not** use `wlr-randr` inside cage. Set rotation/mode in firmware:

```bash
sudo nano /boot/firmware/config.txt
```

Use the block appended by setup marked **`S52 Phase 2`**. Typical portrait tweak:

```ini
display_rotate=1
```

For custom timings (example only — tune for your panel):

```ini
hdmi_group=2
hdmi_mode=87
hdmi_cvt=480 320 60 6 0 0 0
hdmi_drive=1
```

Then:

```bash
sudo reboot
```

---

## 6. How to tell it’s working

| Check | Command / expectation |
|--------|----------------------|
| nginx | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/` → **200** |
| Kiosk service | `systemctl status s52-cage-kiosk` → **active (running)** |
| Logs | `journalctl -u s52-cage-kiosk -f` |
| From Mac | Open `http://HOSTNAME.local/` if firewall allows (default nginx listens on all interfaces) |

If you see a black screen or cage crashes, grab logs:

```bash
journalctl -u s52-cage-kiosk -b --no-pager | tail -80
journalctl -u seatd -b --no-pager | tail -40
```

---

## 7. Maintenance without kiosk

Stop the compositor (SSH):

```bash
sudo systemctl stop s52-cage-kiosk
```

You’ll get a **serial/console-style session** on HDMI (Lite has **no full desktop**). Edit files, run `git pull`, rebuild:

```bash
cd ~/tinycarplay
git pull
npm ci
npm run build
sudo rsync -a --delete dist/ /var/www/s52-display/
sudo systemctl start nginx   # if needed
sudo systemctl start s52-cage-kiosk
```

---

## 8. Dev loop (avoid re-flashing)

| Change | What to do |
|--------|------------|
| React/CSS only | `npm run build` → `rsync dist/` to `/var/www/s52-display/` → refresh tab / restart kiosk if cached badly |
| `setup-phase2.sh` / systemd / scripts | Re-run relevant bits or edit units → `sudo systemctl daemon-reload` → `restart` services |
| OS packages | `sudo apt install …` |
| New Lite image | **Rare** — only for corrupted SD / major OS jump |

---

## 9. CarPlay / Carlinkit (later)

Same as Phase 1 at the app layer: **`react-carplay`**, **`carplay-server.js`**, nginx **`/ws`** proxy — already scaffolded by **`setup-phase2.sh`**. Dongle validation still requires **hardware on the Pi**; see project README and `setup.sh` comments for the legacy Phase 1 path.

---

## 10. Rollback to Phase 1

Re-flash **Raspberry Pi OS Desktop (64-bit)** and use **`setup.sh`** (not **`setup-phase2.sh`**). Keep separate SD cards if you want both worlds without repeated flashes.
