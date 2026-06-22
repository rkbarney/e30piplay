import { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import ScreenFrame from './ScreenFrame';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';

export default function SystemScreen({ onMinus, onPlus }) {
  const [version, setVersion] = useState(null);   // { sha, branch, online, behind, updateAvailable, dirty, branches }
  const [status, setStatus]   = useState('loading'); // loading | idle | checking | installing | error
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState('');      // branch awaiting tap-to-confirm

  const check = useCallback(async () => {
    setStatus(prev => (prev === 'loading' ? 'loading' : 'checking'));
    setMessage('');
    setPending('');
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

  const switchBranch = useCallback(async (branch) => {
    setStatus('installing');
    setPending('');
    setMessage(`Switching to ${branch} — pull, build, deploy. This can take a few minutes.`);
    try {
      const res = await fetch(`${API_BASE}/api/switch-branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ branch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setStatus('error');
        setMessage(data.detail || data.error || 'Switch failed. Check the working tree over SSH.');
        return;
      }
      setMessage(`Switched to ${branch} — reloading…`);
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      setStatus('error');
      setMessage('Switch request failed (lost connection during restart?). Try reloading.');
    }
  }, []);

  // First tap on a branch arms it; second tap (on the same one) commits.
  const tapBranch = useCallback((branch) => {
    if (branch === version?.branch) return;
    setPending(prev => {
      if (prev === branch) { switchBranch(branch); return ''; }
      return branch;
    });
  }, [version, switchBranch]);

  const busy = status === 'installing' || status === 'checking' || status === 'loading';
  const online = version?.online;
  const canUpdate = version?.updateAvailable && !version?.dirty && !busy;
  const current = version?.branch;
  const branches = version?.branches ?? [];

  let headline = 'Up to date';
  if (status === 'loading') headline = 'Loading…';
  else if (status === 'installing') headline = 'Working…';
  else if (version?.dirty) headline = 'Local changes on Pi';
  else if (!online) headline = 'Offline';
  else if (version?.updateAvailable) headline = `Update available (+${version.behind})`;

  return (
    <ScreenFrame
      variant="amber"
      buttons={[
        { label: '−', onClick: onMinus },
        { label: '+', onClick: onPlus },
      ]}
    >
      <div style={styles.unit}>
        <div style={styles.headRow}>
          <span style={styles.title}>SYSTEM</span>
          <span style={styles.status}>{headline}</span>
        </div>
        <div style={styles.divider} />

        <div style={styles.buildLine}>
          {version ? `${current} @ ${version.sha}` : '—'}
          {version?.dirty ? ' *' : ''}
        </div>

        <div style={styles.branchHead}>SWITCH BRANCH {pending ? '· tap again to confirm' : ''}</div>
        <div style={styles.branchList}>
          {branches.length === 0 && <div style={styles.branchEmpty}>{online ? 'no branches' : 'offline'}</div>}
          {branches.map(b => {
            const isCurrent = b === current;
            const isPending = b === pending;
            return (
              <button
                key={b}
                type="button"
                onClick={() => tapBranch(b)}
                disabled={busy || isCurrent}
                style={{
                  ...styles.branchItem,
                  ...(isCurrent ? styles.branchCurrent : null),
                  ...(isPending ? styles.branchPending : null),
                }}
              >
                <span style={styles.branchName}>{b}</span>
                <span style={styles.branchTag}>
                  {isCurrent ? '● ON' : isPending ? 'CONFIRM ›' : '›'}
                </span>
              </button>
            );
          })}
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
            {status === 'installing' ? 'WORKING…' : 'UPDATE'}
          </button>
        </div>

        {message ? <div style={styles.message}>{message}</div> : null}
      </div>
    </ScreenFrame>
  );
}

SystemScreen.propTypes = {
  onMinus: PropTypes.func,
  onPlus: PropTypes.func,
};

const AMBER = '#ffb300';
const MONO = "'Courier New', monospace";

const styles = {
  // Shared panel footprint — matches DigitalClock so every screen lines up.
  unit: {
    width: '300px',
    height: '320px',
    boxSizing: 'border-box',
    background: '#0d0d0d',
    border: '2px solid #3a2800',
    borderRadius: '12px',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  headRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: '8px',
  },
  title: {
    color: AMBER,
    fontSize: '17px',
    fontFamily: MONO,
    fontWeight: 'bold',
    letterSpacing: '0.2em',
    textShadow: `0 0 8px ${AMBER}66`,
  },
  status: {
    color: '#aa8844',
    fontSize: '10px',
    fontFamily: MONO,
    letterSpacing: '0.04em',
    textAlign: 'right',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  divider: { height: '1px', background: '#3a2800' },
  buildLine: {
    color: '#ccc',
    fontSize: '11px',
    fontFamily: MONO,
    letterSpacing: '0.02em',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  branchHead: {
    color: '#888',
    fontSize: '9px',
    fontFamily: MONO,
    fontWeight: 'bold',
    letterSpacing: '0.08em',
  },
  // Fills the remaining panel height; scrolls if there are many branches.
  branchList: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  branchEmpty: {
    color: '#666',
    fontSize: '10px',
    fontFamily: MONO,
    padding: '4px 2px',
  },
  branchItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '7px 9px',
    background: '#161208',
    border: '1px solid #2a2010',
    borderRadius: '6px',
    color: '#ddd',
    fontFamily: MONO,
    fontSize: '11px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    textAlign: 'left',
  },
  branchCurrent: {
    background: '#2a1c00',
    borderColor: AMBER,
    color: AMBER,
    cursor: 'default',
  },
  branchPending: {
    background: '#3a2600',
    borderColor: '#ffb300',
    color: AMBER,
  },
  branchName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  branchTag: {
    flexShrink: 0,
    fontSize: '9px',
    letterSpacing: '0.06em',
    opacity: 0.85,
  },
  actions: {
    display: 'flex',
    gap: '10px',
  },
  actionBtn: {
    flex: 1,
    height: '42px',
    background: '#1a1000',
    border: '2px solid #7a5500',
    borderRadius: '10px',
    color: AMBER,
    fontSize: '14px',
    fontWeight: 'bold',
    fontFamily: MONO,
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
    fontSize: '10px',
    fontFamily: MONO,
    lineHeight: 1.4,
    wordBreak: 'break-word',
    maxHeight: '60px',
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    flexShrink: 0,
  },
};
