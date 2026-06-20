# Shopping List — S52 Solutions E30 Display

## Already Ordered / Have
- ✅ Raspberry Pi 5 (8GB)
- ✅ Official Pi 5 case with fan
- ✅ Carlinkit Wireless CarPlay dongle (USB)
- ✅ USB to 3.5mm audio DAC
- ✅ 3.5mm AUX cable (DAC → Kenwood head unit)
- ~~Hosyond 3.5" SPI touchscreen~~ → replaced by OSOYOO below

---

## Still Needed

### Critical — won't work without these

| Item | Notes |
|---|---|
| **OSOYOO 3.5" HDMI Capacitive Touch** (480×320) | Replaces Hosyond. HDMI = 60fps CarPlay. Micro HDMI cable included. ASIN: B0DRF9Q566 |
| **MicroSD card — 32GB+ A2 rated** | SanDisk Extreme or Samsung Pro Endurance. A2 rating matters for Pi boot speed |
| **Short USB-A cables ×2 (~6")** | Carlinkit dongle + audio DAC to Pi USB ports |
| **3.5mm PC microphone (for CarPlay phone calls)** | Needed for call/Siri **uplink** — the other side can't hear you without a Pi-side mic. **Uses no extra USB port:** plug into the **mic-in jack of the existing C-Media/Unitek USB audio adapter** (it does speaker-out *and* mic-in on one port; its USB descriptor confirms a real biased Microphone input). Must be a **PC mic with a TRS/TS plug** ("for computer / PC mic jack"). **Avoid 4-ring TRRS smartphone lavs** — they mis-mate with a dedicated PC mic jack (dead silent, the exact failure we hit). Search: **"3.5mm computer microphone"**, **"3.5mm lavalier microphone for PC"** (best car fit — clip near visor), or "mini 3.5mm electret PC mic". $5–15 at Best Buy/Walmart/Target/Staples. **Do NOT reuse the Kenwood car mic** — see note below. |

### Power

**Solderless throughout — no soldering required.**

| Item | Notes |
|---|---|
| ✅ **25W buck converter (12/24V in → 5V/5A out, USB-C)** | **Have it.** Dedicated to the Pi — correct spec for a Pi 5 + peripherals. Note: it outputs "dumb" 5V (no USB-PD), so the Pi needs `usb_max_current_enable=1` in `config.txt` to use the full 5A (already set by `setup.sh`). |
| **Add-a-Circuit fuse tap (ATO/ATC) + 5A fuse** | **The no-solder way to get switched 12V.** Plugs into a switched (ACC) slot in the car's fuse box and gives a fused, switched +12V lead — no cutting or soldering the harness. Search: "add-a-circuit fuse tap ATO". |
| ✅ **Solderless wire connectors** (have a 2-pair set) | Any solid solderless connector works — brand doesn't matter. Use to join the buck's input leads to the fuse-tap lead + a ground ring, and as the **disconnect point** when pulling the unit. For car vibration, prefer locking/lever types; just make sure they grip tight. |
| **Ring terminal (crimp-on or Posi) for ground** | Ground to a clean chassis bolt. Solderless ring terminals push/screw on. |
| **Phone charging: separate 12V→USB-C PD car charger** *(optional)* | If you want a MagSafe/Qi mag charger in the car, power it from its **own** 12V→USB-C **PD** module off the same fuse tap — **not** from the Pi. See "Phone charging" note below. |
| **Arduino power** *(optional — personal add-on)* | Only if you have the oil-pressure Arduino gauge (not part of the standard build). **No buck, no solder** — plug it into a Pi USB port (or the hub) with a normal USB cable; it's standalone and only needs 5V. |
| ✅ **Acer 4-port USB-A 3.0 hub** (have) | Plugs into a Pi USB-A port; its USB-C jack is optional 5V power injection (probably won't need it). **USB 3.0 caution:** USB3 hubs radiate ~2.4 GHz noise that can degrade the **Carlinkit's wireless link to the phone** (its AP runs on 2.4 GHz). Plug the **Carlinkit straight into a Pi port** (ideally a USB-2 port) and keep it physically away from the hub; hang the slower devices (audio, Arduino) off the hub instead. |

### Installation

| Item | Notes |
|---|---|
| **USB-C right-angle adapter** | Cleaner cable routing from buck converter into Pi |
| **VHB double-sided tape or velcro strips** | Mounting Pi 5 behind dash panel |
| **Split loom tubing + small cable ties** | Wire management behind dash |

---

## Optional

| Item | Notes |
|---|---|
| **Spare MicroSD card (32GB+)** | Clone a working image once setup is done — instant recovery if card fails |
| **USB-A hub (compact, powered)** | Useful during setup if you need keyboard + dongle + DAC simultaneously. Not needed for final install |

### GPS (Track Mode feature)

The Track Mode screen needs a USB GPS puck connected to the Pi. It works with
any u-blox 7/8 or MTK3339-based puck — see `scripts/99-gps.rules` for the
full supported list. Recommendations in order of preference:

| Item | Notes |
| ---- | ----- |
| **GlobalSat BU-353-S4** (SiRFstar IV) | Best-in-class sensitivity for the price (~$30 on Amazon). USB, plug-and-play on Pi OS, 1 Hz default. **Top pick for reliability.** |
| **u-blox VK-172 "USB GPS" puck** (~$15–20) | Most common budget pick; u-blox 7 chipset (VID 1546:01a7). 1 Hz out of the box; can be reconfigured to 5–10 Hz with u-center or `ubxtool`. Tiny thumb-drive form factor — easy to tuck behind the dash. |
| **Adafruit Ultimate GPS Breakout** (PA6H / MTK3339) with USB adapter | 10 Hz capable, excellent sensitivity, good Python/gpsd community support. Requires a USB-Serial adapter (CP2102 or FTDI); add ~$5. |
| **u-blox M8N module on a USB-Serial board** (~$10–15) | u-blox 8 (VID 1546:01a8/01a9); configurable up to 10 Hz. Search "NEO-M8N GPS USB module". Best for smooth g-force derivation due to higher update rate. |

**Notes:**
- Any USB GPS that exposes a standard NMEA serial port will work. The udev rule
  in `scripts/99-gps.rules` creates `/dev/gps0` automatically for all four chip
  families above.
- Mount with a clear sky view — even a small suction-cup window mount gives
  dramatically better signal than tucked behind the dash.
- 10 Hz models improve the 0–60 timer accuracy and g-force smoothness; 1 Hz is
  fine for speed display and drive logging.

---

## What You Don't Need

- ~~Micro HDMI to HDMI cable~~ — included with the OSOYOO display
- ~~SPI display driver setup~~ — HDMI is plug and play
- ~~Separate USB touch cable~~ — the OSOYOO capacitive touch runs over USB, likely included
- ~~Reusing the Kenwood head-unit mic~~ — **won't transfer.** Car head-unit mics are matched to that unit's specific bias voltage, impedance, and plug wiring. Tested into a USB audio adapter's mic-in (a real biased Microphone input per its USB descriptor) it read **dead silent (0.3% FS)** on both a Pi and a Mac, while it works fine in the Kenwood. "Mic input" is not a universal standard. Use a USB mic instead (above). A MacBook 3.5mm jack can't validate these mics either — it only reads 4-pole CTIA headset plugs.

---

## Power Wiring Diagram (solderless)

```
Car fuse box — switched (ACC) slot
  │
  [Add-a-Circuit fuse tap + 5A fuse]   ←── fused switched 12V, no solder
  │
  [Posi-Tap / Posi-Lock]   ←── join point + disconnect for unit removal
  │           └──[ground ring → chassis bolt]
  │
  [25W buck  12/24V → 5V/5A]
  │
  [USB-C cable]
  │
  [Raspberry Pi 5 USB-C power port]
        │
        ├─[USB] 2.8" touchscreen      (video over HDMI; power over USB)
        ├─[USB, direct] Carlinkit dongle   ←── NOT through the USB3 hub (2.4GHz noise)
        │
        └─[USB3 hub] ─┬─[USB] USB audio adapter ──► Kenwood AUX-in (out) + PC mic (in)
                      └─[USB] Arduino oil-pressure gauge   (optional personal add-on)
```

- **Switched ACC only** — never the constant/yellow 12V (that would drain the
  battery while parked). On ACC, parked draw is essentially zero.
- **One buck** (the Pi's 25W). The Arduino now rides a Pi USB port, so its old
  15W buck is dropped — fewer parts, no extra tap.
- **Solderless:** fuse tap at the fuse box + Posi connectors. The Posi join is
  also your unplug point when removing the unit.
- **Pi needs `usb_max_current_enable=1`** (set in `setup.sh`) since the 5A buck
  has no USB-PD handshake; without it the Pi caps USB current and warns.

### Phone charging (MagSafe / Qi mag charger)

Don't run a phone charger off the Pi's USB ports:
- The Pi's USB is **5V only** — a MagSafe puck needs **9V USB-PD** for its full
  15W and will trickle slowly (or not engage) at 5V.
- Phone-charging current would steal from the Pi's own power budget.

Instead, power the mag charger from its **own 12V→USB-C PD car module** off the
same fuse tap (it can then negotiate 9V for fast charging) — fully isolated
from the Pi, still solderless via a second Posi connector.
