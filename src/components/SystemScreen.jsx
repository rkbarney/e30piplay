import { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import ScreenFrame from './ScreenFrame';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';

export default function SystemScreen({ onMinus, onPlus }) {
  const [version, setVersion] = useState(null);   // { sha, branch, online, behind, updateAvailable, dirty, branches }
  const [wifi, setWifi]       = useState(null);   // { connected, profile, ssid, signal, profiles }
  const [status, setStatus]   = useState('loading'); // loading | idle | checking | installing | error
  const [wifiBusy, setWifiBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [picker, setPicker]   = useState(false);   // branch dialog open?

  const fetchWifi = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/wifi`, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      if (res.ok) setWifi(data);
    } catch {
      /* leave prior wifi state; version check surfaces connectivity errors */
    }
  }, []);

  const check = useCallback(async () => {
    setStatus(prev => (prev === 'loading' ? 'loading' : 'checking'));
    setMessage('');
    try {
      const [versionRes] = await Promise.all([
        fetch(`${API_BASE}/api/version`, { headers: { Accept: 'application/json' } }),
        fetchWifi(),
      ]);
      const data = await versionRes.json();
      setVersion(data);
      setStatus('idle');
    } catch {
      setStatus('error');
      setMessage('Could not reach the update service.');
    }
  }, [fetchWifi]);

  useEffect(() => { check(); }, [check]);

  const install = useCallback(async (force = false) => {
    setStatus('installing');
    setMessage(force
      ? 'Discarding local changes, then pull/build/deploy…'
      : 'Pulling, building, and deploying… this can take a few minutes.');
    try {
      const res = await fetch(`${API_BASE}/api/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ force }),
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

  const switchBranch = useCallback(async (branch, force = false) => {
    setPicker(false);
    setStatus('installing');
    setMessage(force
      ? `Force switching to ${branch} — discarding local changes…`
      : `Switching to ${branch} — pull, build, deploy. This can take a few minutes.`);
    try {
      const res = await fetch(`${API_BASE}/api/switch-branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ branch, force }),
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

  const switchWifi = useCallback(async (profile) => {
    if (!profile || wifi?.profile === profile || wifiBusy) return;
    setWifiBusy(true);
    setMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/wifi/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ profile }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setMessage(data.detail || data.error || 'WiFi switch failed.');
        return;
      }
      setWifi(data);
    } catch {
      setMessage('WiFi switch failed (lost connection?).');
    } finally {
      setWifiBusy(false);
    }
  }, [wifi?.profile, wifiBusy]);

  const busy = status === 'installing' || status === 'checking' || status === 'loading' || wifiBusy;
  const online = version?.online;
  const canUpdate = version?.updateAvailable && !version?.dirty && !busy;
  const canForceUpdate = !busy && online && (version?.dirty || version?.updateAvailable);
  const current = version?.branch;

  // main always first, then the 3 most-recently-committed branches (server sorts).
  const recent = version?.branches ?? [];
  const choices = [
    ...(recent.includes('main') ? ['main'] : []),
    ...recent.filter(b => b !== 'main').slice(0, 3),
  ];

  let headline = 'Up to date';
  if (status === 'loading') headline = 'Loading…';
  else if (status === 'installing') headline = 'Working…';
  else if (version?.dirty) headline = 'Local changes on Pi';
  else if (!online) headline = 'Offline';
  else if (version?.updateAvailable) headline = `Update available (+${version.behind})`;

  const wifiLabel = (() => {
    if (wifiBusy) return 'Switching…';
    if (!wifi) return 'Loading…';
    if (!wifi.connected) return 'Not connected';
    const name = wifi.ssid || wifi.profile || '—';
    return wifi.signal != null ? `${name} · ${wifi.signal}%` : name;
  })();

  const wifiProfiles = wifi?.profiles ?? [];
  const selectValue = wifi?.connected && wifi?.profile ? wifi.profile : '';
  const hasProfiles = wifiProfiles.length > 0;

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

        <div style={styles.body}>
          <div style={styles.wifiBlock}>
            <span style={styles.sectionLabel}>NETWORK</span>
            <div style={styles.wifiSelectWrap}>
              <select
                value={selectValue}
                onChange={(e) => switchWifi(e.target.value)}
                disabled={busy || !hasProfiles}
                style={{
                  ...styles.wifiSelect,
                  ...(busy || !hasProfiles ? styles.wifiSelectDisabled : null),
                }}
                aria-label="WiFi network"
              >
                {!wifi?.connected ? (
                  <option value="">{hasProfiles ? 'Not connected' : 'No saved networks'}</option>
                ) : null}
                {wifiProfiles.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <span style={styles.wifiDetail}>{wifiLabel}</span>
          </div>

          <button
            type="button"
            style={{ ...styles.branchBtn, ...(busy ? styles.branchBtnDisabled : null) }}
            onClick={() => setPicker(true)}
            disabled={busy || choices.length <= 1}
          >
            <span style={styles.branchBtnLabel}>BRANCH</span>
            <span style={styles.branchBtnValue}>{current || '—'} ▾</span>
          </button>
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
          {version?.dirty ? (
            <button
              style={{ ...styles.actionBtn, ...(!canForceUpdate ? styles.actionBtnDisabled : styles.actionBtnWarn) }}
              onClick={() => install(true)}
              disabled={!canForceUpdate}
              type="button"
            >
              {status === 'installing' ? 'WORKING…' : 'FORCE\nUPDATE'}
            </button>
          ) : (
            <button
              style={{ ...styles.actionBtn, ...(!canUpdate ? styles.actionBtnDisabled : styles.actionBtnPrimary) }}
              onClick={() => install(false)}
              disabled={!canUpdate}
              type="button"
            >
              {status === 'installing' ? 'WORKING…' : 'UPDATE'}
            </button>
          )}
        </div>

        {message ? <div style={styles.message}>{message}</div> : null}

        {picker ? (
          <div style={styles.dialog}>
            <div style={styles.dialogTitle}>SWITCH BRANCH</div>
            <div style={styles.dialogList}>
              {choices.map(b => {
                const isCurrent = b === current;
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => !isCurrent && switchBranch(b, version?.dirty)}
                    disabled={isCurrent}
                    style={{ ...styles.choice, ...(isCurrent ? styles.choiceCurrent : null) }}
                  >
                    <span style={styles.choiceName}>{b}</span>
                    <span style={styles.choiceTag}>{isCurrent ? '● ON' : '›'}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" style={styles.dialogCancel} onClick={() => setPicker(false)}>
              CANCEL
            </button>
          </div>
        ) : null}
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
    position: 'relative',
    width: '300px',
    height: '320px',
    boxSizing: 'border-box',
    background: '#0d0d0d',
    border: '2px solid #3a2800',
    borderRadius: '12px',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
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
  body: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: '10px',
  },
  wifiBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  sectionLabel: {
    color: '#888',
    fontSize: '11px',
    fontFamily: MONO,
    fontWeight: 'bold',
    letterSpacing: '0.1em',
  },
  wifiSelectWrap: {
    width: '100%',
  },
  wifiSelect: {
    width: '100%',
    height: '44px',
    padding: '0 12px',
    background: '#161208',
    border: '2px solid #3a2800',
    borderRadius: '8px',
    color: AMBER,
    fontSize: '13px',
    fontWeight: 'bold',
    fontFamily: MONO,
    letterSpacing: '0.04em',
    cursor: 'pointer',
    WebkitAppearance: 'none',
    appearance: 'none',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  wifiSelectDisabled: { opacity: 0.35, cursor: 'default' },
  wifiDetail: {
    color: '#aa8844',
    fontSize: '10px',
    fontFamily: MONO,
    letterSpacing: '0.04em',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  branchBtn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    width: '100%',
    height: '88px',
    background: '#161208',
    border: '2px solid #3a2800',
    borderRadius: '10px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  branchBtnDisabled: { opacity: 0.35, cursor: 'default' },
  branchBtnLabel: {
    color: '#888',
    fontSize: '11px',
    fontFamily: MONO,
    fontWeight: 'bold',
    letterSpacing: '0.1em',
  },
  branchBtnValue: {
    color: AMBER,
    fontSize: '20px',
    fontWeight: 'bold',
    fontFamily: MONO,
    maxWidth: '260px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  actions: {
    display: 'flex',
    gap: '10px',
  },
  actionBtn: {
    flex: 1,
    height: '46px',
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
  actionBtnPrimary: { background: '#2a1c00', borderColor: AMBER },
  actionBtnWarn: { background: '#2a0800', borderColor: '#ff6644', color: '#ffaa88' },
  actionBtnDisabled: { opacity: 0.35, cursor: 'default' },
  message: {
    color: '#bbb',
    fontSize: '10px',
    fontFamily: MONO,
    lineHeight: 1.4,
    wordBreak: 'break-word',
    maxHeight: '54px',
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    flexShrink: 0,
  },

  // Branch picker dialog — overlays the panel.
  dialog: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(8,6,0,0.97)',
    borderRadius: '12px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  dialogTitle: {
    color: AMBER,
    fontSize: '13px',
    fontFamily: MONO,
    fontWeight: 'bold',
    letterSpacing: '0.15em',
    textAlign: 'center',
  },
  dialogList: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  choice: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '12px 12px',
    background: '#161208',
    border: '1px solid #3a2800',
    borderRadius: '8px',
    color: '#eee',
    fontFamily: MONO,
    fontSize: '13px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    textAlign: 'left',
  },
  choiceCurrent: {
    background: '#2a1c00',
    borderColor: AMBER,
    color: AMBER,
    cursor: 'default',
  },
  choiceName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  choiceTag: { flexShrink: 0, fontSize: '11px', opacity: 0.85 },
  dialogCancel: {
    flexShrink: 0,
    height: '40px',
    background: '#1a1000',
    border: '2px solid #7a5500',
    borderRadius: '10px',
    color: AMBER,
    fontSize: '13px',
    fontWeight: 'bold',
    fontFamily: MONO,
    letterSpacing: '0.1em',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
};
