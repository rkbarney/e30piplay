# Always-reachable "exit CarPlay" button

**Status: Removed.** The `s52-exit-overlay.py` layer-shell overlay was retired —
the script, its `setup.sh` install, its `s52-labwc-autostart.sh` launch, and the
`gir1.2-gtklayershell-0.1` apt dependency are all gone. The return path now lives
entirely in `CarPlayReceiver.jsx`'s BACK button (and the "HAL, return to kiosk"
voice intent), which call `/api/return-to-kiosk` directly. Kept here for the
historical design rationale.

## Context

The kiosk (Chromium, showing FactoryClock/DigitalClock/SystemScreen/Games) and the
CarPlay receiver (`react-carplay` or `livi`) are separate Wayland clients of the
same `labwc` compositor. Tapping `+` focuses the receiver's AppImage window
full-screen over the kiosk (`wlrctl toplevel focus app_id:...`,
`scripts/s52-carplay-switch.sh`). The only way back is `wlrctl toplevel minimize
app_id:...`, exposed as `POST /api/return-to-kiosk` in `carplay-server.cjs`.

**The problem: nothing in the car ever calls that endpoint.**
- `src/components/CarPlayReceiver.jsx`'s BACK button (`onClick={onBack}`) only
  flips React's local `screen` state in `src/components/DisplaySwitcher.jsx`
  (`handlePlus`) — it never calls `/api/return-to-kiosk`.
