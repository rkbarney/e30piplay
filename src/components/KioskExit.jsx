import { useCallback, useState } from 'react';

const DEFAULT_EXIT_PORT = 8765;

function getExitUrl() {
  if (typeof window === 'undefined') return `http://127.0.0.1:${DEFAULT_EXIT_PORT}/exit`;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('s52ExitPort');
  const parsed = Number(raw);
  const port = Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
    ? parsed
    : DEFAULT_EXIT_PORT;
  return `http://127.0.0.1:${port}/exit`;
}

function kioskExitAvailable() {
  if (typeof window === 'undefined') return false;
  // Hide during Vite dev — Pi kiosk uses a production build + localhost helper.
  if (import.meta.env.DEV) return false;
  const { hostname } = window.location;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export default function KioskExit() {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState(null);
  const [errSoft, setErrSoft] = useState(false);

  const requestExit = useCallback(async () => {
    setErr(null);
    setErrSoft(false);
    try {
      const r = await fetch(getExitUrl(), { method: 'POST' });
      if (!r.ok && r.status !== 204) setErr(`HTTP ${r.status}`);
    } catch {
      setErrSoft(true);
      setErr(
        'No kiosk exit helper on port 8765 — normal when previewing on Mac or Docker. Close this tab instead. On the Pi, the kiosk launcher starts s52-kiosk-exit-server.py with Chromium.',
      );
    }
  }, []);

  if (!kioskExitAvailable()) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Exit kiosk"
        onClick={() => {
          setErr(null);
          setErrSoft(false);
          setOpen(true);
        }}
        style={styles.hit}
      >
        exit
      </button>
      {open && (
        <div style={styles.overlay} role="dialog" aria-modal="true">
          <div style={styles.card}>
            <p style={styles.prompt}>Close kiosk browser?</p>
            {err && <p style={errSoft ? styles.hint : styles.err}>{err}</p>}
            <div style={styles.row}>
              <button type="button" style={styles.no} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" style={styles.yes} onClick={requestExit}>
                Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const styles = {
  hit: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    zIndex: 10000,
    padding: '4px 6px',
    fontFamily: 'inherit',
    fontSize: 10,
    lineHeight: 1,
    color: '#7a5500',
    background: 'rgba(0,0,0,0.45)',
    border: '1px solid #3a2800',
    borderRadius: 2,
    cursor: 'pointer',
    textTransform: 'lowercase',
    opacity: 0.85,
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    zIndex: 10001,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 260,
    padding: 14,
    background: '#0a0a0a',
    border: '1px solid #3a2800',
    color: '#ffb300',
    fontFamily: 'inherit',
  },
  prompt: { marginBottom: 12, fontSize: 13 },
  err: { color: '#ff3333', fontSize: 11, marginBottom: 10 },
  hint: { color: '#cc9900', fontSize: 11, marginBottom: 10, lineHeight: 1.35 },
  row: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  no: {
    padding: '8px 14px',
    fontFamily: 'inherit',
    fontSize: 12,
    background: '#1a1a1a',
    border: '1px solid #3a2800',
    color: '#ffb300',
    cursor: 'pointer',
  },
  yes: {
    padding: '8px 14px',
    fontFamily: 'inherit',
    fontSize: 12,
    background: '#2e1f00',
    border: '1px solid #ffb300',
    color: '#ffb300',
    cursor: 'pointer',
  },
};
