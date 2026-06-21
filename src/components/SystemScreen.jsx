import { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';

export default function SystemScreen({ onMinus, onPlus }) {
  const [version, setVersion] = useState(null);   // { sha, branch, online, behind, updateAvailable, dirty }
  const [status, setStatus]   = useState('loading'); // loading | idle | checking | installing | error
  const [message, setMessage] = useState('');

  const check = useCallback(async () => {
    setStatus(prev => (prev === 'loading' ? 'loading' : 'checking'));
    setMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/version`, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      setVersion(data);
      setStatus('idle');
    } catch {
      setStatus('error');
      setMessage('Could not reach the update service.');
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  const install = useCallback(async () => {
    setStatus('installing');
    setMessage('Pulling, building, and deploying… this can take a few minutes.');
    try {
      const res = await fetch(`${API_BASE}/api/update`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setStatus('error');
        setMessage(data.detail || 'Update failed. Check the working tree over SSH.');
        return;
      }
      setMessage('Update complete — reloading…');
      // Vite emits hash-named assets, so a reload picks up the new build.
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      setStatus('error');
      setMessage('Update request failed (lost connection during restart?). Try reloading.');
    }
  }, []);

  const busy = status === 'installing' || status === 'checking' || status === 'loading';
  const online = version?.online;
  const canUpdate = version?.updateAvailable && !version?.dirty && !busy;

  let headline = 'Up to date';
  if (status === 'loading') headline = 'Loading…';
  else if (version?.dirty) headline = 'Local changes on Pi';
  else if (!online) headline = 'Offline';
  else if (version?.updateAvailable) headline = `Update available (+${version.behind})`;

  return (
    <div style={styles.root}>
      <div style={styles.unit}>
        <div style={styles.title}>SYSTEM</div>
        <div style={styles.divider} />

        <div style={styles.rows}>
          <Row label="BUILD" value={version ? `${version.branch} @ ${version.sha}` : '—'} />
          <Row label="GITHUB" value={online ? 'reachable' : 'unreachable'} dim={!online} />
          <Row label="STATUS" value={headline} />
        </div>

        <div style={styles.actions}>
          <button
            style={{ ...styles.actionBtn, ...(busy ? styles.actionBtnDisabled : null) }}
            onClick={check}
            disabled={busy}
            type="button"
          >
            {status === 'checking' ? 'CHECKING…' : 'CHECK'}
          </button>
          <button
            style={{ ...styles.actionBtn, ...(!canUpdate ? styles.actionBtnDisabled : styles.actionBtnPrimary) }}
            onClick={install}
            disabled={!canUpdate}
            type="button"
          >
            {status === 'installing' ? 'UPDATING…' : 'INSTALL'}
          </button>
        </div>

        {message ? <div style={styles.message}>{message}</div> : null}
      </div>

      <div style={styles.navButtons}>
        <button style={styles.navBtn} onClick={onMinus} type="button">−</button>
        <button style={styles.navBtn} onClick={onPlus} type="button">+</button>
      </div>
    </div>
  );
}

function Row({ label, value, dim }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={{ ...styles.rowValue, ...(dim ? styles.rowValueDim : null) }}>{value}</span>
    </div>
  );
}

Row.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node,
  dim: PropTypes.bool,
};

SystemScreen.propTypes = {
  onMinus: PropTypes.func,
  onPlus: PropTypes.func,
};

const AMBER = '#ffb300';

const styles = {
  root: {
    width: '320px',
    height: '480px',
    background: '#000',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unit: {
    width: '296px',
    background: '#0d0d0d',
    border: '1px solid #2a2a2a',
    borderRadius: '8px',
    padding: '14px 16px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  title: {
    color: AMBER,
    fontSize: '12px',
    fontFamily: "'Courier New', monospace",
    letterSpacing: '0.25em',
    textShadow: `0 0 6px ${AMBER}66`,
  },
  divider: {
    height: '1px',
    background: '#2a2a2a',
    margin: '0 -2px',
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: '8px',
  },
  rowLabel: {
    color: '#777',
    fontSize: '9px',
    fontFamily: "'Courier New', monospace",
    letterSpacing: '0.08em',
    flexShrink: 0,
  },
  rowValue: {
    color: '#ddd',
    fontSize: '11px',
    fontFamily: "'Courier New', monospace",
    textAlign: 'right',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowValueDim: {
    color: '#777',
  },
  actions: {
    display: 'flex',
    gap: '8px',
    marginTop: '2px',
  },
  actionBtn: {
    flex: 1,
    height: '34px',
    background: '#1a1000',
    border: '1px solid #7a5500',
    borderRadius: '5px',
    color: AMBER,
    fontSize: '11px',
    fontFamily: "'Courier New', monospace",
    letterSpacing: '0.08em',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    userSelect: 'none',
  },
  actionBtnPrimary: {
    background: '#2a1c00',
    borderColor: AMBER,
  },
  actionBtnDisabled: {
    opacity: 0.35,
    cursor: 'default',
  },
  message: {
    color: '#aaa',
    fontSize: '9px',
    fontFamily: "'Courier New', monospace",
    lineHeight: 1.5,
    wordBreak: 'break-word',
    maxHeight: '120px',
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
  },
  navButtons: {
    position: 'absolute',
    bottom: '52px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '200px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  navBtn: {
    width: '56px',
    height: '28px',
    background: '#1a1000',
    border: '1px solid #7a5500',
    borderRadius: '5px',
    color: AMBER,
    fontSize: '18px',
    lineHeight: 1,
    cursor: 'pointer',
    fontFamily: "'Courier New', monospace",
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
    userSelect: 'none',
  },
};
