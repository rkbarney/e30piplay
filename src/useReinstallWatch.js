import { useState, useCallback, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';

// Polls /api/reinstall/status and exposes the live install log. The reinstall
// runs in its own systemd unit on the Pi (carplay-server startReinstall), so it
// survives setup.sh restarting both the API server and the kiosk display
// mid-run. This hook is what makes the progress *resume* after the display
// restarts: on mount it asks the server whether a reinstall is in flight and, if
// so, re-opens the overlay over whatever face Chromium reloaded to.
export default function useReinstallWatch() {
  const [state, setState] = useState('idle'); // 'idle' | 'running' | 'done' | 'failed'
  const [log, setLog] = useState('');
  const [show, setShow] = useState(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/reinstall/status`, {
        headers: { Accept: 'application/json' },
      });
      const data = await res.json();
      if (typeof data.log === 'string') setLog(data.log);
      const s = String(data.status || 'idle').split(':')[0]; // 'failed:2' → 'failed'
      const norm = (s === 'running' || s === 'done' || s === 'failed') ? s : 'idle';
      setState(norm);
      return norm;
    } catch {
      // Server is almost certainly mid-restart (setup.sh bounces s52-carplay).
      // Return null so callers keep polling instead of treating it as failure.
      return null;
    }
  }, []);

  // Auto-resume: while the overlay is hidden, slow-poll so an in-flight
  // reinstall surfaces it — whether it was kicked off from this page, started
  // out-of-band, or is still running after Chromium reloaded to the boot face
  // mid-reinstall. Stops as soon as the overlay is shown (the fast poll below
  // takes over).
  useEffect(() => {
    if (show) return undefined;
    let stopped = false;
    let timer = null;
    const tick = async () => {
      const s = await poll();
      if (stopped) return;
      if (s === 'running' || s === 'done' || s === 'failed') { setShow(true); return; }
      timer = setTimeout(tick, 4000);
    };
    tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [show, poll]);

  // While the overlay is up and work is ongoing, poll fast. Stop once we hit a
  // terminal status (the log is final then); the overlay stays until dismissed.
  useEffect(() => {
    if (!show) return undefined;
    let stopped = false;
    let timer = null;
    const tick = async () => {
      const s = await poll();
      if (stopped) return;
      if (s === 'running' || s === null) timer = setTimeout(tick, 1200);
    };
    tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [show, poll]);

  // Called by the Settings REINSTALL button once the POST has kicked off the job.
  const start = useCallback(() => {
    setLog('');
    setState('running');
    setShow(true);
  }, []);

  const dismiss = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/reinstall/ack`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
    } catch { /* best effort */ }
    setShow(false);
    setState('idle');
    setLog('');
  }, []);

  return { state, log, show, start, dismiss };
}
