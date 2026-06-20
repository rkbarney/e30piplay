# e30piplay — Agent Handoff

Status as of 2026-06-19. This is the orientation doc for the next agent. Read it
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



1. **Bench vs. car — the peripherals live in the car, not on the bench Pi.**
  The screen, USB audio adapter, mic, power buck, and wiring are *permanently
   mounted in the dash*. At the bench, the Pi has **only the Carlinkit dongle**
   attached.
  - Therefore, **at the bench the default audio sink is `auto_null` and there
  is no USB audio card / mic — THIS IS NORMAL, not a bug.** The saved
  `PULSE_SINK`/`PULSE_SOURCE` names re-match the real devices the moment the
  Pi is plugged back into the car harness.
  - Workflow: Pi normally lives at the bench for development; bring it to the
  car (driveway) to test the full install.
2. **Network reachability is location-dependent.** The Pi only joins home WiFi
  (`biscuit`) when it's in range (bench, or car in the driveway). Out on the
   road it is unreachable — expect SSH to hang/`255` then. Don't interpret that
   as a broken Pi.
3. **The Pi 5 has hard hardware limits that shaped the design:**
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


| Path                                      | What                                                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `~/e30piplay/`                            | git checkout of this repo (APP_DIR). `carplay-server.cjs` runs from here.                                                         |
| `~/apps/squashfs-root/`                   | extracted `react-carplay` AppImage; launcher `~/.local/bin/react-carplay`.                                                        |
| `~/.config/labwc/autostart`               | session autostart (from `scripts/s52-labwc-autostart.sh`): swaybg + Chromium kiosk + react-carplay launch loop.                   |
| `~/.config/s52-carplay-audio.env`         | **audio routing** — `PULSE_SINK` (AUX adapter), `PULSE_SOURCE` (lavalier mic), `ALSA_CARD`. Sourced by the autostart. Not in git. |
| `/var/www/s52-display/`                   | built kiosk UI served by nginx (port 80).                                                                                         |
| `/boot/firmware/config.txt`               | has managed block: `display_rotate=1`, `usb_max_current_enable=1`.                                                                |
| `/etc/systemd/system/s52-carplay.service` | the `/api` server (port 3001, `User=admin`, `XDG_RUNTIME_DIR` set).                                                               |
| `s52-cage-kiosk.service`                  | the labwc kiosk (Chromium + preloaded react-carplay).                                                                             |


### In the repo


| Path                                        | What                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `setup.sh`                                  | full provisioning (packages, services, nginx, config.txt, scripts).                                             |
| `carplay-server.cjs`                        | tiny HTTP API behind nginx `/api/`*: `/api/carplay-ready`, `/api/launch-react-carplay`, `/api/return-to-kiosk`. |
| `src/`                                      | Vite + React (JSX) kiosk UI. Entry: `main.jsx` → `App.jsx` → `components/DisplaySwitcher.jsx`.                  |
| `scripts/s52-labwc-autostart.sh`            | the session autostart (Mesa/Vulkan workarounds + audio env sourcing + relaunch loop).                           |
| `scripts/install-react-carplay-appimage.sh` | downloads + patches the AppImage (`show:true`, media-access).                                                   |
| `SHOPPING_LIST.md`                          | hardware + solderless power wiring plan/diagram.                                                                |


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

### In-UI update from GitHub (no SSH)

The **System** face (cycle the `−` button past the clocks) shows the current
build and an **INSTALL** button when `origin` is ahead. It calls
`POST /api/update` → `scripts/s52-update.sh` (runs as the kiosk user:
`git pull --ff-only` → `npm ci` → `npm run build`) → `sudo -n
/usr/local/bin/s52-deploy.sh` (rsync to `/var/www` + restart `s52-carplay`).
The UI then reloads itself (Vite hash-named assets), so `s52-cage-kiosk` is **not**
restarted.

