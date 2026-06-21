import { useState, useEffect, useCallback } from 'react';

// Small overlay control to flip the CarPlay audio output between the analog
// adapter (AUX → Kenwood) and Bluetooth, without SSH. Talks to carplay-server.
const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';

const LABELS = { aux: 'AUX', bt: 'BT', hdmi: 'HDMI', unknown: '—' };
// Tap cycles AUX <-> BT (HDMI is reachable over SSH if ever needed).
const NEXT = { aux: 'bt', bt: 'aux', hdmi: 'aux', unknown: 'aux' };

export default function AudioToggle() {
  const [output, setOutput] = useState('unknown');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/audio-output`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.output) setOutput(data.output);
    } catch {
      // server not up yet — leave as-is
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const onTap = useCallback(async (e) => {
    e.stopPropagation();
    if (busy) return;
    const target = NEXT[output] || 'aux';
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/audio-output?target=${target}`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(target === 'bt' ? 'pair BT' : (data.error || 'failed'));
      } else if (data.output) {
        setOutput(data.output);
      }
    } catch {
      setMsg('error');
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(''), 2500);
    }
  }, [busy, output]);

  return (
    <button style={styles.btn} onClick={onTap} type="button" aria-label="audio output">
      {busy ? '…' : (msg || `♪ ${LABELS[output] || '—'}`)}
    </button>
  );
}

const styles = {
  btn: {
    position: 'absolute',
    top: '10px',
    right: '10px',
    zIndex: 50,
    minWidth: '62px',
    height: '30px',
    padding: '0 10px',
    background: '#1a1000',
    border: '1px solid #7a5500',
    borderRadius: '4px',
    color: '#ffb300',
    font: "13px 'Courier New', Courier, monospace",
    letterSpacing: '1px',
    cursor: 'pointer',
  },
};
