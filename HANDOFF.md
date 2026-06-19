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
- **ALSA output unmute (fixed):** the C-Media card's real playback control is
  **`Speaker`** (controls present: `Speaker`, `Mic`, `Auto Gain Control`) — not
  the `PCM`/`Extension Unit` the autostart historically targeted. The autostart
  now explicitly runs `amixer ... sset Speaker 100% unmute` (best-effort,
  alongside the legacy `PCM`/`Extension Unit` calls) on every react-carplay
  (re)launch, so the analog output can't come up muted.

---

## Known issues & their fixes (post-install)

### 1. Pi 5 does not auto-boot after engine crank (needs PWR button press)
**Root cause (confirmed — retested 2026-06-19):** During engine cranking the ACC line is
cut and the 12 V sags. The 25 W buck's output capacitors hold just enough 5 V to keep the
Pi 5's PMIC (DA9091) alive but not enough to keep the SoC running. The Pi dies, but the
PMIC never sees a clean 5 V → 0 → 5 V edge, so it sits in a "was running, now stalled"
state waiting for the PWR button instead of cold-booting on the restored 5 V.

**Confirmed NOT a software/firmware fix.** A failed crank happens while the Pi has no
power, so nothing is running to recover it — no daemon, watchdog, or config can power on a
dead board. The one firmware lever was tested and ruled out:
- `POWER_OFF_ON_HALT` — a previous note claimed this was reverted, but it was still set to
  `1` in EEPROM. It was properly removed and re-flashed on 2026-06-19, then tested over
  several key → ACC → crank cycles: the Pi **still** required the button. Confirms the flag
  is irrelevant to the mid-crank brown-out. EEPROM no longer contains it.

**Diagnostics now in place** (so the next person has evidence): `scripts/s52-logging-setup.sh`
enables persistent journald, installs the `s52-bootmarker` service (logs throttle/under-volt
flags once per boot), and removes `POWER_OFF_ON_HALT`. Inspect with `journalctl -t s52-boot`
and `journalctl --list-boots`. In the failed-crank tests, every completed boot showed
`throttled=0x0` (clean 5 V) and the failed cranks left *no* boot entry at all — i.e. the Pi
never powered on, which is exactly the PMIC-limbo signature above.

**Fix — ride-through UPS HAT (chosen direction).** Keep the Pi powered *through* the crank
so it never reboots, and let it auto-boot if it ever does fully lose power. Feed it from the
existing buck so the buck still provides automotive input protection (no TVS needed):
```
ACC fuse tap → 25W buck (12V→5V) → UPS HAT (5V in) → Pi 5 (powered via HAT)
```
Power **only** into the HAT — never also into the Pi's USB-C. `usb_max_current_enable=1`
(already set) keeps the USB budget intact when the Pi is fed over the GPIO/pogo pins.

- **Amazon / "done now" pick:** Geekworm **X1200** (2-cell 18650, 5.1 V/5 A, auto-power-on,
  safe-shutdown) + matching **X1200-C1** case + 2 quality 18650s + a low-profile cooler (the
  NEO heatsink lid is gone). Caveat: **lithium in a hot car degrades/swells over time** —
  mount it in the coolest spot (glove box, *not* behind the HVAC) and inspect yearly. 2 cells
  is plenty; you only need ~1 s of ride-through.
- **Heat-ideal alternative:** AQEX **qUPS-P-SC** supercap HAT (−40…+65 °C, maintenance-free,
  has explicit "power-returned-during-shutdown" + "avoid restart cycle" logic). EU-only
  (Tindie/Lectronz, ~$55–72), slower to source. 2.5 A continuous — fine for this ~2 A load.

