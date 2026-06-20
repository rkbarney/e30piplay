# Shopping List — S52 Solutions E30 Display

## Already Ordered / Have

- ✅ Raspberry Pi 5 (8GB)
- ✅ Official Pi 5 case with fan
- ✅ Carlinkit Wireless CarPlay dongle (USB)
- ✅ USB to 3.5mm audio DAC
- ✅ 3.5mm AUX cable (DAC → Kenwood head unit)

---

## Still Needed

### Critical — won't work without these


| Item                                                 | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ **Waveshare 2.8" HDMI Capacitive Touch** (480×640) | Installed. HDMI = 60fps CarPlay.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **MicroSD card — 32GB+ A2 rated**                    | SanDisk Extreme or Samsung Pro Endurance. A2 rating matters for Pi boot speed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Short USB-A cables ×2 (~6")**                      | Carlinkit dongle + audio DAC to Pi USB ports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **3.5mm PC microphone (for CarPlay phone calls)**    | Needed for call/Siri **uplink** — the other side can't hear you without a Pi-side mic. **Uses no extra USB port:** plug into the **mic-in jack of the existing C-Media/Unitek USB audio adapter** (it does speaker-out *and* mic-in on one port; its USB descriptor confirms a real biased Microphone input). Must be a **PC mic with a TRS/TS plug** ("for computer / PC mic jack"). **Avoid 4-ring TRRS smartphone lavs** — they mis-mate with a dedicated PC mic jack (dead silent, the exact failure we hit). Search: **"3.5mm computer microphone"**, **"3.5mm lavalier microphone for PC"** (best car fit — clip near visor), or "mini 3.5mm electret PC mic". $5–15 at Best Buy/Walmart/Target/Staples. **Do NOT reuse the Kenwood car mic** — see note below. |


### Power

**Solderless throughout — no soldering required.**


