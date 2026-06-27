/**
 * SpotifyPlayer — native Spotify Connect playback on the dash, controlled via
 * spotify-server.cjs (PKCE OAuth + Spotify Web API), with raspotify as the
 * actual Connect receiver/audio engine.
 *
 * Two states:
 *   - Not logged in: renders a QR code (PKCE authorize URL) the owner scans
 *     once with their phone. Polls /api/spotify/status until the OAuth
 *     callback completes, then flips to the player automatically — no button
 *     press needed on this screen.
 *   - Logged in: polls /api/spotify/now-playing for track/art/progress and
 *     drives play/pause/next/previous against the dash's Connect device.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import QRCode from 'qrcode';
import ScreenFrame from './ScreenFrame';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';
const NOW_PLAYING_POLL_MS = 3000;
const STATUS_POLL_MS = 4000;

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

export default function SpotifyPlayer({ onMinus, onPlus }) {
  // unknown | login | player
  const [phase, setPhase] = useState('unknown');
  const [qrDataUrl, setQrDataUrl] = useState(null);
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
        if (!qrDataUrl) loadLoginQr();
      }
    };
    check();
    if (phase !== 'player') {
      const id = setInterval(check, STATUS_POLL_MS);
      return () => { cancelled = true; clearInterval(id); };
    }
    return () => { cancelled = true; };
  }, [phase, qrDataUrl, loadLoginQr]);

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
            <div style={styles.qrBox}>
              {qrDataUrl ? <img src={qrDataUrl} alt="Scan to log in" style={styles.qrImg} /> : <div style={styles.qrPlaceholder}>…</div>}
            </div>
            <div style={styles.hint}>Scan with your phone{'\n'}to connect Spotify</div>
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
              <button type="button" style={styles.ctrlBtn} disabled={busy} onClick={() => sendTransport('previous')}>⏮</button>
              <button
                type="button"
                style={styles.ctrlBtnBig}
                disabled={busy}
                onClick={() => sendTransport('toggle')}
              >
                {nowPlaying?.playing ? '⏸' : '▶'}
              </button>
              <button type="button" style={styles.ctrlBtn} disabled={busy} onClick={() => sendTransport('next')}>⏭</button>
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

const AMBER = '#ffb300';
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
  error: { color: '#ff6644', fontSize: '11px', fontFamily: MONO, textAlign: 'center' },

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
  },
};
