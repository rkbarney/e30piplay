/**
 * CarPlayReceiver — hands the display to the upstream Electron react-carplay app.
 *
 * Entering (via + from any clock face) auto-opens CarPlay (foreground). The kiosk
 * page sits *behind* the Electron window, so when you exit/force-quit CarPlay you
 * land back here — which is why both controls are ALWAYS tappable:
 *   • BACK            → drop to the clock
 *   • RESTART CARPLAY → full kill+respawn of the AppImage (/api/relaunch), the
 *                       reliable kick when the phone link stalls on "searching".
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

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
  const label =
    phase === 'opening' ? 'OPENING…' : restarting ? 'RESTARTING…' : 'RESTART\nCARPLAY';

  return (
    <div style={styles.root}>
      <div style={styles.statusBar}>
        <div style={styles.statusLeft}>
          {typeof onBack === 'function' && (
            <button type="button" style={{ ...styles.backBtn, ...styles.backBtnLarge }} onClick={onBack}>
              ← BACK
            </button>
          )}
        </div>
        <span style={styles.mode}>CARPLAY</span>
      </div>

      <div style={styles.main}>
        <button
          type="button"
          style={{ ...styles.reconnectBtn, ...(restarting ? styles.reconnectBtnBusy : null) }}
          onClick={restartCarplay}
          disabled={restarting}
        >
          {label}
        </button>
        {err ? <div style={styles.error}>{err}</div> : null}
        <div style={styles.hint}>
          CarPlay should be on screen. Exited, or stuck on “searching for phone”? Tap RESTART CARPLAY.
        </div>
      </div>

      <div style={styles.footer}>
        <span style={styles.footerLeft}>CARLINKIT WIRELESS</span>
        <span style={styles.footerRight}>{restarting ? 'RESTARTING…' : err ? 'ERROR' : 'READY'}</span>
      </div>
    </div>
  );
}

CarPlayReceiver.propTypes = {
  onBack: PropTypes.func,
};

const styles = {
  root: {
    width: '320px',
    height: '480px',
    background: '#000',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: "'Courier New', monospace",
    overflow: 'hidden',
    position: 'relative',
  },
  statusBar: {
    height: '28px',
    background: '#0a0a0a',
    borderBottom: '1px solid #3a2800',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 8px',
    gap: '6px',
    flexShrink: 0,
  },
  statusLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: 0,
    flex: 1,
  },
  backBtn: {
    flexShrink: 0,
    padding: '4px 10px',
    fontFamily: 'inherit',
    fontSize: '11px',
    fontWeight: 'bold',
    lineHeight: 1.2,
    color: '#ffb300',
    background: 'rgba(0,0,0,0.35)',
    border: '2px solid #7a5500',
    borderRadius: '6px',
    cursor: 'pointer',
    letterSpacing: '0.08em',
  },
  backBtnLarge: {
    padding: '10px 16px',
    fontSize: '16px',
    borderWidth: '2px',
    borderRadius: '10px',
  },
  brand: {
    color: '#ffb300',
    fontSize: '9px',
    letterSpacing: '0.2em',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  mode: {
    color: '#ffb300',
    fontSize: '9px',
    letterSpacing: '0.15em',
    flexShrink: 0,
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'center',
    padding: '12px 14px 8px',
    gap: '10px',
    minHeight: 0,
  },
  iconWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
    paddingTop: '8px',
  },
  bigIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 0,
  },
  title: {
    color: '#ffb300',
    fontSize: '12px',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
  },
  col: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  step: {
    color: '#cc8800',
    fontSize: '10px',
    lineHeight: 1.28,
    textAlign: 'center',
  },
  primaryBtn: {
    marginTop: '4px',
    padding: '10px 12px',
    fontFamily: 'inherit',
    fontSize: '11px',
    fontWeight: 'bold',
    letterSpacing: '0.08em',
    color: '#1a1200',
    background: 'linear-gradient(180deg, #ffc940 0%, #e6a000 100%)',
    border: '1px solid #ffdd77',
    borderRadius: '6px',
    cursor: 'pointer',
    alignSelf: 'stretch',
  },
  reconnectBtn: {
    flex: 1,
    minHeight: '180px',
    margin: '0 4px',
    padding: '20px 14px',
    fontFamily: 'inherit',
    fontSize: '24px',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    lineHeight: 1.15,
    whiteSpace: 'pre-line',
    color: '#1a1200',
    background: 'linear-gradient(180deg, #ffc940 0%, #e6a000 100%)',
    border: '3px solid #ffdd77',
    borderRadius: '10px',
    cursor: 'pointer',
    boxShadow: '0 4px 20px rgba(255, 179, 0, 0.3)',
  },
  reconnectBtnBusy: {
    opacity: 0.75,
    cursor: 'wait',
    fontSize: '18px',
  },
  error: {
    color: '#ff6b6b',
    fontSize: '9px',
    lineHeight: 1.35,
    borderLeft: '2px solid #662222',
    paddingLeft: '6px',
    flexShrink: 0,
  },
  hint: {
    color: '#665533',
    fontSize: '8px',
    lineHeight: 1.35,
    textAlign: 'center',
    flexShrink: 0,
  },
  footer: {
    height: '22px',
    background: '#0a0a0a',
    borderTop: '1px solid #3a2800',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 10px',
    flexShrink: 0,
  },
  footerLeft: {
    color: '#3a2800',
    fontSize: '8px',
    letterSpacing: '0.12em',
  },
  footerRight: {
    color: '#ffb300',
    fontSize: '8px',
    letterSpacing: '0.1em',
  },
  waitDot: {
    position: 'absolute',
    bottom: '28px',
    right: '12px',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: '#ffb300',
    animation: 'blink 1s ease-in-out infinite',
  },
};
