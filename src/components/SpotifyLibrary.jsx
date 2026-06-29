/**
 * SpotifyLibrary — touch-scrollable list of the user's playlists and recently
 * played tracks, reachable from SpotifyPlayer. Tapping a row starts playback on
 * the dash unit (via /api/spotify/play-context) and hands back to the player.
 *
 * Touch note: the kiosk Chromium cancels taps as pan gestures when a tappable
 * element shares a surface with a scroll region under `touch-action:
 * manipulation`. Here the scroll container declares `touch-action: pan-y` (the
 * browser owns vertical panning) while rows handle onClick — a tap with no drag
 * still fires. Keep that split if you touch this layout.
 */

import { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';

async function getJson(path, opts) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    ...opts,
  });
  return res.json().catch(() => ({}));
}

const TABS = [
  { key: 'recent', label: 'RECENT', path: '/api/spotify/recently-played' },
  { key: 'playlists', label: 'PLAYLISTS', path: '/api/spotify/playlists' },
];

// offset-by-uri only works inside album/playlist contexts; for anything else
// (artist contexts, or no context at all) just play the single track.
function recentToPlayBody(it) {
  const ctx = it.contextUri || '';
  if (ctx.startsWith('spotify:album:') || ctx.startsWith('spotify:playlist:')) {
    return { contextUri: ctx, offsetUri: it.uri };
  }
  return { uris: [it.uri] };
}

