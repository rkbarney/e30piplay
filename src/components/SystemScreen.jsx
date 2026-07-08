import { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import ScreenFrame from './ScreenFrame';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';

export default function SystemScreen({ onMinus, onPlus, onSettings }) {
  const [version, setVersion] = useState(null);   // { sha, branch, online, behind, updateAvailable, dirty, branches }
  const [wifi, setWifi]       = useState(null);   // { connected, profile, ssid, signal, profiles }
  const [status, setStatus]   = useState('loading'); // loading | idle | checking | installing | error
  const [wifiBusy, setWifiBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [picker, setPicker]       = useState(false); // branch dialog open?
  const [wifiPicker, setWifiPicker] = useState(false);

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
      if (res.status === 403) {
        // nginx keeps update/reboot/reinstall loopback-only (see setup.sh).
        setStatus('error');
        setMessage('Updates can only be started from the car display itself.');
        return;
      }
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
      if (res.status === 403) {
        setStatus('error');
        setMessage('Branch switching only works from the car display itself.');
        return;
      }
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
    setWifiPicker(false);
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
          <div style={styles.branchRow}>
            <button
              type="button"
              style={{
                ...styles.branchBtn,
                ...(busy || !hasProfiles ? styles.branchBtnDisabled : null),
              }}
              onClick={() => setWifiPicker(true)}
              disabled={busy || !hasProfiles}
              aria-label="WiFi network"
            >
              <span style={styles.branchBtnLabel}>NETWORK</span>
              <span style={styles.branchBtnValue}>{wifiLabel} ▾</span>
            </button>

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

          <button
            type="button"
            style={styles.settingsBtn}
            onClick={onSettings}
            disabled={!onSettings}
            aria-label="Settings"
          >
            <span style={styles.branchBtnLabel}>SETTINGS</span>
            <span style={{ ...styles.branchBtnValue, fontSize: '18px' }}>▸</span>
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

        {wifiPicker ? (
          <div style={styles.dialog}>
            <div style={styles.dialogTitle}>SWITCH NETWORK</div>
            <div style={styles.dialogList}>
              {wifiProfiles.map((p) => {
                const isCurrent = wifi?.connected && p === wifi?.profile;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => !isCurrent && switchWifi(p)}
                    disabled={isCurrent || wifiBusy}
                    style={{ ...styles.choice, ...(isCurrent ? styles.choiceCurrent : null) }}
                  >
                    <span style={styles.choiceName}>{p}</span>
                    <span style={styles.choiceTag}>{isCurrent ? '● ON' : '›'}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" style={styles.dialogCancel} onClick={() => setWifiPicker(false)}>
              CANCEL
            </button>
          </div>
        ) : null}

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
  onSettings: PropTypes.func,
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
    justifyContent: 'stretch',
    gap: '8px',
  },
  branchRow: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    gap: '8px',
  },
  branchBtn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%',
    flex: 1,
    minWidth: 0,        // let the value text ellipsis-truncate instead of overflowing the row
    minHeight: '112px',
    background: '#161208',
    border: '2px solid #3a2800',
    borderRadius: '10px',
    overflow: 'hidden',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  branchBtnDisabled: { opacity: 0.35, cursor: 'default' },
  settingsBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%',
    flexShrink: 0,
    height: '52px',
    background: '#161208',
    border: '2px solid #3a2800',
    borderRadius: '10px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  branchBtnLabel: {
    color: '#888',
    fontSize: '15px',
    fontFamily: MONO,
    fontWeight: 'bold',
    letterSpacing: '0.12em',
  },
  branchBtnValue: {
    color: AMBER,
    fontSize: '26px',
    fontWeight: 'bold',
    fontFamily: MONO,
    maxWidth: '100%',   // bounded by the (two-up) button, not the full panel — avoids clipping past the frame edge
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

  // Picker dialogs — overlays the panel (WiFi + branch share sizing).
  dialog: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(8,6,0,0.97)',
    borderRadius: '12px',
    padding: '14px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  dialogTitle: {
    color: AMBER,
    fontSize: '20px',
    fontFamily: MONO,
    fontWeight: 'bold',
    letterSpacing: '0.15em',
    textAlign: 'center',
    flexShrink: 0,
  },
  dialogList: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  choice: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    minHeight: '84px',
    padding: '20px 16px',
    background: '#161208',
    border: '2px solid #3a2800',
    borderRadius: '10px',
    color: '#eee',
    fontFamily: MONO,
    fontSize: '24px',
    fontWeight: 'bold',
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
  choiceTag: { flexShrink: 0, fontSize: '16px', opacity: 0.85 },
  dialogCancel: {
    flexShrink: 0,
    height: '56px',
    background: '#1a1000',
    border: '2px solid #7a5500',
    borderRadius: '10px',
    color: AMBER,
    fontSize: '18px',
    fontWeight: 'bold',
    fontFamily: MONO,
    letterSpacing: '0.1em',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
};
