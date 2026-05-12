/**
 * CarPlayReceiver — hands display to upstream Electron react-carplay from the Pi kiosk.
 *
 * Opens automatically when this screen is shown (+). nginx proxies POST /api/* → carplay-server.cjs.
 * Requires ~/.local/bin/react-carplay (setup.sh or install-react-carplay-appimage.sh).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';

export default function CarPlayReceiver({ onBack }) {
  const [phase, setPhase] = useState('starting');
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
    } catch (e) {
      setPhase('idle');
      setErr(
        e.message ||
          'Request failed — use the Pi build (nginx + carplay-server). For desktop dev set VITE_S52_API_BASE=http://pi-host'
      );
    }
  }, []);

  useEffect(() => {
    // React 18 Strict Mode (dev only) runs effects twice; avoid double POST to the Pi launcher.
    if (import.meta.env.DEV) {
      if (devGuardRef.current) return;
      devGuardRef.current = true;
    }
    runLaunch();
  }, [runLaunch]);

  return (
    <div style={styles.root}>
      <div style={styles.statusBar}>
        <div style={styles.statusLeft}>
          {typeof onBack === 'function' && (
            <button type="button" style={styles.backBtn} onClick={onBack}>
              ← back
            </button>
          )}
          <span style={styles.brand}>S52 SOLUTIONS</span>
        </div>
        <span style={styles.mode}>CARPLAY</span>
      </div>

      <div style={styles.main}>
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
            <div style={styles.step}>1  Plug Carlinkit dongle into Pi USB</div>
            <div style={styles.step}>2  Electron opens automatically — kiosk hands off the display</div>
            <div style={styles.step}>3  Quit Electron when done — kiosk returns</div>
          </div>

          {err ? (
            <button type="button" style={styles.primaryBtn} onClick={runLaunch}>
              Retry Open CarPlay
            </button>
          ) : null}

          {err ? <div style={styles.error}>{err}</div> : null}

          <div style={styles.hint}>
            Stuck? SSH:{' '}
            <span style={styles.mono}>sudo /usr/local/bin/s52-carplay-switch.sh return</span>
          </div>
        </div>
      </div>

      <div style={styles.footer}>
        <span style={styles.footerLeft}>CARLINKIT WIRELESS DONGLE</span>
        <span style={styles.footerRight}>
          {phase === 'starting'
            ? 'STARTING…'
            : phase === 'handoff'
              ? 'SWITCHING DISPLAY…'
              : err
                ? 'ERROR'
                : 'READY'}
        </span>
      </div>
      <div style={styles.waitDot} />
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
    height: '22px',
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
    padding: '1px 5px',
    fontFamily: 'inherit',
    fontSize: '8px',
    lineHeight: 1.2,
    color: '#ffb300',
    background: 'rgba(0,0,0,0.35)',
    border: '1px solid #3a2800',
    borderRadius: '2px',
    cursor: 'pointer',
    letterSpacing: '0.06em',
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
    alignItems: 'flex-start',
    gap: '16px',
    padding: '12px 14px 8px',
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
  },
  instructions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  step: {
    color: '#cc8800',
    fontSize: '8.5px',
    lineHeight: 1.28,
    borderLeft: '2px solid #3a2800',
    paddingLeft: '6px',
  },
  primaryBtn: {
    marginTop: '4px',
    padding: '8px 10px',
    fontFamily: 'inherit',
    fontSize: '9px',
    fontWeight: 'bold',
    letterSpacing: '0.08em',
    color: '#1a1200',
    background: 'linear-gradient(180deg, #ffc940 0%, #e6a000 100%)',
    border: '1px solid #ffdd77',
    borderRadius: '3px',
    cursor: 'pointer',
    alignSelf: 'stretch',
  },
  error: {
    color: '#ff6b6b',
    fontSize: '8px',
    lineHeight: 1.35,
    borderLeft: '2px solid #662222',
    paddingLeft: '6px',
  },
  hint: {
    color: '#665533',
    fontSize: '7px',
    lineHeight: 1.35,
    marginTop: 'auto',
    paddingBottom: '4px',
  },
  mono: {
    fontFamily: 'monospace',
    color: '#887755',
    wordBreak: 'break-all',
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