export default function SpotifyLibrary({ onClose, onPlayed }) {
  const [tab, setTab] = useState('recent');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setItems([]);
    const def = TABS.find(t => t.key === tab);
    getJson(def.path)
      .then((data) => {
        if (cancelled) return;
        if (data?.ok && Array.isArray(data.items)) setItems(data.items);
        else if (data?.authenticated === false) setError('Not logged in.');
        else setError('Could not load.');
      })
      .catch(() => { if (!cancelled) setError('Could not reach Spotify.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tab]);

  const play = useCallback(async (key, body) => {
    setBusyKey(key);
    setError('');
    try {
      const data = await getJson('/api/spotify/play-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (data?.ok) onPlayed?.();
      else setError(data?.detail || 'Could not start playback.');
    } catch {
      setError('Could not reach Spotify.');
    } finally {
      setBusyKey(null);
    }
  }, [onPlayed]);

  return (
    <div style={styles.screen}>
      <div style={styles.list}>
        {loading ? (
          <div style={styles.note}>Loading…</div>
        ) : error ? (
          <div style={styles.note}>{error}</div>
        ) : items.length === 0 ? (
          <div style={styles.note}>Nothing here yet.</div>
        ) : tab === 'recent' ? (
          items.map((it, i) => (
            <Row
              key={`${it.uri}-${i}`}
              art={it.artUrl}
              title={it.track}
              subtitle={it.artists}
              busy={busyKey === `${it.uri}-${i}`}
              onClick={() => play(`${it.uri}-${i}`, recentToPlayBody(it))}
            />
          ))
        ) : (
          items.map(p => (
            <Row
              key={p.id}
              art={p.artUrl}
              liked={p.liked}
              title={p.name}
              subtitle={p.liked ? 'Saved songs' : (p.trackCount != null ? `${p.trackCount} tracks` : p.owner)}
              busy={busyKey === p.uri}
              onClick={() => play(p.uri, { contextUri: p.uri })}
            />
          ))
        )}
      </div>

      {/* Tab/close bar pinned to the bottom so it lines up with the player's
          −/+ band — right where the user's finger already is. */}
      <div style={styles.footer}>
        <div style={styles.tabs}>
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              style={{ ...styles.tab, ...(tab === t.key ? styles.tabActive : null) }}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" style={styles.closeBtn} aria-label="Back to player" onClick={onClose}>
          ×
        </button>
      </div>
    </div>
  );
}

// Heart drawn as inline SVG — the kiosk Chromium has no font for the ♥ glyph
// (same tofu problem as the transport icons), so the shape is drawn directly.
function HeartTile() {
  return (
    <div style={styles.thumbPlaceholder}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill={AMBER} aria-hidden="true">
        <path d="M12 21s-7.5-4.6-9.7-9.3C.9 8.3 2.6 5 6 5c2 0 3.3 1.2 4 2.5C10.7 6.2 12 5 14 5c3.4 0 5.1 3.3 3.7 6.7C19.5 16.4 12 21 12 21z" />
      </svg>
    </div>
  );
}

function Row({ art, liked, title, subtitle, busy, onClick }) {
  return (
    <button type="button" style={{ ...styles.row, ...(busy ? styles.rowBusy : null) }} onClick={onClick}>
      {liked ? (
        <HeartTile />
      ) : art ? (
        <img src={art} alt="" style={styles.thumb} />
      ) : (
        <div style={styles.thumbPlaceholder}>♪</div>
      )}
      <div style={styles.rowText}>
        <div style={styles.rowTitle}>{title || 'Unknown'}</div>
        {subtitle ? <div style={styles.rowSub}>{subtitle}</div> : null}
      </div>
    </button>
  );
}

Row.propTypes = {
  art: PropTypes.string,
  liked: PropTypes.bool,
  title: PropTypes.string,
  subtitle: PropTypes.string,
  busy: PropTypes.bool,
  onClick: PropTypes.func,
};

SpotifyLibrary.propTypes = {
  onClose: PropTypes.func,
  onPlayed: PropTypes.func,
};

const AMBER = '#ffb300';
const MONO = "'Courier New', monospace";

const styles = {
  screen: {
    position: 'relative',
    width: '320px',
    height: '480px',
    boxSizing: 'border-box',
    background: '#0d0d0d',
    fontFamily: MONO,
    display: 'flex',
    flexDirection: 'column',
  },
  footer: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    // Matches the player's navRow band (height 84, bottom padding 20) so the
    // tabs sit at the same vertical position as the −/+ buttons.
    padding: '12px 14px 20px',
    borderTop: '1px solid #3a2800',
  },
  tabs: { flex: 1, display: 'flex', gap: '8px' },
  tab: {
    flex: 1,
    height: '48px',
    borderRadius: '8px',
    background: 'rgba(20,12,0,0.6)',
    border: `1px solid ${AMBER}55`,
    color: '#aa8844',
    fontFamily: MONO,
    fontWeight: 'bold',
    fontSize: '13px',
    letterSpacing: '0.1em',
    cursor: 'pointer',
    padding: 0,
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
  },
  tabActive: {
    color: AMBER,
    border: `1px solid ${AMBER}`,
    background: 'rgba(42,28,0,0.85)',
    textShadow: `0 0 6px ${AMBER}66`,
  },
  closeBtn: {
    flexShrink: 0,
    width: '48px',
    height: '48px',
    borderRadius: '8px',
    background: 'rgba(20,12,0,0.6)',
    border: `1px solid ${AMBER}99`,
    color: AMBER,
    fontFamily: MONO,
    fontSize: '24px',
    lineHeight: 1,
    cursor: 'pointer',
    padding: 0,
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
  },
  // The scroll surface. `pan-y` lets the browser own vertical scrolling while
  // taps (no drag) still reach the row buttons — see the file header note.
  list: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    touchAction: 'pan-y',
    WebkitOverflowScrolling: 'touch',
    padding: '8px',
  },
  note: {
    color: '#aa8844',
    fontFamily: MONO,
    fontSize: '14px',
    textAlign: 'center',
    padding: '32px 16px',
  },
  row: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    height: '64px',
    boxSizing: 'border-box',
    padding: '8px',
    marginBottom: '6px',
    borderRadius: '8px',
    background: 'rgba(20,12,0,0.5)',
    border: '1px solid #2a1c00',
    cursor: 'pointer',
    textAlign: 'left',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
  },
  rowBusy: { borderColor: AMBER, background: 'rgba(42,28,0,0.85)' },
  thumb: {
    width: '48px',
    height: '48px',
    flexShrink: 0,
    borderRadius: '4px',
    objectFit: 'cover',
  },
  thumbPlaceholder: {
    width: '48px',
    height: '48px',
    flexShrink: 0,
    borderRadius: '4px',
    background: '#161208',
    color: '#3a2800',
    fontSize: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' },
  rowTitle: {
    color: AMBER,
    fontFamily: MONO,
    fontWeight: 'bold',
    fontSize: '15px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowSub: {
    color: '#aa8844',
    fontFamily: MONO,
    fontSize: '12px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
};