- Once the receiver is focused, it covers the entire 480×640 panel (both
  `scripts/s52-carplay-config.json` and `scripts/s52-livi-config.json` render at
  the panel's full resolution). The kiosk's `−`/`+`/BACK controls are plain DOM
  buttons inside the Chromium page, which is now fully obscured. There is no
  keyboard/physical button in this build — `−`/`+` are touch-only — so there is
  no input path left for the user to trigger anything in the kiosk while
  CarPlay/LIVI has focus.
- The only documented way back today is the SSH escape hatch in README.md
  (`sudo /usr/local/bin/s52-carplay-switch.sh return`) — useless while driving.

react-carplay happened to have its own internal exit gesture that papered over
this, but LIVI (the receiver now in use, see `docs/livi-receiver-trial.md`) does
not, so the gap is now blocking. The fix should NOT depend on either upstream
Electron app having a built-in escape gesture — it must live above both Wayland
clients, independent of which one is focused.

## Approach

Use a `wlr-layer-shell` overlay surface. wlroots compositors (labwc included)
always render layer-shell `overlay`-layer surfaces on top of normal toplevels,
and such a surface can restrict its own input region to just its own pixels
(touches outside it pass through untouched to whichever app is focused below).
This requires no changes to either upstream Electron app and works identically
regardless of which receiver (`react-carplay` or `livi`) is configured.

1. **New tiny overlay client** — `scripts/s52-exit-overlay.py` (new file): a
   single-file Python script using `PyGObject` (`gi.repository.Gtk`) +
   `gtk-layer-shell` (apt package `gir1.2-gtklayershell-0.1`, plus `python3-gi`
   which is already a dependency for LIVI per `scripts/s52-install-livi.sh`).
   - One small, mostly-transparent button (e.g. "⌂" or "HOME") anchored
     **top-center** (`GtkLayerShell.Edge.TOP`, no left/right anchor, small top
     margin). This placement is clear of the kiosk's own content: every screen
     (`FactoryClock`, `DigitalClock`, `SystemScreen`, `Games`) renders its
     content centered in a fixed 320×480 box via `src/components/ScreenFrame.jsx`,
     with its own `−`/`+`/action buttons pinned to the bottom band — the top
     strip is always empty.
   - `layer=overlay`, `keyboard-interactivity=none`. The input region should be
     limited to the button's own rect so taps anywhere else pass through to the
     focused app below (verify this is GTK layer-shell's default behavior for a
     normally-sized widget, not a full-surface grab).
   - On tap: `POST http://127.0.0.1:3001/api/return-to-kiosk` (loopback — same
     port `carplay-server.cjs` already listens on per `setup.sh`'s
     `s52-carplay.service` unit). This reuses the existing receiver-aware
     `wlrctl minimize` logic in `returnToKiosk()` (`carplay-server.cjs`, ~line 96)
     and `scripts/s52-carplay-switch.sh` — no new sudoers entries needed.
   - Follow the existing repo convention of a descriptive header comment
     explaining *why*, matching the style of `scripts/s52-carplay-switch.sh` and
     `scripts/s52-labwc-autostart.sh`.

2. **Autostart wiring** — launch the overlay as a fourth sibling Wayland client
   in `scripts/s52-labwc-autostart.sh`, alongside swaybg / Chromium kiosk /
   CarPlay receiver, started early so it's visible from boot. It does NOT need
   an entry in `scripts/s52-labwc-rc.xml`'s `windowRules` — those only apply to
   xdg-toplevels (`react-carplay` / `dev.f-io.livi`), and a layer-shell surface
   is a different surface type entirely, so it won't be auto-iconified.

3. **Fix `src/components/CarPlayReceiver.jsx`'s BACK button** to also call
   `/api/return-to-kiosk` directly (via `fetch`, same pattern already used in
   that file for `/api/launch-react-carplay` and `/api/relaunch-react-carplay`),
   instead of only flipping local React state via the `onBack` prop. This keeps
   the in-kiosk BACK button correct standalone and in sync with the new overlay
   button's behavior.

4. **`setup.sh`** — install the new apt dependency (`gir1.2-gtklayershell-0.1`;
   `python3-gi` is likely already present from the LIVI install path, but add it
   defensively if not already in the apt install list), `install -m 755` the new
   `scripts/s52-exit-overlay.py` to `~/.local/bin/` next to the other kiosk
   scripts (follow the pattern at the existing
   `install -m 755 "$SOURCE_DIR/scripts/s52-kiosk-inner.sh" ...` line), and
   ensure `scripts/s52-labwc-autostart.sh` (already reinstalled unconditionally
   by `setup.sh`) starts it.

5. **Docs** — update `README.md`'s "CarPlay integration status" section: the
   "SSH escape hatch" line should mention the new on-screen overlay as the
   primary return path, with SSH noted as a fallback. Also update the "Open
   integration items" section of `docs/livi-receiver-trial.md` to note the
   window-focus/return-path item is resolved by this overlay (since it doesn't
   depend on `app_id` or receiver choice).

## Key files

| Purpose | File |
|---|---|
| New always-on-top overlay client | `scripts/s52-exit-overlay.py` (new) |
| Boot autostart — add 4th client | `scripts/s52-labwc-autostart.sh` |
| Fix BACK button to call the API | `src/components/CarPlayReceiver.jsx` |
| Existing return-to-kiosk endpoint (reused, do not change behavior) | `carplay-server.cjs` (`returnToKiosk`, ~line 96; `/api/return-to-kiosk` route ~line 384) |
| Existing focus/minimize bridge (reused, do not change behavior) | `scripts/s52-carplay-switch.sh` |
| Install overlay deps + script | `setup.sh` |
| Docs: escape hatch + trial open item | `README.md`, `docs/livi-receiver-trial.md` |

## Verification

- This repo has no test suite for hardware-dependent behavior; at minimum run
  `npm run lint` and `npm run build` after the `CarPlayReceiver.jsx` change, and
  `python3 -m py_compile scripts/s52-exit-overlay.py` to check the new script's
  syntax.
- Real verification (tapping the overlay while LIVI/react-carplay has focus on
  the actual Pi + labwc session, confirming `wlrctl toplevel list` shows the
  kiosk's Chromium toplevel focused afterward, and confirming the overlay never
  blocks taps on any of the four clock/game screens' own controls) must happen
  on the physical Pi hardware and cannot be done in CI.
