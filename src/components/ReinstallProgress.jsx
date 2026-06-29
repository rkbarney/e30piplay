import { useState, useCallback, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';

// Full-screen overlay that streams the live install log during a reinstall.
// State/polling live in useReinstallWatch; this is presentation only.
export default function ReinstallProgress({ state, log, onDismiss }) {
  const logRef = useRef(null);
  const [rebooting, setRebooting] = useState(false);

  // Stick to the bottom as new lines stream in.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const reboot = useCallback(async () => {
    setRebooting(true);
    try {
      await fetch(`${API_BASE}/api/reboot`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
    } catch { /* the box is going down — losing the response is expected */ }
  }, []);

  const running = state === 'running';
  const failed = state === 'failed';
  const title = running ? 'REINSTALLING' : failed ? 'REINSTALL FAILED' : 'REINSTALL DONE';
  const titleColor = failed ? '#ff7755' : running ? AMBER : '#88ff88';

  return (
    <div style={styles.overlay}>
      <div style={styles.head}>
        <span style={{ ...styles.title, color: titleColor, textShadow: `0 0 8px ${titleColor}66` }}>
          {title}
        </span>
        {running ? <span style={styles.dots} className="s52-reinstall-dots">●●●</span> : null}
      </div>

      <pre ref={logRef} style={styles.log}>{log || 'Starting…'}</pre>

      <div style={styles.footer}>
        {running ? (
          <div style={styles.note}>
            Installing — do not power off. The screen may flicker as services
            restart; progress resumes here automatically.
          </div>
        ) : rebooting ? (
          <div style={styles.note}>Rebooting now — the display will go dark for about a minute.</div>
        ) : (
          <>
            <div style={{ ...styles.note, color: failed ? '#ffaa99' : '#aaffaa' }}>
              {failed
                ? 'Setup did not finish. Scroll the log above for the error.'
                : 'Done. Reboot to apply everything.'}
            </div>
            <div style={styles.btnRow}>
              {!failed ? (
                <button type="button" style={styles.rebootBtn} onClick={reboot}>REBOOT</button>
              ) : null}
              <button type="button" style={styles.closeBtn} onClick={onDismiss}>CLOSE</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

ReinstallProgress.propTypes = {
  state: PropTypes.oneOf(['idle', 'running', 'done', 'failed']).isRequired,
  log: PropTypes.string,
  onDismiss: PropTypes.func.isRequired,
};

const AMBER = '#ffb300';
const MONO = "'Courier New', monospace";

const styles = {
  overlay: {
    position: 'absolute',
    inset: 0,
    zIndex: 50,
    background: 'rgba(4,3,0,0.98)',
    display: 'flex',
    flexDirection: 'column',
    padding: '12px',
    boxSizing: 'border-box',
    gap: '8px',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    flexShrink: 0,
  },
  title: {
    fontFamily: MONO,
    fontSize: '16px',
    fontWeight: 'bold',
    letterSpacing: '0.18em',
  },
  dots: { color: AMBER, fontSize: '11px', letterSpacing: '0.15em' },
  log: {
    flex: 1,
    minHeight: 0,
    margin: 0,
    padding: '8px',
    background: '#0a0a0a',
    border: '1px solid #3a2800',
    borderRadius: '8px',
    color: '#d8c089',
    fontFamily: MONO,
    fontSize: '9px',
    lineHeight: 1.35,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflowY: 'auto',
  },
  footer: { flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px' },
  note: {
    color: '#bba968',
    fontFamily: MONO,
    fontSize: '10px',
    lineHeight: 1.4,
  },
  btnRow: { display: 'flex', gap: '10px' },
  rebootBtn: {
    flex: 1,
    height: '44px',
    background: '#2a0800',
    border: '2px solid #ff6644',
    borderRadius: '10px',
    color: '#ffaa88',
    fontFamily: MONO,
    fontSize: '14px',
    fontWeight: 'bold',
    letterSpacing: '0.08em',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  closeBtn: {
    flex: 1,
    height: '44px',
    background: '#1a1000',
    border: '2px solid #7a5500',
    borderRadius: '10px',
    color: AMBER,
    fontFamily: MONO,
    fontSize: '14px',
    fontWeight: 'bold',
    letterSpacing: '0.08em',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
};