- Needs internet (home wifi when parked). **Phone hotspot auto-connect is
  rolled back** — it conflicted with wireless CarPlay (see issue #6).
- **Refuses to run if the working tree is dirty.** The Pi has known local mods
  (see the caveat above), so resolve those over SSH first or the button reports
  the dirty tree and changes nothing.
- The only privileged piece is `s52-deploy.sh`, allow-listed in
  `/etc/sudoers.d/s52-carplay-launcher` (same pattern as `s52-carplay-switch.sh`).

### Phone hotspot (internet on the road) — **rolled back**

**Do not use `s52-add-hotspot.sh` yet.** In-car testing showed Personal Hotspot
on the phone conflicts with wireless CarPlay (same WiFi radio) — disconnects and
audio skips. The Pi must not auto-join the phone hotspot while CarPlay is active.

**Remove an existing hotspot profile on the Pi:**

```bash
ssh s52 'bash -s' < scripts/s52-remove-hotspot.sh
```

That deletes every NetworkManager wifi profile except `biscuit` (override with
`S52_HOME_CONN` if your home SSID differs). Credentials are only in NM on the
Pi — removing the profile clears them.

**Future (issue #6):** reintroduce hotspot only on demand — e.g. when the user
starts a GitHub OTA update from the System screen, not as always-on
autoconnect. Until then, use home wifi (`biscuit`) for OTA/SSH when parked.

<details>
<summary>Original add-hotspot approach (disabled)</summary>

```bash
# DO NOT RUN until issue #6 is fixed:
ssh s52 'bash -s' "<SSID>" "<PASSWORD>" < scripts/s52-add-hotspot.sh
```

</details>

---

## Boot flow

1. Pi boots → labwc kiosk session (`s52-cage-kiosk`).
2. `~/.config/labwc/autostart`: swaybg solid-black wallpaper layer → Chromium
   kiosk (the React UI at `http://localhost`) → background `react-carplay`
   AppImage (iconified until the user taps `+`).
3. **UI boot timeline (redesigned 2026-06-19):** the React app goes *straight*
   to a large spinning BMW roundel — the old "S52 Solutions" ASCII terminal boot
   screen was removed entirely (`BootScreen.jsx` is gone). The roundel screen's
   background is **white** so the unavoidable Chromium/Wayland startup white flash
   blends in (also nicer as a night light); the screen flips to **black** the
   moment the clock face (or CarPlay) mounts. The roundel spins in fast,
   decelerates, settles (~3 s), then cross-fades into the FactoryClock (~5.2 s
   total — see `LogoIntro.jsx`).
   - The roundel image (`public/BMW-Logo-1970-1989.png`) is 16:9 with the actual
     roundel in wide transparent side margins, so `objectFit: contain` rendered it
     small. `LogoIntro.jsx` uses `objectFit: cover` at 318px to crop the empty
     margins and fill the screen edge-to-edge.
   - The roundel's center is lifted by `translateY(-42px)` to sit exactly on the
     clock face's center (the FactoryClock centers SVG + gap + buttons as a flex
     column, so its face center is 42px above screen center), so there's no jump
     on the logo→clock transition.
4. `s52-carplay` API comes up; the UI polls `/api/carplay-ready` and shows the
  `+` button when the AppImage is a live Wayland toplevel.
5. Tapping `+` focuses react-carplay (via `wlrctl`); `−` cycles clock faces.
   All three clock faces (FactoryClock, DigitalClock, AnalogClock) now have
   bigger, touch-friendly `−/+` buttons; the analog faces (FactoryClock,
   AnalogClock) were made bolder/more defined and scaled to near the full screen
   width.

**Local preview (no Pi needed):** `docker compose up --build` builds the kiosk UI
and serves it at <http://localhost:8080> (see `docker-compose.yml` +
`docker/web/Dockerfile`) — handy for eyeballing the boot/clock UI on the Mac.

---

## History / gotchas (why things are the way they are)

