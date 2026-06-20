/**
 * CarPlayReceiver — relaunch surface for the pre-loaded react-carplay AppImage.
 *
 * Tapping + from the clock lands here. The user explicitly relaunches CarPlay
 * (restart AppImage + focus) rather than auto-handoff, which helps when the
 * dongle lost the phone link. nginx proxies POST /api/* → carplay-server.cjs.
 */

import { useState, useCallback } from 'react';
import PropTypes from 'prop-types';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';

export default function CarPlayReceiver({ onBack }) {
  const [phase, setPhase] = useState('idle');
  const [err, setErr] = useState('');

  const runRelaunch = useCallback(async () => {
    setErr('');
    setPhase('starting');
    try {
      const res = await fetch(`${API_BASE}/api/relaunch-react-carplay`, {
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

  const busy = phase === 'starting' || phase === 'handoff';

  return (
    <div style={styles.root}>
      <div style={styles.statusBar}>
        <div style={styles.statusLeft}>
          {typeof onBack === 'function' && (
            <button type="button" style={styles.backBtn} onClick={onBack} disabled={busy}>
              ← back
            </button>
          )}
          <span style={styles.brand}>S52 SOLUTIONS</span>
        </div>
        <span style={styles.mode}>CARPLAY</span>
      </div>

      <div style={styles.main}>
        <button
          type="button"
          style={{
            ...styles.relaunchBtn,
            ...(busy ? styles.relaunchBtnBusy : null),
          }}
          onClick={runRelaunch}
          disabled={busy}
        >
          {phase === 'starting'
            ? 'RESTARTING…'
            : phase === 'handoff'
              ? 'SWITCHING…'
              : 'RELAUNCH\nCARPLAY'}
        </button>

        {err ? <div style={styles.error}>{err}</div> : null}

        <div style={styles.hint}>
          Phone not connecting? Check wireless CarPlay on your phone, then tap relaunch.
        </div>
      </div>

      <div style={styles.footer}>
        <span style={styles.footerLeft}>CARLINKIT WIRELESS</span>
        <span style={styles.footerRight}>
          {phase === 'starting'
            ? 'RESTARTING…'
            : phase === 'handoff'
              ? 'HANDOFF'
              : err
                ? 'ERROR'
                : 'READY'}
        </span>
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
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'center',
    padding: '16px 14px',
    gap: '12px',
    minHeight: 0,
  },
  relaunchBtn: {
    flex: 1,
    minHeight: '200px',
    maxHeight: '320px',
    margin: '0 4px',
    padding: '24px 16px',
    fontFamily: 'inherit',
    fontSize: '28px',
    fontWeight: 'bold',
    letterSpacing: '0.12em',
    lineHeight: 1.15,
    whiteSpace: 'pre-line',
    color: '#1a1200',
    background: 'linear-gradient(180deg, #ffc940 0%, #e6a000 100%)',
    border: '3px solid #ffdd77',
    borderRadius: '8px',
    cursor: 'pointer',
    boxShadow: '0 4px 24px rgba(255, 179, 0, 0.35)',
  },
  relaunchBtnBusy: {
    opacity: 0.75,
    cursor: 'wait',
    fontSize: '18px',
    letterSpacing: '0.08em',
  },
  error: {
    color: '#ff6b6b',
    fontSize: '8px',
    lineHeight: 1.35,
    borderLeft: '2px solid #662222',
    paddingLeft: '6px',
    flexShrink: 0,
  },
  hint: {
    color: '#665533',
    fontSize: '7px',
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
};
