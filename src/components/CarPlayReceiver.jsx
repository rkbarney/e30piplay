/**
 * CarPlayReceiver — hands display to upstream Electron react-carplay from the Pi kiosk.
 *
 * First entry from the clock (+) auto-launches via /api/launch-react-carplay.
 * After the user backs out, reconnect mode shows a large RECONNECT button instead
 * of auto-handoff (phone link may need another explicit nudge).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';

export default function CarPlayReceiver({ onBack, reconnect, onConnected }) {
  const [phase, setPhase] = useState(reconnect ? 'idle' : 'starting');
  const [err, setErr] = useState('');
  const devGuardRef = useRef(false);

  const runLaunch = useCallback(async () => {
    setErr('');
    setPhase('starting');
    try {
      const res = await fetch(`${API_BASE}/api/launch-react-carplay`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhase('idle');
        setErr(data.detail || data.error || `HTTP ${res.status}`);
        return;
      }
      setPhase('handoff');
      if (typeof onConnected === 'function') onConnected();
    } catch (e) {
      setPhase('idle');
      setErr(
        e.message ||
          'Request failed — use the Pi build (nginx + carplay-server). For desktop dev set VITE_S52_API_BASE=http://pi-host'
      );
    }
  }, [onConnected]);

  useEffect(() => {
    if (reconnect) return;
    // React 18 Strict Mode (dev only) runs effects twice; avoid double POST to the Pi launcher.
    if (import.meta.env.DEV) {
      if (devGuardRef.current) return;
      devGuardRef.current = true;
    }
    runLaunch();
  }, [reconnect, runLaunch]);

  const busy = phase === 'starting' || phase === 'handoff';

  return (
    <div style={styles.root}>
      <div style={styles.statusBar}>
        <div style={styles.statusLeft}>
          {typeof onBack === 'function' && (
            <button
              type="button"
              style={{ ...styles.backBtn, ...(reconnect ? styles.backBtnLarge : null) }}
              onClick={onBack}
              disabled={busy}
            >
              ← BACK
            </button>
          )}
          {!reconnect && <span style={styles.brand}>S52 SOLUTIONS</span>}
        </div>
        <span style={styles.mode}>CARPLAY</span>
      </div>

      <div style={styles.main}>
        {reconnect ? (
          <>
            <button
              type="button"
              style={{
                ...styles.reconnectBtn,
                ...(busy ? styles.reconnectBtnBusy : null),
              }}
              onClick={runLaunch}
              disabled={busy}
            >
              {phase === 'starting'
                ? 'CONNECTING…'
                : phase === 'handoff'
                  ? 'SWITCHING…'
                  : 'RECONNECT\nCARPLAY'}
            </button>
            {err ? <div style={styles.error}>{err}</div> : null}
            <div style={styles.hint}>
              Phone not connecting? Check wireless CarPlay on your phone, then tap reconnect.
            </div>
          </>
        ) : (
          <>
            <div style={styles.iconWrap}>
              <div style={styles.bigIcon} aria-hidden>
                <svg width="56" height="56" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <rect
                    x="6.5"
                    y="2.5"
                    width="11"
                    height="19"
                    rx="2.2"
                    fill="none"
                    stroke="#ffb300"
                    strokeWidth="1.4"
                  />
                  <line x1="9" y1="4.5" x2="15" y2="4.5" stroke="#ffb300" strokeWidth="1" opacity="0.35" />
                  <circle cx="12" cy="18.5" r="1.1" fill="#ffb300" />
                </svg>
              </div>
              <div style={styles.title}>CarPlay</div>
            </div>

            <div style={styles.col}>
              <div style={styles.instructions}>
                <div style={styles.step}>Connecting to CarPlay…</div>
              </div>

              {err ? (
                <button type="button" style={styles.primaryBtn} onClick={runLaunch}>
                  Retry Open CarPlay
                </button>
              ) : null}

              {err ? <div style={styles.error}>{err}</div> : null}
            </div>
          </>
        )}
      </div>

      <div style={styles.footer}>
        <span style={styles.footerLeft}>CARLINKIT WIRELESS</span>
        <span style={styles.footerRight}>
          {phase === 'starting'
            ? 'STARTING…'
            : phase === 'handoff'
              ? 'SWITCHING…'
              : err
                ? 'ERROR'
                : reconnect
                  ? 'READY'
                  : 'READY'}
        </span>
      </div>
      {!reconnect && !err ? <div style={styles.waitDot} /> : null}
    </div>
  );
}

CarPlayReceiver.propTypes = {
  onBack: PropTypes.func,
  reconnect: PropTypes.bool,
  onConnected: PropTypes.func,
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