- **Mesa 25.0.7 GBM regression** crashed react-carplay's GPU process. Fix in
`s52-labwc-autostart.sh`: force software GL (`LIBGL_ALWAYS_SOFTWARE=1`,
`GALLIUM_DRIVER=llvmpipe`) and `--disable-features=Vulkan,WebGPU`. Opt back
into hardware with `S52_CARPLAY_GPU=1` once Mesa is fixed upstream.
- **AppImage patches** (`install-react-carplay-appimage.sh`): `show:false`→`true`
(window never mapped on Wayland otherwise), an `askForMediaAccess` shim, and
**`mediaDelay: 300`→`2000` ms** in bundled node-carplay defaults (see issue #2
interference trial — dongle web UI alone does not stick).
- `**usb_max_current_enable=1`** in `config.txt`: the 25 W buck is a "dumb" 5 V
source (no USB-PD), so without this the Pi caps USB current / warns.
- **ALSA output unmute (fixed):** the C-Media card's real playback control is
`**Speaker`** (controls present: `Speaker`, `Mic`, `Auto Gain Control`) — not
the `PCM`/`Extension Unit` the autostart historically targeted. The autostart
now explicitly runs `amixer ... sset Speaker 100% unmute` (best-effort,
alongside the legacy `PCM`/`Extension Unit` calls) on every react-carplay
(re)launch, so the analog output can't come up muted.
- **Invisible mouse at the bench:** a live-only systemd drop-in
  `s52-cage-kiosk.service.d/cursor.conf` with `XCURSOR_THEME=blank` /
  `XCURSOR_SIZE=1` hides the pointer entirely — worse than `unclutter`.
  Remove it (`sudo rm …/cursor.conf && sudo systemctl restart s52-cage-kiosk`).
  `setup.sh` now deletes that file; in-car hiding uses autostart `unclutter`
  only when a touchscreen is detected.

---

## Known issues & their fixes (post-install)

### 1. Pi 5 does not auto-boot after engine crank (needs PWR button press)

**Root cause (revised 2026-06-19 — E30-specific wiring).** Earlier notes assumed the car
*cuts* accessory power during crank. BMW's documented E30 wiring shows it does **not**: the
ignition barrel's green wire (terminal 15) is live in *run and start*, and the purple/violet
accessory wire is live in *all* key positions including start — nothing is switched off going
from "run" to "start." So the Pi isn't losing a clean cut; it's **browning out on the cranking
voltage sag** (the battery dips while the starter pulls hundreds of amps), possibly plus a brief
make-before-break gap as the key passes through the start detent. The 25 W buck holds just enough
5 V to keep the PMIC (DA9091) alive but not the SoC, so the board lands in a "was running, now
stalled" state waiting for the PWR button instead of cold-booting on the restored 5 V.

**Implication: relocating to a different fuse will NOT fix this.** Every switched circuit on the
E30 sags the same during crank. The fix has to make the 12 → 5 V stage immune to the dip.

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

