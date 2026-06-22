# Carlinkit dongle — connection fix & reference

Wireless CarPlay path: **iPhone → dongle (BT + 5 GHz WiFi) → Pi USB → react-carplay**.

Vendor docs are wrong about the config IP; this file is the source of truth for this
build (AutoKit **A15W**, AP **`AutoKit-2041`**, fw **`2025.10.15.1127`**).

---

## Fix — "searching for phone" / CarPlay won't connect

Apply **in order**. Do **not** revert Pi code or the AppImage to fix a wedged dongle.

| Step | Action | Why |
|------|--------|-----|
| 1 | **`usb_max_current_enable=1`** in `/boot/firmware/config.txt` | Dongle drops off USB when video ramps. Often lost after `s52-boot-branding.sh revert`. `vcgencmd get_config int \| grep usb_max` → `=1`. **Reboot** after change. |
| 2 | **`wifiType: "5ghz"`** matches dongle **`wifi5GSwitch: 1`** | Band mismatch → stuck on "searching for phone". Repo: `scripts/s52-carplay-config.json` → `bash scripts/s52-apply-carplay-config.sh` on the Pi. |
| 3 | **5 GHz channel → 149** in dongle web UI | Default ch 36 congested at the bench. Channel sticks (unlike `mediaDelay`). Dongle on a **charger**, join `AutoKit-2041`, open **`http://192.168.43.1`**. |
| 4 | **Personal Hotspot OFF** on the phone; no Pi hotspot profiles | Hotspot shares the phone WiFi radio with wireless CarPlay. |
| 5 | **Restart react-carplay** after changes | `for p in $(pgrep -x react-carplay); do kill -9 "$p"; done` — autostart respawns in ~3 s. Use **RESTART CARPLAY** in the UI (`pkill -x`, not `pkill -f squashfs-root/…`). |
| 6 | **Foreground CarPlay** (optional) | `curl -s -X POST http://127.0.0.1/api/launch-react-carplay` |

**Verify:**

```bash
ssh s52 'vcgencmd get_config int | grep usb_max; \
  python3 -c "import json; c=json.load(open(\"/home/admin/.config/react-carplay/config.json\")); print(c.get(\"wifiType\"), c.get(\"mediaDelay\"))"; \
  curl -s http://127.0.0.1/api/carplay-ready; lsusb -d 1314:1520'
```

Expect `usb_max_current_enable=1`, `5ghz 2000`, `{"ready":true}`, dongle `1314:1520`.

**Notes:**

- Phone USB into the dongle still uses **wireless** CarPlay (`wifi: 1` in renderer logs).
- **`needActive: 1`** is normal after factory reset — re-pair with phone **internet ON**.
- **`Failed to init microphone`** in renderer console is benign.
- Switching to **2.4 GHz** did not fix this unit; keep **5 GHz + channel 149** first.

---

## Symptoms

| Screen | Meaning | Fix |
|--------|---------|-----|
| **searching for dongle** | Pi↔dongle USB session stale | Restart react-carplay (step 5) |
| **searching for phone** | Dongle up; phone↔dongle link not completing | Steps 2–4; factory reset if wedged |
| Loops at **`wifi avail`** in renderer | BT ok; 5 GHz session never finishes | Band match + channel 149 + hotspot off |

**Failure signatures (renderer console via CDP — see below):**

- **USB drop:** `dmesg` `usb … USB disconnect` + `No such device (19)` → step 1.
- **WiFi stall:** `wifi avail, phone type: CarPlay wifi: 1` but no video → steps 2–4.

---

## Dongle web UI

1. Power dongle from a **USB charger** (not Pi/Mac — host mode hides the config AP).
2. Join WiFi **`AutoKit-2041`**, password **`12345678`**.
3. Browser: **`http://192.168.43.1`** (not `192.168.50.2` on this unit).
4. **iPhone:** turn **Cellular Data OFF** so Safari uses the dongle AP.

**Factory reset:** Settings → Reset in web UI, or hold dongle button ~15 s. Clears pairings;
`needActive` returns to `1` until re-paired with internet.

**Remote dongle power-cycle** (confirm USB port via `dmesg`, e.g. `3-2`):

```bash
echo 0 | sudo tee /sys/bus/usb/devices/3-2/authorized; sleep 4; echo 1 | sudo tee /sys/bus/usb/devices/3-2/authorized
```

Then restart react-carplay.

---

## Pi config (react-carplay)

Runtime: `~/.config/react-carplay/config.json`. **Repo source of truth:**
`scripts/s52-carplay-config.json` (dpi, resolution, `wifiType`, `mediaDelay`).
Apply on the Pi: `bash scripts/s52-apply-carplay-config.sh`.

| Setting | This build | Notes |
|---------|------------|-------|
| `wifiType` | `"5ghz"` | Must match dongle `wifi5GSwitch: 1` |
| `mediaDelay` | `2000` | Overwritten on connect from AppImage patch; dongle UI alone does not stick |
| `dpi` | `220` | 165 is tiny on the 2.8″ Waveshare |

---

## Renderer debugging (handshake logs)

`/tmp/react-carplay.log` is mostly Electron noise. Real CarPlay logs are in the **renderer**
console. Add to `~/.config/labwc/autostart` launcher (after `--no-sandbox`):

`--remote-debugging-port=9223 --remote-debugging-address=127.0.0.1`

Attach via `http://127.0.0.1:9223/json/list` (CDP `Log.enable` + `Runtime.enable`).

**After a drive:** `ssh s52 '~/.local/bin/s52-drive-report.sh'`

---

## Signed CGI API (`cmd=infos`, etc.)

`POST http://192.168.43.1/cgi-bin/server.cgi`, multipart form, MD5-signed:

```
fields["ts"] = ms since epoch
joined = "&".join sorted k=v (excludes sign)
fields["sign"] = md5(joined + "HweL*@M@JEYUnvPw9G36MVB9X6u@2qxK")
```

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
    return json.loads(urllib.request.urlopen(req,timeout=8).read())
print(call("infos"))
```

**Useful `Settings` keys:** `wifi5GSwitch` (1=5G), `wifiChannel` (5G: 36,40,44,48,149,157,161),
`mediaDelay`. **`mediaDelay`** is pushed by react-carplay on connect; **`wifiChannel`** is not.

Example snapshot: [`carlinkit-dongle-infos.snapshot.json`](carlinkit-dongle-infos.snapshot.json).

---

## This unit

| Field | Value |
|-------|-------|
| Product | A15W (`YMA0-WN16-0003`) |
| Firmware | `2025.10.15.1127` |
| AP / BT name | `AutoKit-2041` |
| MAC | `00:e0:4c:67:06:7c` |
| USB | `1314:1520` (Magic Communication Tec. Auto Box) |
