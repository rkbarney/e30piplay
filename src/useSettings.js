import { useCallback, useEffect, useRef, useState } from 'react';

// Settings are shared across every browser showing the UI: the server
// (/api/settings, a JSON file on the Pi) is the source of truth, so a change
// made on a phone that scanned the REMOTE QR reaches the car display within a
// poll tick. localStorage is kept as a synchronous cache so bootScreen applies
// on the very first render (before any fetch resolves) and so dev without the
// API server still behaves like the old per-browser version.
const STORAGE_KEY = 's52-settings';
const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';
const POLL_MS = 4000;

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

function saveCache(next) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode / storage full — setting stays in-memory only */
  }
}

export default function useSettings() {
  const [settings, setSettings] = useState(load);
  // Count of in-flight POSTs — while one is pending, poll results are stale
  // relative to what the user just tapped, so don't apply them.
  const pendingRef = useRef(0);
  // One poll at a time: a slow response must not overlap (and lose to) a
  // fresher one fired by the next interval tick.
  const syncingRef = useRef(false);

  // CSS only (cursor: none → auto). Compositor pointer motion is labwc/libinput;
  // this toggle cannot fix a frozen USB mouse at the bench.
  useEffect(() => {
    document.body.classList.toggle('show-cursor', !!settings.showMouse);
  }, [settings.showMouse]);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      if (pendingRef.current > 0 || syncingRef.current) return;
      syncingRef.current = true;
      try {
        const res = await fetch(`${API_BASE}/api/settings`, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return; // server error / 403 — keep the local cache
        const data = await res.json();
        if (cancelled || !data.ok || pendingRef.current > 0) return;
        if (data.exists) {
          const next = { ...DEFAULTS, ...data.settings };
          saveCache(next);
          setSettings((prev) =>
            JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
        } else {
          // Server has never been seeded (first run after settings moved
          // server-side). Push this browser's existing localStorage copy up so
          // the kiosk's old settings survive the migration.
          const local = load();
          if (JSON.stringify(local) !== JSON.stringify(DEFAULTS)) {
            await fetch(`${API_BASE}/api/settings`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify(local),
            });
          }
        }
      } catch {
        /* API unreachable (dev without server) — the local cache stands */
      } finally {
        syncingRef.current = false;
      }
    };
    sync();
    const id = setInterval(sync, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const update = useCallback((patch) => {
    // Optimistic: apply + cache locally right away, then persist. If the POST
    // fails (offline dev), the local copy still works like the old behavior.
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveCache(next);
      return next;
    });
    pendingRef.current += 1;
    fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(patch),
    })
      .catch(() => {})
      .finally(() => { pendingRef.current -= 1; });
  }, []);

  return [settings, update];
}