**Fix — supercap UPS + TVS diodes (CHOSEN & ORDERED 2026-06-19; install pending).**
Replace the plain buck *entirely* with a supercapacitor UPS that bridges the crank sag directly
(its caps hold 5 V through the dip), and clamp transients with a TVS diode on each side. No
battery, no button, no charge-timing — just continuous 5 V. Feed it from the existing
switched-ignition tap (no fuse change — every switched circuit sags equally, so relocating
wouldn't help):

```
switched-ignition tap (purple accessory wire / terminal 15)
   ├─[TVS 1.5KE24A across DC_IN]        ←── input-side load-dump clamp
   └─► [Fockety supercap UPS  9–24V in → 5V/3A out, 4S] ─► Pi 5 USB-C (≥4A cable)
          └─[TVS P6KE6.8A across DC_OUT] ←── output-side, clamps regulator drift
```

**Goal:** fix Pi 5 not auto-booting after engine crank. Root cause: plain buck converter browns
out during crank voltage sag, leaving Pi 5 PMIC in a state that needs manual PWR button press.
Fix: replace buck with supercap UPS (rides through sag) + add TVS diodes for transient
protection on both sides.

**Parts (all ordered):**
1. **Fockety Super Capacitor UPS for RPi** — DC 9–24 V in, DC 5 V/3 A out, 4S model
2. **Chanzon 1.5KE24A TVS diode** (DO-201AD, axial, unidirectional, 24 V/1500 W) — input-side
   protection
3. **P6KE6.8A TVS diode** (DO-15, axial, unidirectional, 6.8 V/600 W) — output-side protection

**Pre-install**
- [ ] Confirm Fockety board's 5 V output connector type (USB-A vs barrel vs bare screw terminal)
      and get the matching cable to the Pi 5 USB-C port — may need a USB-A-to-USB-C cable or a
      separate USB-C PD trigger breakout depending on what's on the board
- [ ] Disconnect battery negative before working in the dash (standard safety)

**Remove**
- [ ] Remove old plain 25 W buck converter from the circuit entirely — it's being replaced, not
      supplemented

**Install — power chain**
- [ ] Existing switched-ignition tap (purple accessory wire) → Fockety DC_IN terminal (no fuse
      relocation needed — confirmed sag affects all switched circuits equally, not
      circuit-specific)
- [ ] Fockety DC_OUT (5 V) → Pi 5 USB-C power in (4 A-rated cable/connector)
- [ ] Common ground: Fockety GND ties to same chassis ground as the ignition tap reference

**Install — TVS diodes (screw terminal clamp, no soldering needed)**

*Input side (1.5KE24A, load-dump protection):*
- [ ] Loosen DC_IN + screw terminal, insert diode's banded lead (cathode) alongside the existing
      12 V wire, tighten
- [ ] Loosen DC_IN GND screw terminal, insert diode's other lead (anode) alongside existing GND
      wire, tighten

*Output side (P6KE6.8A, regulator-drift protection):*
- [ ] Loosen DC_OUT + screw terminal, insert diode's banded lead (cathode) alongside the 5 V wire
      to the Pi, tighten
- [ ] Loosen DC_OUT GND screw terminal, insert diode's other lead (anode) alongside GND wire,
      tighten

- [ ] Trim/bend all diode leads short after clamping — no bare wire should be able to touch
      anything else once buttoned up in the dash

**Post-install testing**
- [ ] Key to ON/ACC, engine off — confirm Pi auto-boots (should already work)
- [ ] Crank engine — confirm Pi stays powered through crank and does **not** require manual PWR
      button press afterward
- [ ] Repeat crank test several times (cold start, warm start) to confirm consistency
- [ ] Check vcgencmd throttle/volts log (already set up from earlier diagnostics) to confirm clean
      5 V across crank events — not just "Pi survived" but "Pi never saw a brownout at all"
- [ ] Monitor Fockety output voltage periodically over first few weeks (multimeter on DC_OUT) —
      watch for any drift toward 5.4 V+ given the review describing exactly that failure mode
      after ~15 startups; the P6KE6.8A should clamp it, but worth confirming it's not silently
      clamping/dissipating on every cycle

**Notes / rationale (for future reference)**
- EEPROM `POWER_OFF_ON_HALT` already ruled out and removed — confirmed irrelevant to this issue
- E30 wiring confirmed terminal 15 and accessory circuits stay live through START position — power
  is not cut during crank, it sags
- Went with supercap over buck-boost: bridges the sag directly rather than depending on a
  converter's input floor surviving an uncertain dip depth
- Went with supercap over lithium UPS: avoids thermal/longevity risk of Li-ion cells sitting in a
  hot, unmanaged car cabin; didn't need the extra runtime capacity lithium would provide since
  we're only bridging a few seconds of crank sag, not a real power outage
- Output-side TVS added specifically because of a user review reporting the Fockety board's
  regulator drifting to 5.4 V output after ~15 startup cycles — cheap insurance against that
  exact failure mode reaching the Pi

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

**Physical layout note:** Carlinkit is plugged directly into the Pi (currently in the glove
box, close to the Pi and its USB3 ports). The USB3 hub is in the HVAC area — slower devices
(audio DAC, optional Arduino) hang off the hub instead. **USB3 ports and hubs radiate ~2.4 GHz
noise** that can interfere with the Carlinkit's wireless link to the phone (its AP runs on
2.4 GHz) — keep the dongle away from Pi USB3 ports and the hub when possible (see current
trial below).

