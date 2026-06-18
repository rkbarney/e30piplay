# e30piplay — Agent Handoff

Status as of 2026-06-18. This is the orientation doc for the next agent. Read it
before touching anything. For build/deploy specifics also see `README.md`.

---

## TL;DR — current working state

A Raspberry Pi 5 CarPlay head-unit add-on for a BMW E30 with an aftermarket
Kenwood stereo. **It is installed in the car and working:** wireless CarPlay
shows on the dash screen, audio plays through the car speakers, and the
microphone works for calls/Siri.

Confirmed working:
- **CarPlay video** — wireless via a Carlinkit dongle ("Auto Box"), rendered by
  the upstream `react-carplay` AppImage under a labwc/Wayland kiosk.
- **Audio OUT** — USB audio adapter (C-Media / Unitek Y-247A) analog output →
  3.5mm → **Kenwood AUX-in**.
- **Mic IN** — USB lavalier mic (DCMT) for calls/Siri.
- **Power** — 25 W (12/24 V → 5 V/5 A) buck on the stereo's switched/ACC line.
- **WiFi** — joins `biscuit` at a static `192.168.1.92`.

Bluetooth audio was prototyped and then **removed** (AUX works; BT added
latency/complexity for no benefit). Don't re-add it without a reason.

---

## ⚠️ Most important things to know

1. **The AUX cable must be in the adapter's HEADPHONE/OUTPUT jack, not the MIC
   jack.** The USB audio adapter has two identical-looking 3.5 mm holes. The
   entire multi-session "AUX doesn't work" saga was the cable being in the mic
   jack. If there's ever "no sound but the Pi is clearly outputting," check this
   first.

2. **Bench vs. car — the peripherals live in the car, not on the bench Pi.**
   The screen, USB audio adapter, mic, power buck, and wiring are *permanently
   mounted in the dash*. At the bench, the Pi has **only the Carlinkit dongle**
   attached.
   - Therefore, **at the bench the default audio sink is `auto_null` and there
     is no USB audio card / mic — THIS IS NORMAL, not a bug.** The saved
     `PULSE_SINK`/`PULSE_SOURCE` names re-match the real devices the moment the
     Pi is plugged back into the car harness.
   - Workflow: Pi normally lives at the bench for development; bring it to the
     car (driveway) to test the full install.

3. **Network reachability is location-dependent.** The Pi only joins home WiFi
   (`biscuit`) when it's in range (bench, or car in the driveway). Out on the
   road it is unreachable — expect SSH to hang/`255` then. Don't interpret that
   as a broken Pi.

4. **The Pi 5 has hard hardware limits that shaped the design:**
   - **No USB device/gadget mode** (`/sys/class/udc` is empty) → it can never
     feed audio into the Kenwood's USB port (USB-out is impossible; don't retry).
   - **No onboard 3.5 mm jack** → analog audio only via the USB adapter.
   - Audio out is therefore **AUX (analog via USB adapter)** — that's it.

---

## How to connect

From the user's Mac (`~/.ssh/config` already has these):

```bash
ssh s52       # -> 192.168.1.92  (WiFi, primary)
ssh s52eth    # -> 192.168.1.96  (ethernet, only when wired at the bench)
```

- WiFi network `biscuit`, static IP `192.168.1.92` (set in NetworkManager,
  scoped to that connection, autoconnect on boot).
- User: `admin`. Sudo password is known to the user (not stored in the repo —
  never commit it).
- `s52.local` mDNS is flaky on the AT&T gateway; that's why we hardcode the IP.

