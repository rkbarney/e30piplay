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

### Power

| Item | Notes |
|---|---|
| **12V → 5V/5A buck converter with USB-C output** | Steps down stereo ACC wire to Pi 5 voltage. Must support 5A (25W) — cheap phone chargers won't do it. Search: "12V to USB-C 5A buck converter" or "PD 25W DC-DC converter" |
| **XT30 inline connector pair (male + female)** | Solders into the 12V line for easy disconnect when removing the unit. Common in RC hobby stores (HobbyKing, Amazon). Much better than barrel jacks for this use |

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

---

## What You Don't Need

- ~~Micro HDMI to HDMI cable~~ — included with the OSOYOO display
- ~~SPI display driver setup~~ — HDMI is plug and play
- ~~Separate USB touch cable~~ — the OSOYOO capacitive touch runs over USB, likely included

---

## Power Wiring Diagram

```
Kenwood ACC 12V wire
  │
  └─[solder-heat shrink splice]
        │
        ├─[XT30 female socket]  ←── disconnect here to remove unit
        │
        [XT30 male plug]
        │
        [12V→5V/5A buck converter]
        │
        [USB-C right-angle adapter]
        │
        [Raspberry Pi 5 USB-C power port]
```

Your existing solder-heat shrink connectors handle the splice to the ACC wire.
The XT30 pair adds the unplug point. Everything downstream is low-voltage DC.
