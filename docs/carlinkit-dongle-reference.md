# Carlinkit / AutoKit dongle — config API & reference

Hard-won reference for the wireless-CarPlay dongle used in this build. Captured
2026-06-20 by querying the dongle's own web config directly. Keep this — the
vendor docs are wrong about the IP and there is no public API doc.

---

## ⭐ THE FIX — "CarPlay won't connect" (read this first)

On 2026-06-20 CarPlay died ("searching for dongle" → "searching for phone"). A
day was lost reverting code. **The code was never the problem.** The actual
causes and the fix that worked, in order:

1. **It is almost never the Pi code or the AppImage.** They were byte-identical
   to a known-good day. Do NOT revert/redeploy code to "fix" a dead dongle.
2. **Band mismatch.** The Pi's `~/.config/react-carplay/config.json`
   `wifiType` MUST equal the dongle's `wifi5GSwitch` (5 GHz ↔ `1`). A mismatch
   sticks the screen on **"searching for phone"**. This dongle wants **5 GHz**,
   so `wifiType: "5ghz"`. After changing it, restart the app (see below).
3. **Wedged dongle / stale pairings → factory reset the dongle** (its web UI at
   `http://192.168.43.1`, or hold its button ~15 s). This clears the scrambled
   wireless state from the phone-hotspot incident.
4. **`needActive: 1` after a reset** — re-pair the iPhone with its **internet ON**
   so the box reactivates against `paplink.cn`.
5. **Restart react-carplay** (don't reboot — a cold boot re-arms the USB
   enumeration race):
   ```bash
   ssh s52eth 'for p in $(pgrep -x react-carplay); do kill -9 "$p"; done'   # respawns in ~3s
   ```
6. **Force CarPlay to the foreground without touching the screen:**
   ```bash
   ssh s52eth 'curl -s -X POST http://127.0.0.1/api/launch-react-carplay'    # {"ok":true}
   ```

Verify it grabbed the dongle: `curl http://127.0.0.1/api/carplay-ready` →
`{"ready":true}` and `lsusb -t | grep "Vendor Specific"` shows `Driver=usbfs`.

> The phone-hotspot feature is what scrambled the dongle's 5 GHz radio in the
> first place — it shares the WiFi band with wireless CarPlay. Keep it disabled.

---

## This unit's identity (from `cmd=infos` → `BoxInfo`)

| Field | Value |
|---|---|
| Product type | `A15W` (boxType `YA`, logFileSuffix `YA15W`) |
| Hardware ver | `YMA0-WN16-0003` |
| Firmware ver | `2025.10.15.1127` (cgiVer `Sep 5 2025 11:05:47`) — **latest as of 2026-06** |
| AP name (BT + WiFi) | `AutoKit-2041` |
| MAC / AP BSSID | `00:e0:4c:67:06:7c` |
| uuid | `68e2bdc9132669d7e4fa521cb7089fa2` |
| Update image | `A15W_Update.img` |
| Vendor backend | `paplink.cn` (`api.paplink.cn`, `file.paplink.cn`, `cgi.paplink.cn`) |

## Reaching the config page

1. **Power the dongle from a dumb USB charger / power bank** (NOT a host). When
   plugged into the Pi or a Mac it acts as a CarPlay adapter, not a joinable
   config AP. Powered-only = it broadcasts its AP and serves the web UI.
2. Join WiFi **`AutoKit-2041`** (may show as `AutoKit_****` / `Carlinkit_****`),
   password **`12345678`**. "No internet" warning is expected — stay on it.
3. Config page: **`http://192.168.43.1`** (this unit hands out the
   `192.168.43.x` subnet — the vendor's documented `192.168.50.2` does NOT work
   here). Find the real IP from the DHCP lease, don't guess:
   ```bash
   ipconfig getifaddr en0                                    # your IP (e.g. 192.168.43.100)
   ipconfig getpacket en0 | grep -E 'server_identifier|router'  # the dongle = .1
   ```

### Gotchas (each cost real time)
- **`ping` is useless** — the dongle blocks ICMP but serves HTTP. A failed ping
  ≠ no config page. Always just open the browser.
- **Don't ping your own `.100/.101`** — that's the Mac, not the dongle.
- **From a phone, turn Cellular Data OFF** to reach the page (a no-internet AP
  makes iOS route the browser over cellular). A laptop is easier.
- **For activation / pairing, the opposite is true** — leave the phone's
  internet ON so the dongle can reactivate (see `needActive` below).

## The signed CGI API

All calls: `POST http://192.168.43.1/cgi-bin/server.cgi`, `multipart/form-data`.
Every request is **signed**:

```
fields["ts"]  = milliseconds (Date.now())
joined        = "&".join("k=v" for k in sorted(fields))     # excludes the sign itself
fields["sign"]= md5( joined + "HweL*@M@JEYUnvPw9G36MVB9X6u@2qxK" )   # hex
```

Working reader (no deps):

```python
import hashlib, time, urllib.request, json
BASE="http://192.168.43.1/cgi-bin/server.cgi"
SALT="HweL*@M@JEYUnvPw9G36MVB9X6u@2qxK"
def call(cmd, extra=None):
    f={"cmd":cmd,"ts":str(int(time.time()*1000))}
    if extra: f.update(extra)
    joined="&".join(f"{k}={f[k]}" for k in sorted(f))
    f["sign"]=hashlib.md5((joined+SALT).encode()).hexdigest()
    b="----b8f3"+hashlib.md5(joined.encode()).hexdigest()[:8]
    body=b"".join(f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode() for k,v in f.items())+f"--{b}--\r\n".encode()
    req=urllib.request.Request(BASE,data=body,headers={"Content-Type":f"multipart/form-data; boundary={b}"})
    return urllib.request.urlopen(req,timeout=8).read().decode("utf-8","replace")
print(json.loads(call("infos")))
```

