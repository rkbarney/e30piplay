# Organic Maps — offline navigation face

The `maps` face (ORGANIC MAPS) hands the display to [Organic
Maps](https://organicmaps.app/) — Flatpak `app.organicmaps.desktop`, a Qt app
rendering modern OSM vector tiles. Integration shape is identical to the CarPlay
receiver: a pre-warmed labwc client, focused on demand via `wlrctl`.

## How it's wired

- Receiver UI: `src/components/MapsReceiver.jsx` — tap to open, double-tap to restart
- Face: `'maps'` in `FACES` (`src/components/DisplaySwitcher.jsx`), reached via `−`
- Server: `carplay-server.cjs` — `/api/launch-maps`, `/api/relaunch-maps`,
  `/api/return-maps-to-kiosk`, `/api/maps-ready`. Restart uses `flatpak kill`
  (a sandboxed app can't be `pkill`'d by process name).
- Pre-warm: `scripts/s52-labwc-autostart.sh` runs `flatpak run
  app.organicmaps.desktop` in a respawn loop, iconified at boot
- Iconify rule: `scripts/s52-labwc-rc.xml` windowRule on `app.organicmaps.desktop`
- Install: `setup.sh` step `[10c]` — `flatpak` apt pkg + flathub remote +
  `flatpak install --user flathub app.organicmaps.desktop` (skip with
  `S52_SKIP_ORGANIC_MAPS=1`)

## To verify on real hardware (the unknowns)

The Linux build of Organic Maps is officially a dev/debug target — "not reached
feature parity ... not optimized for mobile." It runs on ARM64 Pi OS via
Flatpak; the open questions are about the kiosk fit, not whether it launches.

1. **app_id** — `wlrctl toplevel list` after first boot. Code assumes the
   Wayland app_id is `app.organicmaps.desktop`. If it's `OMaps`/`organicmaps`/
   something via Xwayland, set `S52_MAPS_APP_ID=...` (carplay-server) **and**
   fix the `s52-labwc-rc.xml` windowRule identifier to match — otherwise the
   pre-warmed window won't iconify and will sit on top of the kiosk at boot.
2. **Flatpak in the kiosk session** — labwc Lite has no full desktop session;
   Flatpak wants the Wayland socket (inherited via `WAYLAND_DISPLAY`, OK) and a
   session D-Bus / xdg-desktop-portal (may be absent). Confirm it launches; if
   it complains about portals, the basic map view should still work but the
   region downloader / file dialogs may not.
3. **GPU** — Organic Maps needs GL. The Pi 5 V3D path had a Mesa regression that
   forced react-carplay to llvmpipe (see `environment.md`). Watch
   `/tmp/organicmaps.log` for GL/EGL fallback or crashes.
4. **Touch + portrait** — the real question. Are the controls usable at 480×640
   by finger? Is there turn-by-turn? This is what decides whether OM stays.
5. **Map data** — install at least one region from OM's built-in downloader
   before judging (it boots to an empty globe otherwise).

## Local UI preview (Docker)

`docker compose up --build` serves the React UI on http://localhost:8080. You
can cycle to the ORGANIC MAPS face and see the receiver screen, but tapping
"OPEN MAPS" will error — there's no labwc/wlrctl/flatpak in the container, so
the map itself only runs on the Pi.
