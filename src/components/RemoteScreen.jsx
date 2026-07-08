/**
 * RemoteScreen — the REMOTE face. Shows a QR code encoding this Pi's kiosk URL
 * (http://<lan-ip>/) so a phone on the same WiFi can open the UI in a browser.
 * nginx serves the app to the whole LAN and the kiosk is multi-client, so
 * scanning is all it takes — no pairing or login.
 */

import { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import QRCode from 'qrcode';
import ScreenFrame from './ScreenFrame';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';
// Re-check while the face is up: WiFi can come and go (car vs. home network),
// and the QR must track the current address.
const POLL_MS = 10000;

export default function RemoteScreen({ onMinus, onPlus }) {
  const [info, setInfo] = useState(null);       // { hostname, ip, url } | null
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/network-info`, {
        headers: { Accept: 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error();
      setError('');
      setInfo((prev) => (prev?.url === data.url && prev?.hostname === data.hostname ? prev : data));
    } catch {
      setError('Could not reach the system service.');
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Regenerate the QR only when the URL actually changes.
  useEffect(() => {
    let cancelled = false;
    if (!info?.url) {
      setQrDataUrl(null);
      return undefined;
    }
    QRCode.toDataURL(info.url, {
      margin: 1,
      width: 152,
      color: { dark: '#000000', light: '#ffb300' },
    })
      .then((dataUrl) => { if (!cancelled) setQrDataUrl(dataUrl); })
      .catch(() => { if (!cancelled) setQrDataUrl(null); });
    return () => { cancelled = true; };
  }, [info?.url]);

  let body;
  if (error && !info) {
    body = <div style={styles.hint}>{error}</div>;
  } else if (!info) {
    body = <div style={styles.hint}>Checking network…</div>;
  } else if (!info.url) {
    body = <div style={styles.hint}>Not connected to a network.{'\n'}Join WiFi from the SYSTEM screen.</div>;
  } else {
    body = (
      <>
        <div style={styles.qrWrap}>
          {qrDataUrl
            ? <img src={qrDataUrl} alt={`QR code for ${info.url}`} style={styles.qr} />
            : <div style={styles.hint}>Generating…</div>}
        </div>
        <div style={styles.url}>{info.url.replace(/\/$/, '')}</div>
        <div style={styles.hint}>Scan on the same WiFi to open this UI in a browser.</div>
      </>
    );
  }

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
          <span style={styles.title}>REMOTE</span>
          <span style={styles.status}>{info?.hostname || ''}</span>
        </div>
        <div style={styles.divider} />
        <div style={styles.body}>{body}</div>
      </div>
    </ScreenFrame>
  );
}

RemoteScreen.propTypes = {
  onMinus: PropTypes.func,
  onPlus: PropTypes.func,
};

const AMBER = '#ffb300';
const MONO = "'Courier New', monospace";

const styles = {
  // Shared panel footprint — matches SystemScreen/DigitalClock so every screen lines up.
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
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  qrWrap: {
    width: '164px',
    height: '164px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: AMBER,
    borderRadius: '8px',
    padding: '6px',
    boxSizing: 'border-box',
  },
  qr: {
    width: '152px',
    height: '152px',
    display: 'block',
    imageRendering: 'pixelated',
  },
  url: {
    color: AMBER,
    fontSize: '16px',
    fontFamily: MONO,
    fontWeight: 'bold',
    letterSpacing: '0.02em',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  hint: {
    color: '#aa8844',
    fontSize: '11px',
    fontFamily: MONO,
    lineHeight: 1.5,
    textAlign: 'center',
    whiteSpace: 'pre-wrap',
  },
};