### Known commands (`cmd=`)
| cmd | purpose |
|---|---|
| `infos` | full state: BoxInfo, Settings, DevList, WifiChannelList (works freely) |
| `carInfo` | car/head-unit info — **403 unless a car/HU is actively connected** |
| `set` | change a setting: add `item=<key>` + `val=<value>` |
| `get` | read a setting (item/val form) |
| `syncTime` | push time to the box |
| `a` | **activation** (params `is`, `code`, `burnType`, `tabId`) — used by `/act` |
| `appLogFile` / `sdkLogFile` | download logs (blob) |

### Settings keys (`Settings` in `infos`; set via `cmd=set item=<key> val=<n>`)
| key | meaning | notes |
|---|---|---|
| `wifi5GSwitch` | **WiFi band: `1`=5 GHz, `0`=2.4 GHz** | UI: "Used to select 2.4G/5G WiFi. If other 5G interference in the car, try 2.4G." |
| `wifiChannel` | channel id (see WifiChannelList) | `36`=5180MHz(5G); `1-7`=2.4G |
| `mediaDelay` | audio buffer (ms) | higher = fewer dropouts, more latency; this unit at `2000` |
| `startDelay` | startup delay | |
| `autoConn` | auto-connect last phone | `1` on |
| `autoPlay` | auto-resume media | |
| `mediaSound` | media sound mode | |
| `CallQuality` | call audio quality | |
| `bitRate` | video bit rate | |
| `backRecording` | background recording | |
| `naviVolume` / `displaySize` / `ScreenDPI` / `Udisk` | nav vol / display style / dpi / U-disk | |

WifiChannelList (this firmware): 2.4G ids 1-7 (2412–2442 MHz); 5G ids 36,40,44,48 (5180–5240) and 149,157,161 (5745–5805).

### SPA routes
`/` HomePage · `/index` · `/settings` · `/devices` (paired list) · `/act`
(activation) · `/infoPage` · `/helpPage` · `/feedback`. App is Vue
(`/js/PublicV2.*.js` + `chunk-vendors`), langs under `/lang/`.

## `needActive` — the activation gotcha

`BoxInfo.needActive: 1` means the box is **not activated** (license check vs
`paplink.cn`). **A factory reset wipes activation**, so after a reset it shows
`1` again. It reactivates automatically once it can reach the internet — which
it does through the **connected phone's** internet on the next successful pair
(so keep the phone's cellular/WiFi internet ON when re-pairing). The `/act`
page / `cmd=a` drives it manually.

## Factory reset

- **Web UI:** Settings page → "Reset". Clears `DevList` (paired phones) and
  resets settings; the box reboots (watch `upTime` drop to ~0). Verify via
  `cmd=infos`: `DevList: []` + low `upTime` = reset took.
- **Hardware:** hold the dongle's button ~15 s until the LED flashes/reboots.
- Both also reset `needActive` to `1` (see above).

## Relationship to the Pi (react-carplay)

The Pi's runtime app config lives at `~/.config/react-carplay/config.json`, but
**the source of truth in this repo is [`scripts/s52-carplay-config.json`](../scripts/s52-carplay-config.json)** —
the one place to set CarPlay **dpi (font/UI size)**, **resolution**, **band**, and
**media buffer**. `scripts/s52-apply-carplay-config.sh` (run by `setup.sh`) merges
it into the runtime config and restarts CarPlay. To change the on-screen font size:
edit `dpi` there (165 = tiny on the 2.8″, **220 = current**), then on the Pi run
`bash scripts/s52-apply-carplay-config.sh`.

The **`wifiType`** (`"5ghz"` / `"2.4ghz"`) that node-carplay sends to the dongle
**must match the dongle's `wifi5GSwitch`** — a mismatch leaves the screen stuck on
"searching for phone" (the band the app commands ≠ the band the box advertises).
This dongle defaults to **5 GHz** (`wifi5GSwitch: 1`), so keep `wifiType: "5ghz"`.

Restart the app after a config change (the labwc autostart runs a
`while true; react-carplay; sleep 3` loop, so it respawns ~3 s after a kill):
```bash
for p in $(pgrep -x react-carplay); do kill -9 "$p"; done   # kill by PID, not pkill -f
```
(`pkill -f squashfs-root/react-carplay` also matches your own SSH command line
and kills the session — use the PID form above.)

## Symptom decode
- **"searching for dongle"** = Pi↔dongle USB/session not establishing (app
  holding a stale handle after a boot-time re-enumeration; restart the app).
- **"searching for phone"** = dongle session up, phone↔dongle wireless link not
  completing (band mismatch, phone not pairing, or `needActive`).

## Live snapshot (2026-06-20, after factory reset + re-pair)
```json
{
  "BoxInfo": {"ver":"2025.10.15.1127","productType":"A15W","mac":"00:e0:4c:67:06:7c",
              "wifi":"AutoKit-2041","needActive":1},
  "Settings": {"wifi5GSwitch":1,"wifiChannel":36,"mediaDelay":2000,"autoConn":1},
  "DevList": [{"id":"F4:52:93:BE:3C:4E","type":"CarPlay","name":"rkbarney’s main"}]
}
```
