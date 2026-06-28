/**
 * SpotifyPlayer — native Spotify Connect playback on the dash, controlled via
 * spotify-server.cjs (PKCE OAuth + Spotify Web API), with raspotify as the
 * actual Connect receiver/audio engine.
 *
 * Login UI follows spotify-server OAuth mode (inferred from redirect URI):
 *   - Pi (bouncer redirect): QR code — scan with phone; bouncer forwards to
 *     s52.local/spotify-callback over LAN/hotspot.
 *   - Docker (loopback redirect): "Open Spotify login" button — same machine
 *     browser only; no phone QR (127.0.0.1 on a phone is the phone itself).
 * Polls /api/spotify/status until OAuth completes, then shows the player.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import QRCode from 'qrcode';
import ScreenFrame from './ScreenFrame';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';
const NOW_PLAYING_POLL_MS = 3000;
const STATUS_POLL_MS = 4000;
const AMBER = '#ffb300';

async function getJson(path, opts) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    ...opts,
  });
  return res.json().catch(() => ({}));
}

function formatTime(ms) {
  if (ms == null) return '–:--';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

/** Inline SVG transport glyphs — Pi kiosk Chromium lacks emoji/font glyphs for ⏮▶⏸⏭. */
function TransportIcon({ kind }) {
  const common = {
    width: kind === 'play' || kind === 'pause' ? 28 : 22,
    height: kind === 'play' || kind === 'pause' ? 28 : 22,
    viewBox: '0 0 24 24',
    fill: AMBER,
    style: { display: 'block' },
    'aria-hidden': true,
  };
  if (kind === 'previous') {
    return (
      <svg {...common}>
        <path d="M6 6v12l8-6-8-6zm8 0v12l8-6-8-6z" />
      </svg>
    );
  }
  if (kind === 'next') {
    return (
      <svg {...common}>
        <path d="M4 6v12l8-6-8-6zm8 0v12l8-6-8-6z" />
      </svg>
    );
  }
  if (kind === 'pause') {
    return (
      <svg {...common}>
        <rect x="6" y="5" width="4" height="14" rx="1" />
        <rect x="14" y="5" width="4" height="14" rx="1" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M8 5v14l11-7-11-7z" />
    </svg>
  );
}

TransportIcon.propTypes = {
  kind: PropTypes.oneOf(['previous', 'play', 'pause', 'next']).isRequired,
};

export default function SpotifyPlayer({ onMinus, onPlus }) {
  // unknown | login | player
  const [phase, setPhase] = useState('unknown');
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [loginUrl, setLoginUrl] = useState('');
  const [loginLoopback, setLoginLoopback] = useState(false);
  const [loginRedirectUri, setLoginRedirectUri] = useState('');
  const [loginError, setLoginError] = useState('');
  const [nowPlaying, setNowPlaying] = useState(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);

  const loadLoginQr = useCallback(async () => {
    setLoginError('');
    try {
      const data = await getJson('/api/spotify/login-url');
      if (!data.ok) {
        setLoginError(data.error || 'Could not start login.');
        return;
      }
      setLoginUrl(data.url);
      setLoginLoopback(Boolean(data.loopback));
      setLoginRedirectUri(data.redirectUri || '');
      if (data.loopback) {
        setQrDataUrl(null);
        return;
      }
      const dataUrl = await QRCode.toDataURL(data.url, { margin: 1, width: 220 });
      setQrDataUrl(dataUrl);
    } catch {
      setLoginError('Could not reach the Spotify service.');
    }
  }, []);

  // Poll auth status until logged in (covers both the initial "are we logged
  // in" check and watching for the phone to finish the OAuth scan).
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const data = await getJson('/api/spotify/status').catch(() => null);
      if (cancelled) return;
      if (data?.authenticated) {
        setPhase('player');
      } else if (phase !== 'player') {
        setPhase('login');
        if (!loginUrl) loadLoginQr();
      }
    };
    check();
    if (phase !== 'player') {
      const id = setInterval(check, STATUS_POLL_MS);
      return () => { cancelled = true; clearInterval(id); };
    }
    return () => { cancelled = true; };
  }, [phase, loginUrl, loadLoginQr]);

  // Now-playing poll, only once logged in.
  useEffect(() => {
    if (phase !== 'player') return undefined;
    let cancelled = false;
    const tick = async () => {
      const data = await getJson('/api/spotify/now-playing').catch(() => null);
      if (cancelled) return;
      if (data?.authenticated === false) {
        setPhase('login');
        setQrDataUrl(null);
        setLoginUrl('');
        setLoginLoopback(false);
        setLoginRedirectUri('');
        return;
      }
      if (data?.ok) setNowPlaying(data);
    };
    tick();
    pollRef.current = setInterval(tick, NOW_PLAYING_POLL_MS);
    return () => { cancelled = true; clearInterval(pollRef.current); };
  }, [phase]);

  const sendTransport = useCallback(async (action) => {
    setBusy(true);
    try {
      await fetch(`${API_BASE}/api/spotify/${action}`, { method: 'POST', headers: { Accept: 'application/json' } });
    } catch {
      /* next poll reflects reality either way */
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <ScreenFrame variant="amber" buttons={[{ label: '−', onClick: onMinus }, { label: '+', onClick: onPlus }]}>
      <div style={styles.unit}>
        {phase === 'login' ? (
          <>
            <div style={styles.title}>SPOTIFY</div>
            {loginLoopback ? (
              <>
                <button
                  type="button"
                  style={styles.loginBtn}
                  disabled={!loginUrl}
                  onClick={() => { if (loginUrl) window.open(loginUrl, '_blank', 'noopener,noreferrer'); }}
                >
                  Open Spotify login
                </button>
                <div style={styles.hint}>Use a browser on this machine{'\n'}(not the phone QR)</div>
                {loginRedirectUri ? (
                  <div style={styles.redirectHint}>
                    Dashboard redirect URI must match exactly:{'\n'}
                    <span style={styles.redirectUri}>{loginRedirectUri}</span>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div style={styles.qrBox}>
                  {qrDataUrl ? <img src={qrDataUrl} alt="Scan to log in" style={styles.qrImg} /> : <div style={styles.qrPlaceholder}>…</div>}
                </div>
                <div style={styles.hint}>Scan with your phone{'\n'}to connect Spotify</div>
              </>
            )}
            {loginError ? <div style={styles.error}>{loginError}</div> : null}
          </>
        ) : (
          <>
            <div style={styles.artBox}>
              {nowPlaying?.artUrl ? (
                <img src={nowPlaying.artUrl} alt="" style={styles.art} />
              ) : (
                <div style={styles.artPlaceholder}>♪</div>
              )}
            </div>
            <div style={styles.track}>{nowPlaying?.track || (phase === 'unknown' ? 'Loading…' : 'Nothing playing')}</div>
            <div style={styles.artist}>{nowPlaying?.artists || ''}</div>
            <div style={styles.progressRow}>
              <span style={styles.time}>{formatTime(nowPlaying?.progressMs)}</span>
              <div style={styles.progressTrack}>
                <div style={{
                  ...styles.progressFill,
                  width: nowPlaying?.durationMs
                    ? `${Math.min(100, (100 * (nowPlaying.progressMs ?? 0)) / nowPlaying.durationMs)}%`
                    : '0%',
                }} />
              </div>
              <span style={styles.time}>{formatTime(nowPlaying?.durationMs)}</span>
            </div>
            <div style={styles.controls}>
              <button type="button" style={styles.ctrlBtn} disabled={busy} aria-label="Previous track" onClick={() => sendTransport('previous')}>
                <TransportIcon kind="previous" />
              </button>
              <button
                type="button"
                style={styles.ctrlBtnBig}
                disabled={busy}
                aria-label={nowPlaying?.playing ? 'Pause' : 'Play'}
                onClick={() => sendTransport('toggle')}
              >
                <TransportIcon kind={nowPlaying?.playing ? 'pause' : 'play'} />
              </button>
              <button type="button" style={styles.ctrlBtn} disabled={busy} aria-label="Next track" onClick={() => sendTransport('next')}>
                <TransportIcon kind="next" />
              </button>
            </div>
          </>
        )}
      </div>
    </ScreenFrame>
  );
}

SpotifyPlayer.propTypes = {
  onMinus: PropTypes.func,
  onPlus: PropTypes.func,
};

const MONO = "'Courier New', monospace";

const styles = {
  unit: {
    width: '300px',
    height: '320px',
    boxSizing: 'border-box',
    background: '#0d0d0d',
    border: '2px solid #3a2800',
    borderRadius: '12px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
  },
  title: {
    color: AMBER,
    fontSize: '17px',
    fontFamily: MONO,
    fontWeight: 'bold',
    letterSpacing: '0.2em',
    textShadow: `0 0 8px ${AMBER}66`,
  },
  qrBox: {
    width: '180px',
    height: '180px',
    background: '#fff',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  qrImg: { width: '100%', height: '100%' },
  qrPlaceholder: { color: '#888', fontFamily: MONO, fontSize: '14px' },
  hint: {
    color: '#aa8844',
    fontSize: '13px',
    fontFamily: MONO,
    textAlign: 'center',
    whiteSpace: 'pre-line',
    lineHeight: 1.4,
  },
  redirectHint: {
    color: '#887744',
    fontSize: '10px',
    fontFamily: MONO,
    textAlign: 'center',
    whiteSpace: 'pre-line',
    lineHeight: 1.35,
    maxWidth: '100%',
  },
  redirectUri: {
    color: AMBER,
    wordBreak: 'break-all',
  },
  error: { color: '#ff6644', fontSize: '11px', fontFamily: MONO, textAlign: 'center' },
  loginBtn: {
    width: '220px',
    padding: '14px 16px',
    borderRadius: '8px',
    background: '#2a1c00',
    border: `2px solid ${AMBER}`,
    color: AMBER,
    fontSize: '14px',
    fontFamily: MONO,
    fontWeight: 'bold',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },

  artBox: {
    width: '160px',
    height: '160px',
    borderRadius: '8px',
    overflow: 'hidden',
    background: '#161208',
    border: '2px solid #3a2800',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  art: { width: '100%', height: '100%', objectFit: 'cover' },
  artPlaceholder: { color: '#3a2800', fontSize: '48px' },
  track: {
    color: AMBER,
    fontSize: '16px',
    fontFamily: MONO,
    fontWeight: 'bold',
    maxWidth: '270px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  artist: {
    color: '#aa8844',
    fontSize: '13px',
    fontFamily: MONO,
    maxWidth: '270px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  progressRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  time: { color: '#776644', fontSize: '10px', fontFamily: MONO, flexShrink: 0 },
  progressTrack: {
    flex: 1,
    height: '4px',
    background: '#3a2800',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', background: AMBER },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginTop: '4px',
  },
  ctrlBtn: {
    width: '54px',
    height: '54px',
    borderRadius: '50%',
    background: '#1a1000',
    border: `2px solid #7a5500`,
    color: AMBER,
    fontSize: '20px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  ctrlBtnBig: {
    width: '68px',
    height: '68px',
    borderRadius: '50%',
    background: '#2a1c00',
    border: `2px solid ${AMBER}`,
    color: AMBER,
    fontSize: '26px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
};
