import { useCallback, useEffect, useState } from 'react';

// Persists in the kiosk Chromium's own profile dir (S52_CHROMIUM_USER_DATA_DIR),
// so the setting survives reboots and stays per-device — flip "Show mouse" ON
// once at the bench, it stays on for that Pi until you flip it back for the car.
const STORAGE_KEY = 's52-settings';

const DEFAULTS = {
  // Off by default: the car is the primary install and has no mouse. The old
  // approach (CSS `@media (hover: hover) and (pointer: fine)`) tried to detect
  // a mouse automatically, but Chromium's Linux/Wayland Ozone backend doesn't
  // implement that media feature reliably — it matched "fine pointer" even on
  // the touch-only car display, so the cursor never actually hid. This setting
  // replaces that guess with an explicit switch.
  showMouse: false,
  // null = use the build-time VITE_BOOT_SCREEN default.
  bootScreen: null,
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export default function useSettings() {
  const [settings, setSettings] = useState(load);

  // CSS only (cursor: none → auto). Compositor pointer motion is labwc/libinput;
  // this toggle cannot fix a frozen USB mouse at the bench.
  useEffect(() => {
    document.body.classList.toggle('show-cursor', !!settings.showMouse);
  }, [settings.showMouse]);

  const update = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* private mode / storage full — setting stays in-memory only */
      }
      return next;
    });
  }, []);

  return [settings, update];
}
