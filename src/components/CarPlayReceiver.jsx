/**
 * CarPlayReceiver — hands the display to the upstream Electron react-carplay app.
 *
 * Uses the shared ScreenFrame, so it lines up with the clock/system screens.
 * Entering (via + from any face) auto-opens CarPlay (foreground). The kiosk page
 * sits *behind* the Electron window, so when you exit/force-quit CarPlay you land
 * back here — which is why both bottom buttons are ALWAYS tappable:
 *   ← BACK   → drop to the clock
 *   RESTART  → full kill+respawn (/api/relaunch), the reliable kick for a stalled
 *              "searching for phone" handshake.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import ScreenFrame from './ScreenFrame';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';

export default function CarPlayReceiver({ onBack }) {
  const [phase, setPhase] = useState('opening'); // opening | idle | restarting
  const [err, setErr] = useState('');
  const openedRef = useRef(false);

  const call = useCallback(async (path, working) => {
    setErr('');
    setPhase(working);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setErr(data.detail || data.error || `HTTP ${res.status}`);
    } catch (e) {
      setErr(e.message || 'Request failed — needs the Pi build (nginx + carplay-server).');
    } finally {
      setPhase('idle');
    }
  }, []);

  const openCarplay = useCallback(() => call('/api/launch-react-carplay', 'opening'), [call]);
  const restartCarplay = useCallback(() => call('/api/relaunch-react-carplay', 'restarting'), [call]);

  // Auto-open on first entry (the + handoff). Guard React 18 StrictMode double-run.
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    openCarplay();
  }, [openCarplay]);

  const restarting = phase === 'restarting';
  const statusLine =
    phase === 'opening' ? 'Opening CarPlay…'
      : restarting ? 'Restarting CarPlay…'
        : err ? err
          : 'CarPlay is on screen.';

  return (
    <ScreenFrame
      variant="amber"
      buttons={[
        { key: 'back', label: '← BACK', onClick: onBack },
        {
          key: 'restart',
          label: restarting ? 'RESTARTING' : 'RESTART',
          onClick: restartCarplay,
          disabled: restarting,
        },
      ]}
    >
      <div style={styles.title}>CARPLAY</div>
      <svg width="56" height="56" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <rect x="6.5" y="2.5" width="11" height="19" rx="2.2" fill="none" stroke="#ffb300" strokeWidth="1.4" />
        <line x1="9" y1="4.5" x2="15" y2="4.5" stroke="#ffb300" strokeWidth="1" opacity="0.35" />
        <circle cx="12" cy="18.5" r="1.1" fill="#ffb300" />
      </svg>
      <div style={{ ...styles.status, ...(err ? styles.statusErr : null) }}>{statusLine}</div>
      <div style={styles.hint}>Exited, or stuck on “searching for phone”? Tap RESTART.</div>
    </ScreenFrame>
  );
}

CarPlayReceiver.propTypes = {
  onBack: PropTypes.func,
};

const styles = {
  title: {
    color: '#ffb300',
    fontSize: '14px',
    fontWeight: 'bold',
    letterSpacing: '0.25em',
  },
  status: {
    color: '#cc8800',
    fontSize: '12px',
    textAlign: 'center',
    padding: '0 16px',
    lineHeight: 1.4,
  },
  statusErr: {
    color: '#ff6b6b',
    fontSize: '10px',
    wordBreak: 'break-word',
  },
  hint: {
    color: '#665533',
    fontSize: '9px',
    textAlign: 'center',
    padding: '0 20px',
    lineHeight: 1.4,
  },
};
