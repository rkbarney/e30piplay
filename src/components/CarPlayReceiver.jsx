/**
 * CarPlayReceiver — hands the display to the upstream Electron react-carplay app.
 *
 * Entering (via + from any face) auto-opens CarPlay (foreground). The kiosk page
 * sits *behind* the Electron window, so when you exit/force-quit CarPlay you land
 * back here. Two clear paths, both always tappable:
 *   • the big RESTART CARPLAY button (content) — full kill+respawn (/api/relaunch),
 *     the reliable kick for a stalled "searching for phone" handshake.
 *   • BACK (full-width button below) — calls /api/return-to-kiosk to minimize the
 *     receiver's Wayland toplevel, then drops the local view to the clock. Note
 *     this button is only reachable once the kiosk has focus; while the receiver
 *     covers the panel full-screen, the return paths are the "HAL, return to
 *     kiosk" voice intent or the SSH escape hatch
 *     (sudo /usr/local/bin/s52-carplay-switch.sh return).
 */

import { useState, useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';
import ScreenFrame from './ScreenFrame';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';

export default function CarPlayReceiver({ onBack }) {
  const [phase, setPhase] = useState('opening'); // opening | idle | restarting
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

  const openCarplay = useCallback(() => call('/api/launch-react-carplay', 'opening'), [call]);
  const restartCarplay = useCallback(() => call('/api/relaunch-react-carplay', 'restarting'), [call]);

  // Minimize the receiver before returning to the clock. Failures are non-fatal
  // (e.g. user already exited LIVI and the Wayland toplevel is gone).
  const handleBack = useCallback(async (e) => {
    e?.stopPropagation?.();
    try {
      await fetch(`${API_BASE}/api/return-to-kiosk`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
    } catch {
      /* still return to the clock face */
    }
    onBack?.(e);
  }, [onBack]);

  // Auto-open on first entry (+ / HAL voice handoff). Wait two animation frames so
  // the carplay face is painted before wlrctl focus — otherwise LIVI can de-iconify
  // over the previous face at a partial geometry (HAL voice path hit this).
  useEffect(() => {
    let cancelled = false;
    let outerId = 0;
    let innerId = 0;
    outerId = requestAnimationFrame(() => {
      innerId = requestAnimationFrame(() => {
        if (!cancelled) openCarplay();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outerId);
      cancelAnimationFrame(innerId);
    };
  }, [openCarplay]);

  const busy = phase === 'opening' || phase === 'restarting';
  const label =
    phase === 'opening' ? 'OPENING…' : phase === 'restarting' ? 'RESTARTING…' : 'RESTART\nCARPLAY';

  return (
    <ScreenFrame
      variant="amber"
      buttons={[{ key: 'back', label: 'BACK', onClick: handleBack }]}
    >
      <div style={styles.title}>CARPLAY</div>
      <button
        type="button"
        style={{ ...styles.bigBtn, ...(busy ? styles.bigBtnBusy : null) }}
        onClick={restartCarplay}
        disabled={busy}
      >
        {label}
      </button>
      {err
        ? <div style={styles.err}>{err}</div>
        : <div style={styles.hint}>Exited, or stuck on “searching for phone”? Tap to restart.</div>}
    </ScreenFrame>
  );
}

CarPlayReceiver.propTypes = {
  onBack: PropTypes.func,
};

const styles = {
  title: {
    color: '#ffb300',
    fontSize: '13px',
    fontWeight: 'bold',
    letterSpacing: '0.25em',
    fontFamily: "'Courier New', monospace",
  },
  // Clock-sized primary action.
  bigBtn: {
    width: '288px',
    height: '288px',
    borderRadius: '16px',
    border: '3px solid #ffdd77',
    background: 'linear-gradient(180deg, #ffc940 0%, #e6a000 100%)',
    color: '#1a1200',
    fontFamily: "'Courier New', monospace",
    fontSize: '30px',
    fontWeight: 'bold',
    letterSpacing: '0.08em',
    lineHeight: 1.2,
    whiteSpace: 'pre-line',
    boxShadow: '0 4px 24px rgba(255, 179, 0, 0.30)',
    WebkitTapHighlightColor: 'transparent',
    cursor: 'pointer',
  },
  bigBtnBusy: {
    opacity: 0.7,
    cursor: 'wait',
    fontSize: '24px',
  },
  hint: {
    color: '#665533',
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
