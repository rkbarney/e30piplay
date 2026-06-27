/**
 * NavitReceiver — hands the display to Navit (apt package, GTK toplevel)
 * for offline OSM turn-by-turn. Unlike CarPlayReceiver this is a regular
 * cycled face (− / + behave the same as every other face); tapping the big
 * button focuses the pre-warmed Navit window via wlrctl (see
 * scripts/s52-labwc-autostart.sh) instead of auto-opening on mount, since
 * there's no phone-handshake reason to jump straight to it.
 */

import { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import ScreenFrame from './ScreenFrame';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';

export default function NavitReceiver({ onMinus, onPlus }) {
  const [phase, setPhase] = useState('idle'); // idle | opening | restarting
  const [err, setErr] = useState('');

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

  const openNavit = useCallback(() => call('/api/launch-navit', 'opening'), [call]);
  const restartNavit = useCallback(() => call('/api/relaunch-navit', 'restarting'), [call]);

  const busy = phase === 'opening' || phase === 'restarting';
  const label =
    phase === 'opening' ? 'OPENING…' : phase === 'restarting' ? 'RESTARTING…' : 'OPEN\nNAVIGATION';

  return (
    <ScreenFrame
      variant="mono"
      buttons={[{ key: 'minus', label: '−', onClick: onMinus }, { key: 'plus', label: '+', onClick: onPlus }]}
    >
      <div style={styles.title}>NAVIGATION</div>
      <button
        type="button"
        style={{ ...styles.bigBtn, ...(busy ? styles.bigBtnBusy : null) }}
        onClick={openNavit}
        onDoubleClick={restartNavit}
        disabled={busy}
      >
        {label}
      </button>
      {err
        ? <div style={styles.err}>{err}</div>
        : <div style={styles.hint}>Tap to open. Double-tap to restart if stuck.</div>}
    </ScreenFrame>
  );
}

NavitReceiver.propTypes = {
  onMinus: PropTypes.func,
  onPlus: PropTypes.func,
};

const styles = {
  title: {
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 'bold',
    letterSpacing: '0.25em',
    fontFamily: "'Courier New', monospace",
  },
  bigBtn: {
    width: '288px',
    height: '288px',
    borderRadius: '16px',
    border: '3px solid #888888',
    background: 'linear-gradient(180deg, #3a3a3a 0%, #1a1a1a 100%)',
    color: '#ffffff',
    fontFamily: "'Courier New', monospace",
    fontSize: '26px',
    fontWeight: 'bold',
    letterSpacing: '0.08em',
    lineHeight: 1.2,
    whiteSpace: 'pre-line',
    boxShadow: '0 4px 24px rgba(255, 255, 255, 0.08)',
    WebkitTapHighlightColor: 'transparent',
    cursor: 'pointer',
  },
  bigBtnBusy: {
    opacity: 0.7,
    cursor: 'wait',
    fontSize: '22px',
  },
  hint: {
    color: '#888888',
    fontSize: '9px',
    textAlign: 'center',
    padding: '0 20px',
    lineHeight: 1.4,
    fontFamily: "'Courier New', monospace",
  },
  err: {
    color: '#ff6b6b',
    fontSize: '10px',
    textAlign: 'center',
    padding: '0 16px',
    wordBreak: 'break-word',
    fontFamily: "'Courier New', monospace",
  },
};