**c) Dongle firmware reboot-loop (new finding — 2026-06-19, leading suspect for any
*remaining* media cutouts):** Bench investigation of the Carlinkit "Auto Box"
(`idVendor=1314 idProduct=1520`, USB port `1-2`) showed it **re-enumerating on a
metronomic ~13 s loop** — device numbers climbing steadily — with **zero USB errors,
zero under-voltage/throttle events, and zero PipeWire xruns**. A clean
disconnect/reconnect cadence with no bus errors is the signature of the **dongle's own
firmware reboot-looping**, i.e. the CarPlay *source* dropping out. That points the finger
at the dongle itself — **not** buffering/quantum, **not** power, **not** the AUX cable,
and **not** the USB DAC output.
- **Bluetooth would not fix this** — it's the wrong layer. The dropout is source-side
  (the dongle losing the phone/CarPlay link), so switching the *output* path to BT
  changes nothing. BT remains removed and **not recommended** (see "Do NOT").
- **CAVEAT — confirm in-car before acting:** this was measured at the bench with **no
  phone paired**, and these dongles are known to idle-reboot when no phone is connected.
  So the ~13 s loop may be a benign no-phone idle behaviour, not the in-car fault. Before
  buying a replacement dongle, **confirm in the car with a phone actively streaming**
  using the flight recorder below — drive, then run the report and check the dongle
  re-enumeration count vs. USB/power/audio events.

#### Current trial (2026-06-19) — interference hypothesis

**Prior findings (context):**
- Bench sessions showed the Carlinkit dongle re-enumerating on a metronomic ~13 s loop (issue
  **c** above) — may be benign no-phone idle behaviour, not the in-car fault.
- In-car symptom that drove this pivot: **audio-only skips** (~1 s gaps) while **CarPlay maps
  stay up** — i.e. not full Pi reboots and not a complete CarPlay disconnect from the user's
  perspective.
- Dongle is on Pi USB port **`1-2`**, plugged **direct** (not through the USB3 hub). Physical
  port colour (black USB2 vs blue USB3) on the Pi 5 board was **not confirmed** in logs — worth
  noting on the next bench check.