| Item                                                                         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~25W buck converter (12/24V → 5V/5A)~~ → **replaced by supercap UPS below** | The plain buck is what causes the crank brown-out (it drops out as the 12V sags during cranking). Superseded — keep the buck only as a spare.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ✅ **Fockety Super Capacitor UPS for RPi** (DC 9–24V in → 5V/3A out, 4S)      | **CHOSEN + ORDERED. Fixes "Pi won't auto-boot after engine crank" — see HANDOFF issue #1.** On the E30 nothing is *cut* during crank — the Pi browns out on the voltage *sag*. A supercap UPS bridges the sag directly: its caps hold 5V through the dip — no battery, no charge-timing. Replaces the plain buck (remove the buck). Feed from the existing switched-ignition (terminal 15 / purple accessory) tap — no fuse change. **Pre-check the board's 5V output connector** (USB-A / barrel / bare screw terminal) and get a matching cable to the Pi USB-C rated **≥4A** (may need USB-A→USB-C or a USB-C PD-trigger breakout). Chosen over a lithium UPS (Geekworm X1200) to avoid Li-ion heat/longevity risk in a hot cabin — we only bridge a few seconds of crank sag, not a real outage. |
| ✅ **Chanzon 1.5KE24A TVS diode** (DO-201AD axial, unidirectional, 24V/1500W) | **Input-side** load-dump protection — the E30 has no modern load-dump suppression. **Solderless:** clamp across the Fockety `DC_IN` screw terminals — banded (cathode) lead alongside the 12V wire, other (anode) lead alongside the GND wire.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ✅ **P6KE6.8A TVS diode** (DO-15 axial, unidirectional, 6.8V/600W)            | **Output-side** protection. Clamp across the Fockety `DC_OUT` screw terminals — banded (cathode) lead alongside the 5V wire to the Pi, other lead alongside GND. Insurance against a reviewed failure mode where the regulator drifts to ~5.4V after ~15 startups; keeps that off the Pi. **Trim all diode leads short after clamping.**                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Add-a-Circuit fuse tap (ATO/ATC) + 5A fuse**                               | **The no-solder way to get switched 12V.** Plugs into a switched (ACC) slot in the car's fuse box and gives a fused, switched +12V lead — no cutting or soldering the harness. Search: "add-a-circuit fuse tap ATO".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ✅ **Solderless wire connectors** (have a 2-pair set)                         | Any solid solderless connector works — brand doesn't matter. Use to join the buck's input leads to the fuse-tap lead + a ground ring, and as the **disconnect point** when pulling the unit. For car vibration, prefer locking/lever types; just make sure they grip tight.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Ring terminal (crimp-on or Posi) for ground**                              | Ground to a clean chassis bolt. Solderless ring terminals push/screw on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Phone charging: separate 12V→USB-C PD car charger** *(optional)*           | If you want a MagSafe/Qi mag charger in the car, power it from its **own** 12V→USB-C **PD** module off the same fuse tap — **not** from the Pi. See "Phone charging" note below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Arduino power** *(optional — personal add-on)*                             | Only if you have the oil-pressure Arduino gauge (not part of the standard build). **No buck, no solder** — plug it into a Pi USB port (or the hub) with a normal USB cable; it's standalone and only needs 5V.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ✅ **Acer 4-port USB-A 3.0 hub** (have)                                       | Plugs into a Pi USB-A port; its USB-C jack is optional 5V power injection (probably won't need it). **USB 3.0 caution:** USB3 hubs radiate ~2.4 GHz noise that can degrade the **Carlinkit's wireless link to the phone** (its AP runs on 2.4 GHz). Plug the **Carlinkit straight into a Pi port** (ideally a USB-2 port) and keep it physically away from the hub; hang the slower devices (audio, Arduino) off the hub instead.                                                                                                                                                                                                                                                                                                                                                                    |


### Installation


| Item                                       | Notes                                                                                                                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **USB-C right-angle adapter**              | Cleaner cable routing from supercap UPS into Pi                                                                                                                                                                                                              |
| **Short USB extension (~6–12")** *(optional)* | Lets the **Carlinkit dongle body sit farther from the Pi** and its USB3 ports while staying on a direct Pi port — reduces 2.4 GHz / USB3 proximity interference (see HANDOFF issue #2). Keep the dongle away from the USB3 hub too.                         |
| **VHB double-sided tape or velcro strips** | Mounting Pi 5 behind dash panel                                                                                                                                                                                                                              |
| **Split loom tubing + small cable ties**   | Wire management behind dash                                                                                                                                                                                                                                  |


---

## Optional


| Item                             | Notes                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Spare MicroSD card (32GB+)**   | Clone a working image once setup is done — instant recovery if card fails                            |
| **USB-A hub (compact, powered)** | Useful during setup if you need keyboard + dongle + DAC simultaneously. Not needed for final install |


---

## What You Don't Need

- ~~Micro HDMI to HDMI cable~~ — included with the OSOYOO display
- ~~SPI display driver setup~~ — HDMI is plug and play
- ~~Separate USB touch cable~~ — the OSOYOO capacitive touch runs over USB, likely included
- ~~Reusing the Kenwood head-unit mic~~ — **won't transfer.** Car head-unit mics are matched to that unit's specific bias voltage, impedance, and plug wiring. Tested into a USB audio adapter's mic-in (a real biased Microphone input per its USB descriptor) it read **dead silent (0.3% FS)** on both a Pi and a Mac, while it works fine in the Kenwood. "Mic input" is not a universal standard. Use a USB mic instead (above). A MacBook 3.5mm jack can't validate these mics either — it only reads 4-pole CTIA headset plugs.

---

## Power Wiring Diagram (solderless)

```
Car switched-ignition source (terminal 15 / purple accessory wire — or ACC fuse slot)
  │   (stays live through crank on the E30; voltage just sags)
  [Add-a-Circuit fuse tap + 5A fuse]   ←── fused switched 12V, no solder (if tapping fuse box)
  │
  [Posi-Tap / Posi-Lock]   ←── join point + disconnect for unit removal
  │           └──[ground ring → chassis bolt]
  │
  [Fockety supercap UPS  9–24V in → 5V/3A out, 4S]   ←── bridges the crank sag (NOT a plain buck)
  │     ├─[TVS 1.5KE24A across DC_IN]    ←── input-side load-dump clamp
  │     └─[TVS P6KE6.8A across DC_OUT]   ←── output-side regulator-drift clamp
  │
  [USB-C cable / pigtail, rated ≥4A]
  │
  [Raspberry Pi 5 USB-C power port]
        │
        ├─[USB] 2.8" touchscreen      (video over HDMI; power over USB)
        ├─[USB, direct] Carlinkit dongle   ←── NOT through the USB3 hub; keep body away from Pi USB3 ports / hub (2.4GHz noise)
        │
        └─[USB3 hub] ─┬─[USB] USB audio adapter ──► Kenwood AUX-in (out) + PC mic (in)
                      └─[USB] Arduino oil-pressure gauge   (optional personal add-on)
```

- **Switched-ignition only** — never the constant/yellow 12V (that would drain
the battery while parked). On a switched feed, parked draw is essentially zero.
- **One supercap UPS** (replaces the old 25W buck — its caps bridge the crank
sag; see HANDOFF issue #1). The Arduino rides a Pi USB port, so its old 15W
buck is dropped — fewer parts, no extra tap.
- **Solderless:** fuse tap / Posi connectors, and both TVS diodes clamp straight
into the Fockety `DC_IN`/`DC_OUT` screw terminals (trim leads short). The Posi
join is also your unplug point when removing the unit.
- **Pi needs `usb_max_current_enable=1`** (set in `setup.sh`) since the supercap
UPS has no USB-PD handshake; without it the Pi caps USB current and warns.

### Phone charging (MagSafe / Qi mag charger)

Don't run a phone charger off the Pi's USB ports:

- The Pi's USB is **5V only** — a MagSafe puck needs **9V USB-PD** for its full
15W and will trickle slowly (or not engage) at 5V.
- Phone-charging current would steal from the Pi's own power budget.

Instead, power the mag charger from its **own 12V→USB-C PD car module** off the
same fuse tap (it can then negotiate 9V for fast charging) — fully isolated
from the Pi, still solderless via a second Posi connector.