Anything that talks to the Pi's audio/Wayland stack over SSH needs
`export XDG_RUNTIME_DIR=/run/user/1000` first (PipeWire/labwc run in the kiosk
user's session).

---

## Where things live

### On the Pi (`admin@`)
| Path | What |
|---|---|
| `~/e30piplay/` | git checkout of this repo (APP_DIR). `carplay-server.cjs` runs from here. |
| `~/apps/squashfs-root/` | extracted `react-carplay` AppImage; launcher `~/.local/bin/react-carplay`. |
| `~/.config/labwc/autostart` | session autostart (from `scripts/s52-labwc-autostart.sh`): swaybg + Chromium kiosk + react-carplay launch loop. |
| `~/.config/s52-carplay-audio.env` | **audio routing** — `PULSE_SINK` (AUX adapter), `PULSE_SOURCE` (lavalier mic), `ALSA_CARD`. Sourced by the autostart. Not in git. |
| `/var/www/s52-display/` | built kiosk UI served by nginx (port 80). |
| `/boot/firmware/config.txt` | has managed block: `display_rotate=1`, `usb_max_current_enable=1`. |
| `/etc/systemd/system/s52-carplay.service` | the `/api` server (port 3001, `User=admin`, `XDG_RUNTIME_DIR` set). |
| `s52-cage-kiosk.service` | the labwc kiosk (Chromium + preloaded react-carplay). |

### In the repo
| Path | What |
|---|---|
| `setup.sh` | full provisioning (packages, services, nginx, config.txt, scripts). |
| `carplay-server.cjs` | tiny HTTP API behind nginx `/api/*`: `/api/carplay-ready`, `/api/launch-react-carplay`, `/api/return-to-kiosk`. |
| `src/` | Vite + React (JSX) kiosk UI. Entry: `main.jsx` → `App.jsx` → `components/DisplaySwitcher.jsx`. |
| `scripts/s52-labwc-autostart.sh` | the session autostart (Mesa/Vulkan workarounds + audio env sourcing + relaunch loop). |
| `scripts/install-react-carplay-appimage.sh` | downloads + patches the AppImage (`show:true`, media-access). |
| `SHOPPING_LIST.md` | hardware + solderless power wiring plan/diagram. |

> **Deploy caveat:** the Pi's working copy of `scripts/install-react-carplay-appimage.sh`
> and `scripts/s52-labwc-autostart.sh` shows as locally modified (live tweaks).
> Prefer `scp`-ing specific files to the Pi over `git pull` to avoid clobbering
> those, or reconcile them deliberately.

---

## Build & deploy (UI / server changes)

Done on the Pi (it has node 20 + the repo). Typical loop:

```bash
# copy changed files to the Pi (scp, because of the local-mods caveat above), then:
ssh s52 'cd ~/e30piplay && npm run build && \
  echo <pw> | sudo -S rsync -a --delete dist/ /var/www/s52-display/ && \
  echo <pw> | sudo -S systemctl restart s52-carplay s52-cage-kiosk'
```

- `npm run build` → `dist/` (Vite). nginx serves `/var/www/s52-display`, proxies
  `/api/*` → `127.0.0.1:3001`.
- Restart `s52-carplay` for server changes; `s52-cage-kiosk` to reload the UI
  (also relaunches react-carplay, re-sourcing the audio env).

---

## Boot flow

1. Pi boots → labwc kiosk session (`s52-cage-kiosk`).
2. `~/.config/labwc/autostart`: black bg → Chromium kiosk (the React UI at
   `http://localhost`) → background `react-carplay` AppImage (iconified until
   the user taps `+`).
3. `s52-carplay` API comes up; the UI polls `/api/carplay-ready` and shows the
   `+` button when the AppImage is a live Wayland toplevel.
4. Tapping `+` focuses react-carplay (via `wlrctl`); `-` cycles clock faces.

---

## History / gotchas (why things are the way they are)

- **Mesa 25.0.7 GBM regression** crashed react-carplay's GPU process. Fix in
  `s52-labwc-autostart.sh`: force software GL (`LIBGL_ALWAYS_SOFTWARE=1`,
  `GALLIUM_DRIVER=llvmpipe`) and `--disable-features=Vulkan,WebGPU`. Opt back
  into hardware with `S52_CARPLAY_GPU=1` once Mesa is fixed upstream.
- **AppImage patches** (`install-react-carplay-appimage.sh`): `show:false`→`true`
  (window never mapped on Wayland otherwise) and an `askForMediaAccess` shim.
- **`usb_max_current_enable=1`** in `config.txt`: the 25 W buck is a "dumb" 5 V
  source (no USB-PD), so without this the Pi caps USB current / warns.
- **ALSA unmute mismatch (minor, known):** the autostart tries to unmute ALSA
  controls `PCM`/`Extension Unit`/`Capture`/`Mic Capture`/`Mic`, but the
  C-Media card's actual playback control is **`Speaker`** (controls present:
  `Speaker`, `Mic`, `Auto Gain Control`). It works today only because `Speaker`
  defaults to 100%/unmuted. **Nice-to-have:** make the autostart explicitly set
  `Speaker` so a future boot can't surprise with silence.

---

## Outstanding / possible next tasks

- (Nice-to-have) Fix the autostart to unmute the real `Speaker` control on the
  C-Media adapter (see above).
- (Optional) Oil-pressure **Arduino**: the owner has a personal Arduino gauge
  (analog oil-pressure sensor → mini LCD). Plan was to power it from a Pi USB
  port (it's standalone, ~100 mA). Marked optional in `SHOPPING_LIST.md`. A
  longer-term idea (read the sensor on the Pi via an I2C ADC and render a gauge
  in the UI) was explicitly deferred — do not build unless asked.
- (Optional) MagSafe/Qi phone charger in the car would need its **own** 12 V→USB-C
  PD module off the ACC tap — never off the Pi (5 V only). See `SHOPPING_LIST.md`.

## Do NOT

- Re-add Bluetooth audio (removed on purpose).
- Pursue USB audio-out to the head unit (impossible on Pi 5 — no USB gadget).
- Commit any secrets (WiFi/sudo passwords). They live only on the Mac's
  `~/.ssh/config` and the Pi's NetworkManager config.
