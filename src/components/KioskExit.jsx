import { useCallback, useState } from 'react';

const EXIT_URL = 'http://127.0.0.1:8765/exit';

function kioskExitAvailable() {
  if (typeof window === 'undefined') return false;
  const { hostname } = window.location;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export default function KioskExit() {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState(null);

  const requestExit = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(EXIT_URL, { method: 'POST' });
      if (!r.ok && r.status !== 204) setErr(`HTTP ${r.status}`);
    } catch (e) {
      setErr('Could not reach exit helper (kiosk script not running?)');
    }
  }, []);

  if (!kioskExitAvailable()) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Exit kiosk"
        onClick={() => setOpen(true)}
        style={styles.hit}
      >
        exit
      </button>
      {open && (
        <div style={styles.overlay} role="dialog" aria-modal="true">
          <div style={styles.card}>
            <p style={styles.prompt}>Close kiosk browser?</p>
            {err && <p style={styles.err}>{err}</p>}
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
