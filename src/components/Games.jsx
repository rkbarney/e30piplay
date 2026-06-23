/**
 * Games — ROM launcher backed by self-hosted EmulatorJS.
 *
 * Windowed mode (default): lists ROMs found in $APP_DIR/roms/ via GET /api/roms.
 * Selecting a ROM opens a fullscreen EmulatorJS iframe that fills the 320×480
 * display area, driven by keyboard or a USB NES-style gamepad via the browser's
 * Web Gamepad API (EmulatorJS handles all controller mapping internally).
 *
 * Exiting fullscreen: tap anywhere — a ~1 s launch-tap guard prevents the
 * accidental immediate exit. A "TAP TO EXIT" hint fades after 3 s.
 *
 * EmulatorJS assets (cores + loader) must be installed to public/emulatorjs/
 * before building. Run:  bash scripts/install-emulatorjs.sh
 * ROMs go in  $APP_DIR/roms/  (copied over SSH; never committed).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import ScreenFrame from './ScreenFrame';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';

// ─── Exit overlay (shown while a ROM is playing fullscreen) ───────────────────
function ExitOverlay({ onExit }) {
  // Block all pointer events for 1 s after mount so the launch tap doesn't
  // instantly bounce back out.
  const [ready,   setReady]   = useState(false);
  const [opacity, setOpacity] = useState(1);
  const mountTime             = useRef(Date.now());

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1000);
    return () => clearTimeout(t);
  }, []);

  // Fade the hint out after 2 s (opacity → 0 over 1 s transition = gone by 3 s).
  useEffect(() => {
    const t = setTimeout(() => setOpacity(0), 2000);
    return () => clearTimeout(t);
  }, []);

  const handlePointer = useCallback(() => {
    if (Date.now() - mountTime.current < 1000) return;
    onExit();
  }, [onExit]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: ready ? 'auto' : 'none',
      }}
      onClick={handlePointer}
    >
      <div
        style={{
          ...styles.exitHint,
          opacity,
          transition: 'opacity 1s ease',
        }}
      >
        TAP TO EXIT
      </div>
    </div>
  );
}

ExitOverlay.propTypes = { onExit: PropTypes.func.isRequired };

// ─── Main component ────────────────────────────────────────────────────────────
export default function Games({ onMinus, onPlus }) {
  const [roms,       setRoms]       = useState([]);
  const [fetchState, setFetchState] = useState('loading'); // loading | ok | error
  const [playingRom, setPlayingRom] = useState(null); // null | { name, url, core }

  useEffect(() => {
    let cancelled = false;
    setFetchState('loading');
    fetch(`${API_BASE}/api/roms`, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : (data.roms ?? []);
        setRoms(list);
        setFetchState('ok');
      })
      .catch(() => {
        if (!cancelled) setFetchState('error');
      });
    return () => { cancelled = true; };
  }, []);

  const handlePlay = useCallback((rom) => {
    setPlayingRom(rom);
  }, []);

  const handleExit = useCallback(() => {
    setPlayingRom(null);
  }, []);

  // ── Fullscreen mode ───────────────────────────────────────────────────────
  if (playingRom) {
    const src =
      `/emulator.html` +
      `?rom=${encodeURIComponent(playingRom.url)}` +
      `&core=${encodeURIComponent(playingRom.core)}` +
      `&name=${encodeURIComponent(playingRom.name)}`;

    return (
      <div style={styles.fullscreen}>
        <iframe
          title={playingRom.name}
          src={src}
          style={styles.iframe}
          allow="autoplay; gamepad"
        />
        <ExitOverlay onExit={handleExit} />
      </div>
    );
  }

  // ── Windowed launcher ─────────────────────────────────────────────────────
  let body;
  if (fetchState === 'loading') {
    body = <div style={styles.msg}>Loading…</div>;
  } else if (fetchState === 'error') {
    body = <div style={styles.msg}>Could not reach the games service.</div>;
  } else if (roms.length === 0) {
    body = (
      <div style={styles.empty}>
        <div style={styles.emptyTitle}>NO GAMES</div>
        <div style={styles.emptyBody}>
          Copy ROM files to the Pi over SSH:
        </div>
        <div style={styles.emptyPath}>~/e30piplay/roms/</div>
        <div style={styles.emptyBody}>
          Supported: .nes  .gb  .gbc  .sfc  .smc
        </div>
      </div>
    );
  } else {
    body = (
      <div style={styles.list}>
        {roms.map(rom => (
          <button
            key={rom.url}
            type="button"
            style={styles.romBtn}
            onClick={() => handlePlay(rom)}
          >
            <span style={styles.romName}>{rom.name}</span>
            <span style={styles.romCore}>{rom.core.toUpperCase()}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <ScreenFrame
      variant="mono"
      buttons={[
        { label: '−', onClick: onMinus },
        { label: '+', onClick: onPlus },
      ]}
    >
      <div style={styles.unit}>
        <div style={styles.headRow}>
          <span style={styles.title}>GAMES</span>
          {fetchState === 'ok' && roms.length > 0 && (
            <span style={styles.count}>{roms.length} ROM{roms.length !== 1 ? 'S' : ''}</span>
          )}
        </div>
        <div style={styles.divider} />
        <div style={styles.body}>
          {body}
        </div>
      </div>
    </ScreenFrame>
  );
}

Games.propTypes = {
  onMinus: PropTypes.func,
  onPlus:  PropTypes.func,
};

// ─── Styles ────────────────────────────────────────────────────────────────────
const MONO  = "'Courier New', monospace";
const WHITE = '#ffffff';

const styles = {
  // ── Fullscreen player ──────────────────────────────────────────────────
  fullscreen: {
    position: 'absolute',
    inset: 0,
    background: '#000',
    zIndex: 10,
  },
  iframe: {
    width: '100%',
    height: '100%',
    border: 'none',
    display: 'block',
  },
  exitHint: {
    position: 'absolute',
    top: '10px',
    left: '50%',
    transform: 'translateX(-50%)',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '9px',
    fontFamily: MONO,
    letterSpacing: '0.15em',
    pointerEvents: 'none',
  },

  // ── Windowed panel (matches SystemScreen footprint) ────────────────────
  unit: {
    position: 'relative',
    width: '300px',
    height: '320px',
    boxSizing: 'border-box',
    background: '#0d0d0d',
    border: '2px solid #2a2a2a',
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
  },
  title: {
    color: WHITE,
    fontSize: '17px',
    fontFamily: MONO,
    fontWeight: 'bold',
    letterSpacing: '0.2em',
  },
  count: {
    color: '#666',
    fontSize: '10px',
    fontFamily: MONO,
    letterSpacing: '0.04em',
  },
  divider: { height: '1px', background: '#2a2a2a' },
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },

  // ── ROM list ──────────────────────────────────────────────────────────
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  romBtn: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    padding: '10px 12px',
    background: '#161616',
    border: '1px solid #333',
    borderRadius: '8px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    textAlign: 'left',
    gap: '8px',
  },
  romName: {
    color: '#eee',
    fontSize: '12px',
    fontFamily: MONO,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  romCore: {
    flexShrink: 0,
    color: '#555',
    fontSize: '9px',
    fontFamily: MONO,
    letterSpacing: '0.08em',
  },

  // ── Status / empty messages ───────────────────────────────────────────
  msg: {
    color: '#555',
    fontSize: '12px',
    fontFamily: MONO,
    textAlign: 'center',
    marginTop: '40px',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
    paddingTop: '20px',
  },
  emptyTitle: {
    color: '#555',
    fontSize: '20px',
    fontFamily: MONO,
    fontWeight: 'bold',
    letterSpacing: '0.2em',
  },
  emptyBody: {
    color: '#444',
    fontSize: '10px',
    fontFamily: MONO,
    textAlign: 'center',
    lineHeight: 1.5,
  },
  emptyPath: {
    color: '#666',
    fontSize: '10px',
    fontFamily: MONO,
    background: '#161616',
    border: '1px solid #333',
    borderRadius: '4px',
    padding: '4px 8px',
  },
};