**Simplest no-battery alternative** (if you'd rather the Pi cold-boot once per start): a 12 V
delay relay (~$8–15) between the ACC tap and the buck, set to 3–5 s, so the Pi gets no power
until the engine is running and the crank is over. Or tap a 12 V source only live after start
(alternator charge-light / terminal 15a). Trade-off: ~30 s boot after each start vs. staying
alive through the crank.

### 2. CarPlay audio (music/media) drops ~1 s at a time; calls are fine
Two separate root causes were fixed (both 2026-06-18):

**a) Chromium autoplay policy (first-connect drop):** Electron's autoplay restrictions
block the media audio thread on the first unsolicited event. Fix: added
`--autoplay-policy=no-user-gesture-required` and `--disable-web-security` to the
react-carplay launch in `scripts/s52-labwc-autostart.sh`.

**b) PipeWire quantum underruns (intermittent drops during playback):** The Pi runs
software GL (llvmpipe) which causes CPU spikes. The default quantum of 1024 samples
(~21 ms) is too small — the audio thread gets starved and the buffer drains, producing
a ~1 s gap. Fix: `/etc/pipewire/pipewire.conf.d/99-s52-quantum.conf` sets quantum=4096
(~85 ms). This file is NOT in the repo; re-create it on re-provision:
```bash
sudo mkdir -p /etc/pipewire/pipewire.conf.d
sudo tee /etc/pipewire/pipewire.conf.d/99-s52-quantum.conf << 'EOF'
context.properties = {
    default.clock.quantum      = 4096
    default.clock.min-quantum  = 2048
    default.clock.max-quantum  = 8192
}
EOF
systemctl --user restart pipewire pipewire-pulse wireplumber
```

**Physical layout note:** Carlinkit is always plugged directly into the Pi (in the glove
box). The USB3 hub is in the HVAC area — physically separated, so USB3 2.4 GHz
interference is not a concern for this install.

### 3. CarPlay maps zoomed out and off-center
**Screen:** Waveshare 2.8" HDMI Capacitive Touch, **480×640** (portrait-native). The
PROJECT_BRIEF previously listed an OSOYOO 480×320 — that was the original plan; the actual
installed screen is the Waveshare 480×640.

**Root cause:** The react-carplay settings had `width: 800, height: 640` — wider than the
480-pixel screen. CarPlay rendered an 800×640 frame; react-carplay letterboxed it to fit the
480-wide display, producing black bars and shifting the car indicator off-center. Zoom felt
off because the wide frame was compressed horizontally.

**Fix (applied 2026-06-18):** Updated `~/.config/react-carplay/config.json` on the Pi to
match the physical screen exactly:
- `width: 480, height: 640`
- `dpi: 165`

CarPlay now renders a 480×640 portrait frame that fills the screen with no letterboxing.

Edit the config directly on the Pi:
```bash
ssh s52
python3 -c "
import json
with open('/home/admin/.config/react-carplay/config.json') as f: c=json.load(f)
c['width'], c['height'], c['dpi'] = 480, 640, 165
with open('/home/admin/.config/react-carplay/config.json', 'w') as f: json.dump(c, f, indent=2)
"
sudo systemctl restart s52-cage-kiosk
```

### 4. AUX ground-loop hum (low hum at idle, louder with volume up)
**Root cause:** Classic ground loop. The Pi's buck converter and the Kenwood head unit share
the AUX cable shield as a ground path. A slight potential difference (from different chassis
ground return paths) causes 50/60 Hz + alternator-frequency noise to appear on the audio.

**Definitive fix — ground loop isolator (~$10–15):** Inline transformer-coupled passive
device between the Pi USB DAC headphone jack and the Kenwood AUX input. Breaks the
electrical path through the shield without degrading audio quality.
- Search: "ground loop isolator 3.5mm car audio" — Mpow, Besign BK01, or generic.
- Install inline: `[USB DAC] → [3.5mm male] → [GL isolator] → [3.5mm male] → [Kenwood AUX]`

**Secondary check:** Ensure the buck converter's negative input terminal and the Kenwood's
chassis ground both terminate at the same chassis bolt. Different ground points separated by
body metal create the voltage difference that drives the loop.

**What won't fix it:** A ferrite choke on the AUX cable reduces RF interference but does
not help with 50/120 Hz ground loops from the power supply. Shielded cable helps slightly
but not enough.

---

## Outstanding / possible next tasks

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
