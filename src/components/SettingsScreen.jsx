import { useState, useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';
import ScreenFrame from './ScreenFrame';
import { FACES, FACE_LABELS, DEFAULT_BOOT_SCREEN } from '../screens';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';

export default function SettingsScreen({ settings, onUpdate, onBack, onReinstallStarted }) {
  const [bootPicker, setBootPicker] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'reboot' | 'reinstall' | null
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [canForce, setCanForce] = useState(false);

  // Bluetooth audio state — the status JSON from /api/bluetooth (see
  // scripts/s52-bluetooth.sh). null until the first fetch answers.
  const [bt, setBt] = useState(null);
  const [btOpen, setBtOpen] = useState(false);
  const [btBusy, setBtBusy] = useState(null); // user-facing label of the running op
  const [btMsg, setBtMsg] = useState('');
  const [btDevices, setBtDevices] = useState(null); // last scan results

  const bootScreen = settings.bootScreen || DEFAULT_BOOT_SCREEN;

  // Every s52-bluetooth.sh command replies with fresh status, so one helper
  // both performs the action and refreshes the panel.
  const btCall = useCallback(async (pathname, body, label) => {
    setBtBusy(label);
    setBtMsg('');
    try {
      const res = await fetch(`${API_BASE}${pathname}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setBtMsg(data.detail || data.error || 'Bluetooth request failed.');
        return null;
      }
      setBt(data);
      if (data.devices) setBtDevices(data.devices);
      return data;
    } catch {
      setBtMsg('Bluetooth request failed (lost connection?).');
      return null;
    } finally {
      setBtBusy(null);
    }
  }, []);

  useEffect(() => {
    btCall('/api/bluetooth', undefined, null);
  }, [btCall]);

  const toggleAudioOut = useCallback(() => {
    const next = bt?.mode === 'bluetooth' ? 'aux' : 'bluetooth';
    btCall('/api/audio-output', { output: next }, 'SWITCHING…');
  }, [bt, btCall]);

  const btDeviceTap = useCallback((d) => {
    if (d.connected) btCall('/api/bluetooth/disconnect', { mac: d.mac }, 'DISCONNECTING…');
    else if (d.paired) btCall('/api/bluetooth/connect', { mac: d.mac }, 'CONNECTING…');
    else btCall('/api/bluetooth/pair', { mac: d.mac }, 'PAIRING…');
  }, [btCall]);

  const reboot = useCallback(async () => {
    setConfirm(null);
    setBusy(true);
    setCanForce(false);
    setMessage('Rebooting…');
    try {
      const res = await fetch(`${API_BASE}/api/reboot`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setMessage(data.detail || data.error || 'Reboot failed.');
        setBusy(false);
        return;
      }
      setMessage('Rebooting now — the display will go dark for a bit.');
    } catch {
      setMessage('Reboot request failed (lost connection?).');
      setBusy(false);
    }
  }, []);

  const reinstall = useCallback(async (force = false) => {
    setConfirm(null);
    setBusy(true);
    setCanForce(false);
    setMessage('Starting reinstall…');
    try {
      const res = await fetch(`${API_BASE}/api/reinstall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ force }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        const detail = data.detail || data.error || 'Reinstall failed.';
        setMessage(detail);
        setCanForce(!force && /local changes/i.test(detail));
        setBusy(false);
        return;
      }
      // The job runs detached on the Pi now — hand off to the root-level
      // progress overlay, which streams the live install log and survives the
      // kiosk display restarting partway through.
      setMessage('');
      setBusy(false);
      onReinstallStarted?.();
    } catch {
      setMessage('Reinstall request failed (lost connection?).');
      setBusy(false);
    }
  }, [onReinstallStarted]);

  return (
    <ScreenFrame variant="amber" buttons={[{ label: 'BACK', onClick: onBack }]}>
      <div style={styles.unit}>
        <div style={styles.headRow}>
          <span style={styles.title}>SETTINGS</span>
        </div>
        <div style={styles.divider} />

        <div style={styles.body}>
          <div style={styles.settingsGrid}>
            <button
              type="button"
              style={styles.settingsBtn}
              onClick={() => onUpdate({ showMouse: !settings.showMouse })}
              aria-label="Show mouse pointer"
            >
              <span style={styles.rowLabel}>SHOW MOUSE</span>
              <span style={{ ...styles.rowValue, ...(settings.showMouse ? styles.rowValueOn : null) }}>
                {settings.showMouse ? 'ON' : 'OFF'}
              </span>
            </button>

            <button
              type="button"
              style={styles.settingsBtn}
              onClick={() => setBootPicker(true)}
              aria-label="Default boot screen"
            >
              <span style={styles.rowLabel}>BOOT SCREEN</span>
              <span style={styles.rowValue}>{FACE_LABELS[bootScreen]} ▾</span>
            </button>

            <button
              type="button"
              style={{ ...styles.settingsBtn, ...(btBusy ? styles.actionBtnDisabled : null) }}
              onClick={toggleAudioOut}
              disabled={!!btBusy}
              aria-label="Audio output"
            >
              <span style={styles.rowLabel}>AUDIO OUT</span>
              <span
                style={{
                  ...styles.rowValue,
                  ...(bt?.effectiveOutput === 'bluetooth' ? styles.rowValueOn : null),
                }}
              >
                {!bt
                  ? '…'
                  : bt.mode === 'bluetooth'
                    ? bt.effectiveOutput === 'bluetooth' ? 'BT' : 'BT (AUX)'
                    : 'AUX'}
              </span>
            </button>

            <button
              type="button"
              style={styles.settingsBtn}
              onClick={() => {
                setBtOpen(true);
                setBtMsg('');
                btCall('/api/bluetooth', undefined, null);
              }}
              aria-label="Bluetooth devices"
            >
              <span style={styles.rowLabel}>BLUETOOTH</span>
              <span style={{ ...styles.rowValue, ...(bt?.connected ? styles.rowValueOn : null) }}>
                {bt?.connected ? bt.connected.name : bt?.available === false ? 'N/A' : 'NONE'}
              </span>
            </button>
          </div>

          <div style={styles.actions}>
            <button
              type="button"
              style={{ ...styles.actionBtn, ...(busy ? styles.actionBtnDisabled : null) }}
              onClick={() => setConfirm('reboot')}
              disabled={busy}
            >
              REBOOT
            </button>
            <button
              type="button"
              style={{ ...styles.actionBtn, ...styles.actionBtnWarn, ...(busy ? styles.actionBtnDisabled : null) }}
              onClick={() => setConfirm('reinstall')}
              disabled={busy}
            >
              REINSTALL
            </button>
          </div>
        </div>

        {message || (!btOpen && (btBusy || btMsg)) ? (
          <div style={styles.message}>
            {message || btBusy || btMsg}
            {canForce ? (
              <button type="button" style={styles.forceBtn} onClick={() => reinstall(true)}>
                FORCE REINSTALL
              </button>
            ) : null}
          </div>
        ) : (
          <div style={styles.hint}>
            AUDIO OUT BT sends everything to the Bluetooth stereo and falls back
            to AUX (USB DAC) whenever it drops. Pair via BLUETOOTH.
            REINSTALL re-runs full setup; REBOOT after.
          </div>
        )}

        {bootPicker ? (
          <div style={styles.dialog}>
            <div style={styles.dialogTitle}>BOOT SCREEN</div>
            <div style={styles.dialogList}>
              {FACES.map((face) => {
                const isCurrent = face === bootScreen;
                return (
                  <button
                    key={face}
                    type="button"
                    onClick={() => {
                      onUpdate({ bootScreen: face });
                      setBootPicker(false);
                    }}
                    disabled={isCurrent}
                    style={{ ...styles.choice, ...(isCurrent ? styles.choiceCurrent : null) }}
                  >
                    <span style={styles.choiceName}>{FACE_LABELS[face]}</span>
                    <span style={styles.choiceTag}>{isCurrent ? '● ON' : '›'}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" style={styles.dialogCancel} onClick={() => setBootPicker(false)}>
              CANCEL
            </button>
          </div>
        ) : null}

        {btOpen ? (
          <div style={styles.dialog}>
            <div style={styles.dialogTitle}>BLUETOOTH</div>
            <div style={styles.btStatusLine}>
              {bt?.available === false
                ? 'NO BLUETOOTH ADAPTER'
                : bt?.connected
                  ? `● ${bt.connected.name}`
                  : 'NOT CONNECTED'}
              {bt ? ` · OUT: ${bt.effectiveOutput === 'bluetooth' ? 'BT' : 'AUX'}` : ''}
            </div>
            <div style={styles.dialogList}>
              {(bt?.paired ?? []).map((d) => (
                <div key={d.mac} style={styles.btRow}>
                  <button
                    type="button"
                    style={{
                      ...styles.btDevBtn,
                      ...(d.connected ? styles.btDevConnected : null),
                      ...(btBusy ? styles.actionBtnDisabled : null),
                    }}
                    disabled={!!btBusy}
                    onClick={() => btDeviceTap(d)}
                  >
                    <span style={styles.choiceName}>{d.name}</span>
                    <span style={styles.choiceTag}>{d.connected ? '● ON' : 'PAIRED'}</span>
                  </button>
                  <button
                    type="button"
                    style={{ ...styles.btForgetBtn, ...(btBusy ? styles.actionBtnDisabled : null) }}
                    disabled={!!btBusy}
                    onClick={() => btCall('/api/bluetooth/forget', { mac: d.mac }, 'FORGETTING…')}
                    aria-label={`Forget ${d.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))}

              {(btDevices ?? [])
                .filter((d) => !(bt?.paired ?? []).some((p) => p.mac === d.mac))
                .map((d) => (
                  <div key={d.mac} style={styles.btRow}>
                    <button
                      type="button"
                      style={{ ...styles.btDevBtn, ...(btBusy ? styles.actionBtnDisabled : null) }}
                      disabled={!!btBusy}
                      onClick={() => btDeviceTap(d)}
                    >
                      <span style={styles.choiceName}>{d.name}</span>
                      <span style={styles.choiceTag}>›</span>
                    </button>
                  </div>
                ))}

              {!(bt?.paired ?? []).length && !(btDevices ?? []).length ? (
                <div style={styles.btEmpty}>
                  No devices yet. Put the stereo in pairing mode, then SCAN.
                </div>
              ) : null}
            </div>

            <div style={styles.btMsgLine}>{btBusy || btMsg || ' '}</div>

            <div style={styles.btActions}>
              <button
                type="button"
                style={{ ...styles.btActionBtn, ...(btBusy ? styles.actionBtnDisabled : null) }}
                disabled={!!btBusy || bt?.available === false}
                onClick={() => btCall('/api/bluetooth/scan', {}, 'SCANNING…')}
              >
                {btBusy === 'SCANNING…' ? 'SCANNING…' : 'SCAN'}
              </button>
              <button
                type="button"
                style={styles.btActionBtn}
                onClick={() => setBtOpen(false)}
              >
                CLOSE
              </button>
            </div>
          </div>
        ) : null}

        {confirm === 'reboot' ? (
          <div style={styles.dialog}>
            <div style={styles.dialogTitle}>REBOOT?</div>
            <div style={styles.confirmText}>
              The Pi will restart now. The display goes dark for about a minute.
            </div>
            <button type="button" style={styles.dialogConfirm} onClick={reboot}>
              CONFIRM REBOOT
            </button>
            <button type="button" style={styles.dialogCancel} onClick={() => setConfirm(null)}>
              CANCEL
            </button>
          </div>
        ) : null}

        {confirm === 'reinstall' ? (
          <div style={styles.dialog}>
            <div style={styles.dialogTitle}>REINSTALL?</div>
            <div style={styles.confirmText}>
              Pulls the latest code and re-runs full setup — packages, services,
              everything. Takes several minutes. Reboot after to apply it all.
            </div>
            <button type="button" style={styles.dialogConfirm} onClick={() => reinstall(false)}>
              CONFIRM REINSTALL
            </button>
            <button type="button" style={styles.dialogCancel} onClick={() => setConfirm(null)}>
              CANCEL
            </button>
          </div>
        ) : null}
      </div>
    </ScreenFrame>
  );
}

SettingsScreen.propTypes = {
  settings: PropTypes.shape({
    showMouse: PropTypes.bool,
    bootScreen: PropTypes.string,
  }).isRequired,
  onUpdate: PropTypes.func.isRequired,
  onBack: PropTypes.func,
  onReinstallStarted: PropTypes.func,
};

const AMBER = '#ffb300';
const MONO = "'Courier New', monospace";

const styles = {
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
  divider: { height: '1px', background: '#3a2800' },
  body: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'stretch',
    gap: '8px',
  },
  settingsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    flex: 1,
    minHeight: 0,
    gap: '8px',
  },
  settingsBtn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    width: '100%',
    minHeight: '58px',
    background: '#161208',
    border: '2px solid #3a2800',
    borderRadius: '10px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  rowLabel: {
    color: '#888',
    fontSize: '13px',
    fontFamily: MONO,
    fontWeight: 'bold',
    letterSpacing: '0.1em',
  },
  rowValue: {
    color: AMBER,
    fontSize: '18px',
    fontWeight: 'bold',
    fontFamily: MONO,
    maxWidth: '120px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowValueOn: { color: '#88ff88' },
  actions: {
    display: 'flex',
    flexShrink: 0,
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
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  forceBtn: {
    alignSelf: 'flex-start',
    flexShrink: 0,
    height: '24px',
    padding: '0 10px',
    background: '#2a0800',
    border: '1px solid #ff6644',
    borderRadius: '6px',
    color: '#ffaa88',
    fontSize: '9px',
    fontWeight: 'bold',
    fontFamily: MONO,
    letterSpacing: '0.06em',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  hint: {
    color: '#665533',
    fontSize: '10px',
    fontFamily: MONO,
    lineHeight: 1.4,
    flexShrink: 0,
  },

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
  confirmText: {
    flex: 1,
    minHeight: 0,
    color: '#ccc',
    fontFamily: MONO,
    fontSize: '13px',
    lineHeight: 1.5,
    overflowY: 'auto',
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
  btStatusLine: {
    flexShrink: 0,
    color: '#bbb',
    fontFamily: MONO,
    fontSize: '11px',
    letterSpacing: '0.05em',
    textAlign: 'center',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  btRow: {
    display: 'flex',
    gap: '8px',
    flexShrink: 0,
  },
  btDevBtn: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
    minWidth: 0,
    minHeight: '48px',
    padding: '10px 12px',
    background: '#161208',
    border: '2px solid #3a2800',
    borderRadius: '10px',
    color: '#eee',
    fontFamily: MONO,
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    textAlign: 'left',
  },
  btDevConnected: {
    background: '#0c2a0c',
    borderColor: '#44aa44',
    color: '#88ff88',
  },
  btForgetBtn: {
    flexShrink: 0,
    width: '48px',
    minHeight: '48px',
    background: '#2a0800',
    border: '2px solid #7a3322',
    borderRadius: '10px',
    color: '#ffaa88',
    fontSize: '16px',
    fontWeight: 'bold',
    fontFamily: MONO,
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  btEmpty: {
    color: '#665533',
    fontSize: '12px',
    fontFamily: MONO,
    lineHeight: 1.5,
    padding: '10px 4px',
  },
  btMsgLine: {
    flexShrink: 0,
    minHeight: '14px',
    maxHeight: '42px',
    overflowY: 'auto',
    color: '#bbb',
    fontSize: '10px',
    fontFamily: MONO,
    lineHeight: 1.4,
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  },
  btActions: {
    display: 'flex',
    gap: '10px',
    flexShrink: 0,
  },
  btActionBtn: {
    flex: 1,
    height: '48px',
    background: '#1a1000',
    border: '2px solid #7a5500',
    borderRadius: '10px',
    color: AMBER,
    fontSize: '15px',
    fontWeight: 'bold',
    fontFamily: MONO,
    letterSpacing: '0.08em',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  dialogConfirm: {
    flexShrink: 0,
    height: '56px',
    background: '#2a0800',
    border: '2px solid #ff6644',
    borderRadius: '10px',
    color: '#ffaa88',
    fontSize: '16px',
    fontWeight: 'bold',
    fontFamily: MONO,
    letterSpacing: '0.08em',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
};