- Earlier same-day logs also showed Pi reboot clusters that looked like power events; those may
  have been bench deploy restarts after returning home, not in-drive faults. Treat power (issue
  **#1**) and interference as **separate tracks**.

**Current hypothesis:** remaining media cutouts are **RF/USB proximity interference** — the
dongle sitting in the glove box near the Pi (and its USB3 ports) degrading the Carlinkit's 2.4
GHz wireless link or its USB stability, producing brief audio gaps without killing the video
surface.

**What we're trying now:**
1. **Carlinkit playback delay → 2000 ms** — buffers more audio ahead of brief
   wireless/USB hiccups. **Do not rely on the Carlinkit companion/web UI for
   this:** node-carplay sends `SendBoxSettings` (including `mediaDelay`) on
   every connect with its bundled default **300 ms**, which overwrites whatever
   you set in the dongle UI after reboot. The host-side fix is in
   `scripts/install-react-carplay-appimage.sh` (patch #3): it rewrites bundled
   `DEFAULT_CONFIG` copies from 300 → **2000 ms** and merges the same value into
   `~/.config/react-carplay/config.json`. Re-run after AppImage upgrades:

   ```bash
   bash ~/e30piplay/scripts/install-react-carplay-appimage.sh
   sudo systemctl restart s52-cage-kiosk
   ```

   **Tune later (500–2000 ms typical):** set `S52_CARPLAY_MEDIA_DELAY=1500` when
   running the install script, or edit `mediaDelay` in
   `~/.config/react-carplay/config.json`, or use react-carplay → Settings →
   MEDIA DELAY (saved to the same config file). Dongle web UI is optional
   confirmation only — react-carplay wins on connect.
2. **Relocate the dongle further from the Pi** — move it out of glove-box proximity to the Pi
   and its USB3 ports; use a short USB extension if needed so the dongle body sits farther from
   the Pi board/hub radiators while staying on a direct Pi port (not through the USB3 hub).

**How to verify after the next drive:** return to WiFi range, then on the Pi (or via
`ssh s52 '~/.local/bin/s52-drive-report.sh'`) run the flight recorder report and compare
dongle re-enumerations, USB errors, under-voltage/throttle, and PipeWire xruns against the
audio skips you felt. Fewer skips with no new dongle resets ⇒ interference mitigation worked;
unchanged skips with clean logs ⇒ look downstream (AUX/DAC/PipeWire) next.

#### Drive "flight recorder" (to confirm the dongle finding in-car)

A persistent flight recorder is set up on the Pi so a real drive can be correlated
with audio stutter after the fact (the Pi is unreachable on the road — it logs to the
persistent journal and you review it once it's back in WiFi range).

- **What it logs:** `~/.local/bin/s52-drive-sampler.sh` writes a 5 s timestamped
  heartbeat to journal tag `s52-drive`, capturing the candidate stutter causes:
  latched `get_throttled` (its "has-occurred" bits latch, so a brief under-voltage sag
  while driving is caught), EXT5V + core voltage, temp, Carlinkit dongle + C-Media USB
  DAC enumeration, default PipeWire sink, and CPU load.
- **How it starts:** launched on every boot via an `admin` `@reboot` **cron** entry
  (survives reboots, **no sudo** required). A single-instance `flock` keeps it from
  double-running. An **optional sudo installer** — `scripts/s52-drive-recorder.sh` —
  installs the sampler/report into `/usr/local/bin` and replaces the cron launcher with
  a `s52-drive-recorder.service` systemd unit (`Restart=always`) if you'd rather have
  systemd own it.
- **Post-drive workflow:** drive → return to WiFi range → from the Mac run:

```bash
ssh s52 '~/.local/bin/s52-drive-report.sh'        # last 3 h (default)
# also: --since "2 hours ago" | --since "2026-06-19 14:00:00" | --boot
```

`scripts/s52-drive-report.sh` prints one timeline correlating dongle re-enumerations vs.
USB errors vs. under-voltage/throttle vs. PipeWire xruns. **Reading:** many dongle
re-enumerations + zero USB/power/audio events ⇒ source-side dongle reboot (replace/reflash
the dongle, not the output path); resets that cluster with bumps/driving instead ⇒
vibration/power. (Persistent journald + the per-boot `s52-boot` marker come from
`scripts/s52-logging-setup.sh` — run that first if it hasn't been.)

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

- **Feature backlog is tracked as GitHub issues** (`gh issue list`): phone
  hotspot (#6, **blocked** — conflicts with wireless CarPlay; use on-demand only
  when reimplemented), in-UI OTA (#7, done), GPS "Track Mode" (#8), NES/Game Boy
  emulator (#9), in-car AI (#10), USB dashcam (#11), radar/speed-trap research
  (#12). Each is self-contained — pick one at a time. OBD-II is out (the car is
  OBD1; ELM327 tooling doesn't apply).
- (Optional) Oil-pressure **Arduino**: the owner has a personal Arduino gauge
(analog oil-pressure sensor → mini LCD). Plan was to power it from a Pi USB
port (it's standalone, ~100 mA). Marked optional in `SHOPPING_LIST.md`. A
longer-term idea (read the sensor on the Pi via an I2C ADC and render a gauge
in the UI) was explicitly deferred — do not build unless asked.
- (Optional) MagSafe/Qi phone charger in the car would need its **own** 12 V→USB-C
PD module off the ACC tap — never off the Pi (5 V only). See `SHOPPING_LIST.md`.

## Do NOT

- Re-add Bluetooth audio (removed on purpose). It would *not* fix the media cutouts
  either — those are source-side (dongle), not on the AUX output path (see issue #2c).
- Pursue USB audio-out to the head unit (impossible on Pi 5 — no USB gadget).
- Commit any secrets (WiFi/sudo passwords). They live only on the Mac's
`~/.ssh/config` and the Pi's NetworkManager config.

