/**
 * Games — ROM launcher backed by self-hosted EmulatorJS.
 *
 * Windowed mode lists ROMs from GET /api/roms. Selecting a ROM opens EmulatorJS
 * inside ScreenFrame with SAVE / LOAD / EXIT replacing the usual − / + buttons.
 *
 * Saves: quick state slot 1 + battery/SRAM (auto-flush every 15 s and on exit).
 * Per-ROM game ids scope save data in browser storage.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import ScreenFrame from './ScreenFrame';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';
const PARENT_ORIGIN = window.location.origin;
const LED = '#ff5500';
const AMBER = '#ffb300';
const MONO = "'Courier New', monospace";

function titleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

function isEmulatorFrameMessage(e, iframe) {
  if (e.origin !== PARENT_ORIGIN) return false;
  const win = iframe?.contentWindow;
  return win != null && e.source === win;
}

function postEmulator(iframe, action) {
  iframe?.contentWindow?.postMessage({ type: 's52-emulator', action }, PARENT_ORIGIN);
}

export default function Games({ onMinus, onPlus }) {
  const [roms,       setRoms]       = useState([]);
  const [fetchState, setFetchState] = useState('loading');
  const [playingRom, setPlayingRom] = useState(null);
  const [hint,       setHint]       = useState('');
  const [emulatorReady, setEmulatorReady] = useState(false);
  const iframeRef = useRef(null);

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

  useEffect(() => {
    const onMsg = (e) => {
      if (!isEmulatorFrameMessage(e, iframeRef.current)) return;
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 's52-emulator-ready') {
        setEmulatorReady(true);
        return;
      }
      if (msg.type !== 's52-emulator-result') return;
      if (msg.action === 'save') {
        setHint(msg.ok ? 'SAVED' : 'SAVE FAILED');
      }
      if (msg.action === 'load') {
        setHint(msg.ok ? 'LOADED' : (msg.detail === 'no_state' ? 'NO SAVE' : msg.detail === 'not_ready' ? 'NOT READY' : 'LOAD FAILED'));
      }
      setTimeout(() => setHint(''), 1800);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const handlePlay = useCallback((rom) => {
    setHint('');
    setEmulatorReady(false);
    setPlayingRom(rom);
  }, []);

  const handleExit = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) {
      setPlayingRom(null);
      setEmulatorReady(false);
      setHint('');
      return;
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onResult);
      clearTimeout(fallback);
      setPlayingRom(null);
      setEmulatorReady(false);
      setHint('');
    };

    const onResult = (e) => {
      if (!isEmulatorFrameMessage(e, iframe)) return;
      const msg = e.data;
      if (msg?.type === 's52-emulator-result' && msg.action === 'saveBattery') {
        finish();
      }
    };

    window.addEventListener('message', onResult);
    postEmulator(iframe, 'saveBattery');
    const fallback = setTimeout(finish, 3000);
  }, []);

  const handleSave = useCallback(() => {
    if (!emulatorReady) {
      setHint('NOT READY');
      setTimeout(() => setHint(''), 1800);
      return;
    }
    postEmulator(iframeRef.current, 'save');
  }, [emulatorReady]);

  const handleLoad = useCallback(() => {
    if (!emulatorReady) {
      setHint('NOT READY');
      setTimeout(() => setHint(''), 1800);
      return;
    }
    postEmulator(iframeRef.current, 'load');
  }, [emulatorReady]);

  useEffect(() => {
    if (!playingRom) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') handleExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playingRom, handleExit]);

  if (playingRom) {
    const src =
      `/emulator.html` +
      `?rom=${encodeURIComponent(playingRom.url)}` +
      `&core=${encodeURIComponent(playingRom.core)}` +
      `&name=${encodeURIComponent(playingRom.name)}` +
      (playingRom.id ? `&id=${encodeURIComponent(playingRom.id)}` : '');

    return (
      <ScreenFrame
        variant="amber"
        buttons={[
          { label: 'SAVE', onClick: handleSave, key: 'save', disabled: !emulatorReady },
          { label: 'LOAD', onClick: handleLoad, key: 'load', disabled: !emulatorReady },
          { label: 'EXIT', onClick: handleExit, key: 'exit' },
        ]}
      >
        <div style={styles.gameWrap}>
          {hint ? <div style={styles.hint}>{hint}</div> : null}
          <iframe
            ref={iframeRef}
            title={playingRom.name}
            src={src}
            style={styles.iframe}
            allow="autoplay; gamepad"
          />
        </div>
      </ScreenFrame>
    );
  }

  let body;
  if (fetchState === 'loading') {
    body = <div style={styles.msg}>Loading…</div>;
  } else if (fetchState === 'error') {
    body = <div style={styles.msg}>Could not reach the games service.</div>;
  } else if (roms.length === 0) {
    body = (
      <div style={styles.empty}>
        <div style={styles.emptyTitle}>NO GAMES</div>
        <div style={styles.emptyBody}>Copy ROM files to the Pi over SSH:</div>
        <div style={styles.emptyPath}>~/e30piplay/roms/</div>
        <div style={styles.emptyBody}>Supported: .nes .gb .gbc .sfc .smc</div>
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
            <span style={styles.romName}>{titleCase(rom.name)}</span>
            <span style={styles.romCore}>{rom.core.toUpperCase()}</span>
          </button>
        ))}
      </div>
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
          <span style={styles.title}>GAMES</span>
          {fetchState === 'ok' && roms.length > 0 && (
            <span style={styles.count}>{roms.length} ROM{roms.length !== 1 ? 'S' : ''}</span>
          )}
        </div>
        <div style={styles.divider} />
        <div style={styles.body}>{body}</div>
      </div>
    </ScreenFrame>
  );
}

Games.propTypes = {
  onMinus: PropTypes.func,
  onPlus:  PropTypes.func,
};

const styles = {
  gameWrap: {
    position: 'relative',
    width: '300px',
    flex: 1,
    minHeight: 0,
    alignSelf: 'stretch',
    background: '#000',
  },
  iframe: {
    width: '100%',
    height: '100%',
    border: 'none',
    display: 'block',
  },
  hint: {
    position: 'absolute',
    top: '6px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 2,
    color: LED,
    fontSize: '11px',
    fontFamily: MONO,
    fontWeight: 'bold',
    letterSpacing: '0.14em',
    textShadow: `0 0 6px ${LED}`,
    pointerEvents: 'none',
  },

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
    fontSize: '20px',
    fontFamily: MONO,
    fontWeight: 'bold',
    letterSpacing: '0.2em',
    textShadow: `0 0 8px ${AMBER}66`,
  },
  count: {
    color: '#aa8844',
    fontSize: '12px',
    fontFamily: MONO,
    letterSpacing: '0.04em',
  },
  divider: { height: '1px', background: '#3a2800' },
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },

  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  romBtn: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    padding: '12px 14px',
    background: '#161208',
    border: '2px solid #3a2800',
    borderRadius: '10px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    textAlign: 'left',
    gap: '10px',
  },
  romName: {
    color: LED,
    fontSize: '15px',
    fontFamily: MONO,
    fontWeight: 'bold',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textShadow: `0 0 6px ${LED}88`,
  },
  romCore: {
    flexShrink: 0,
    color: '#aa8844',
    fontSize: '11px',
    fontFamily: MONO,
    letterSpacing: '0.08em',
  },

  msg: {
    color: '#aa8844',
    fontSize: '14px',
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
    color: LED,
    fontSize: '22px',
    fontFamily: MONO,
    fontWeight: 'bold',
    letterSpacing: '0.2em',
    textShadow: `0 0 8px ${LED}66`,
  },
  emptyBody: {
    color: '#888',
    fontSize: '12px',
    fontFamily: MONO,
    textAlign: 'center',
    lineHeight: 1.5,
  },
  emptyPath: {
    color: AMBER,
    fontSize: '12px',
    fontFamily: MONO,
    background: '#161208',
    border: '1px solid #3a2800',
    borderRadius: '6px',
    padding: '6px 10px',
  },
};
