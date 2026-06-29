/**
 * SpotifyPlayer — native Spotify Connect playback on the dash, controlled via
 * spotify-server.cjs (PKCE OAuth + Spotify Web API), with raspotify as the
 * actual Connect receiver/audio engine.
 *
 * Login is a phone-scannable QR code: it points at the richardbarney.com
 * HTTPS bouncer, which forwards back to s52.local/spotify-callback over the
 * LAN/hotspot to finish the token exchange (Spotify requires an HTTPS
 * authorize redirect, which the Pi has no way to serve on its own).
 * Polls /api/spotify/status until OAuth completes, then shows the player.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import QRCode from 'qrcode';
import ScreenFrame from './ScreenFrame';
import SpotifyLibrary from './SpotifyLibrary';

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

// Inline SVG transport icons. The Pi's kiosk Chromium has no font with the
// Unicode media glyphs (⏮ ⏯ ⏭), so those render as empty "tofu" squares —
// drawing the shapes ourselves makes the buttons font-independent.
const ICON_PATHS = {
  previous: 'M6 6h2v12H6zm3.5 6l8.5 6V6z',
  next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  library: 'M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z',
};

function TransportIcon({ name, size = 24 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

TransportIcon.propTypes = {
  name: PropTypes.oneOf(['previous', 'next', 'play', 'pause', 'library']).isRequired,
  size: PropTypes.number,
};

export default function SpotifyPlayer({ onMinus, onPlus }) {
  // unknown | login | player
  const [phase, setPhase] = useState('unknown');
  // player | library — sub-view once logged in; the now-playing player is the default.
  const [view, setView] = useState('player');
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [loginUrl, setLoginUrl] = useState('');
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

  if (phase === 'login') {
    return (
      <ScreenFrame variant="amber" buttons={[{ label: '−', onClick: onMinus }, { label: '+', onClick: onPlus }]}>
        <div style={styles.unit}>
          <div style={styles.title}>SPOTIFY</div>
          <div style={styles.qrBox}>
            {qrDataUrl ? <img src={qrDataUrl} alt="Scan to log in" style={styles.qrImg} /> : <div style={styles.qrPlaceholder}>…</div>}
          </div>
          <div style={styles.hint}>Scan with your phone{'\n'}to connect Spotify</div>
          {loginError ? <div style={styles.error}>{loginError}</div> : null}
        </div>
      </ScreenFrame>
    );
  }

  if (view === 'library') {
    return (
      <SpotifyLibrary
        onClose={() => setView('player')}
        onPlayed={() => setView('player')}
      />
    );
  }

  const pct = nowPlaying?.durationMs
    ? Math.min(100, (100 * (nowPlaying.progressMs ?? 0)) / nowPlaying.durationMs)
    : 0;

  // The player intentionally does NOT use ScreenFrame: the album art fills the
  // entire 320×480 screen edge-to-edge, and the nav (−/+) buttons float over
  // the artwork's bottom scrim instead of sitting in a separate black band.
  return (
    <div style={styles.screen}>
      {nowPlaying?.artUrl ? (
        <img src={nowPlaying.artUrl} alt="" style={styles.artBg} />
      ) : (
        <div style={styles.artBgPlaceholder}>♪</div>
      )}
      <div style={styles.scrim} />

      <div style={styles.topInfo}>
        <div style={styles.track}>{nowPlaying?.track || (phase === 'unknown' ? 'Loading…' : 'Nothing playing')}</div>
        <div style={styles.artist}>{nowPlaying?.artists || ''}</div>
      </div>

      <div style={styles.overlay}>
        <div style={styles.controls}>
          <button type="button" style={styles.ctrlBtn} disabled={busy} aria-label="Previous" onClick={() => sendTransport('previous')}>
            <TransportIcon name="previous" size={34} />
          </button>
          <button
            type="button"
            style={styles.ctrlBtnBig}
            disabled={busy}
            aria-label={nowPlaying?.playing ? 'Pause' : 'Play'}
            onClick={() => sendTransport('toggle')}
          >
            <TransportIcon name={nowPlaying?.playing ? 'pause' : 'play'} size={50} />
          </button>
          <button type="button" style={styles.ctrlBtn} disabled={busy} aria-label="Next" onClick={() => sendTransport('next')}>
            <TransportIcon name="next" size={34} />
          </button>
        </div>
        <div style={styles.progressRow}>
          <span style={styles.time}>{formatTime(nowPlaying?.progressMs)}</span>
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressFill, width: `${pct}%` }} />
          </div>
          <span style={styles.time}>{formatTime(nowPlaying?.durationMs)}</span>
        </div>
      </div>

      <div style={styles.navRow}>
        <button type="button" style={styles.navBtn} aria-label="Previous screen" onClick={onMinus}>−</button>
        <button type="button" style={styles.libBtn} aria-label="Library" onClick={() => setView('library')}>
          <TransportIcon name="library" size={22} />
        </button>
        <button type="button" style={styles.navBtn} aria-label="Next screen" onClick={onPlus}>+</button>
      </div>
    </div>
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

  // Full-bleed player: album art fills the entire 320×480 screen, with a dark
  // gradient scrim so the track info, transport controls, and floating nav
  // buttons stay legible over any artwork.
  screen: {
    position: 'relative',
    width: '320px',
    height: '480px',
    overflow: 'hidden',
    background: '#0d0d0d',
    fontFamily: MONO,
  },
  artBg: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  artBgPlaceholder: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#3a2800',
    fontSize: '120px',
    background: '#161208',
  },
  scrim: {
    position: 'absolute',
    inset: 0,
    background:
      'linear-gradient(to bottom, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.5) 16%, rgba(0,0,0,0) 40%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.5) 84%, rgba(0,0,0,0.95) 100%)',
  },
  // Transport controls live dead-center over the artwork; the progress bar
  // sits just below them.
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    transform: 'translateY(-50%)',
    padding: '0 16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '22px',
  },
  // Title + artist pinned near the top (against the top scrim) so they don't
  // sit over the middle of the artwork.
  topInfo: {
    position: 'absolute',
    top: '16px',
    left: 0,
    right: 0,
    padding: '0 16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    boxSizing: 'border-box',
  },
  track: {
    color: AMBER,
    fontSize: '22px',
    fontFamily: MONO,
    fontWeight: 'bold',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textShadow: '0 1px 4px rgba(0,0,0,0.9)',
  },
  artist: {
    color: '#d8b070',
    fontSize: '17px',
    fontFamily: MONO,
    fontWeight: 'bold',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textShadow: '0 1px 4px rgba(0,0,0,0.9)',
  },
  progressRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  time: {
    color: '#e8d0a0',
    fontSize: '12px',
    fontFamily: MONO,
    flexShrink: 0,
    textShadow: '0 1px 3px rgba(0,0,0,0.9)',
  },
  progressTrack: {
    flex: 1,
    height: '4px',
    background: 'rgba(255,255,255,0.25)',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', background: AMBER },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  ctrlBtn: {
    width: '72px',
    height: '72px',
    borderRadius: '50%',
    background: 'rgba(26,16,0,0.75)',
    border: `2px solid #7a5500`,
    color: AMBER,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
  },
  ctrlBtnBig: {
    width: '100px',
    height: '100px',
    borderRadius: '50%',
    background: 'rgba(42,28,0,0.85)',
    border: `2px solid ${AMBER}`,
    color: AMBER,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
  },

  // Nav (−/+) row, floating over the bottom of the artwork instead of the
  // usual ScreenFrame black band.
  navRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '84px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 14px 20px',
    boxSizing: 'border-box',
  },
  navBtn: {
    width: '108px',
    height: '48px',
    borderRadius: '12px',
    background: 'rgba(20,12,0,0.55)',
    border: `2px solid ${AMBER}99`,
    color: AMBER,
    fontFamily: MONO,
    fontWeight: 'bold',
    fontSize: '34px',
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
  },
  // Library shortcut, centered between the −/+ nav buttons.
  libBtn: {
    width: '52px',
    height: '48px',
    borderRadius: '12px',
    background: 'rgba(20,12,0,0.55)',
    border: `2px solid ${AMBER}99`,
    color: AMBER,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
  },
};
