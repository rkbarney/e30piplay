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
        setMessage(data.detail || data.error || 'Update failed. Check the working tree over SSH.');
        return;
      }
      setMessage('Update complete — reloading…');
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
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
  },
  unit: {
    width: '300px',
    background: '#0d0d0d',
    border: '2px solid #3a2800',
    borderRadius: '12px',
    padding: '18px 18px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  title: {
    color: AMBER,
    fontSize: '18px',
    fontFamily: "'Courier New', monospace",
    fontWeight: 'bold',
    letterSpacing: '0.2em',
    textShadow: `0 0 8px ${AMBER}66`,
  },
  divider: {
    height: '1px',
    background: '#3a2800',
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: '10px',
  },
  rowLabel: {
    color: '#888',
    fontSize: '12px',
    fontFamily: "'Courier New', monospace",
    fontWeight: 'bold',
    letterSpacing: '0.08em',
    flexShrink: 0,
  },
  rowValue: {
    color: '#eee',
    fontSize: '13px',
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
    gap: '10px',
    marginTop: '4px',
  },
  actionBtn: {
    flex: 1,
    height: '52px',
    background: '#1a1000',
    border: '2px solid #7a5500',
    borderRadius: '10px',
    color: AMBER,
    fontSize: '15px',
    fontWeight: 'bold',
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
    color: '#bbb',
    fontSize: '11px',
    fontFamily: "'Courier New', monospace",
    lineHeight: 1.45,
    wordBreak: 'break-word',
    maxHeight: '100px',
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
  },
  navButtons: {
    width: '300px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  navBtn: {
    width: '128px',
    height: '68px',
    background: '#1a1a1a',
    border: '2px solid #555',
    borderRadius: '12px',
    color: '#fff',
    fontSize: '44px',
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
