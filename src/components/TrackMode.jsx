import { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';

// ── constants ─────────────────────────────────────────────────────────────────
const MS_TO_MPH     = 2.23694;          // m/s → mph
const MPH_60        = 60;               // target speed for 0-60 timer
const MS_60         = MPH_60 / MS_TO_MPH;   // ≈ 26.82 m/s
const ARMED_MPH     = 1.5;             // arm the timer when slower than this
const ARMED_MS      = ARMED_MPH / MS_TO_MPH;
const START_MPH     = 3;               // begin timing above this
const START_MS      = START_MPH / MS_TO_MPH;
const POLL_MS       = 500;             // GPS poll interval
const G             = 9.80665;         // m/s² per g
const MAX_G_DISPLAY = 9.9;             // cap g-force display at this value (single digit + one decimal)
const MIN_HDG_CHANGE_DEG = 2;         // ignore heading changes smaller than this (GPS noise when stationary)
const MAX_G_SANITY  = 3.0;             // reject derived g values above this as noise spikes (> 3g implausible on road)
const LOG_INTERVAL_MS = 5000;          // auto-log a point every 5 s when logging

// Heading degrees → compass label
function bearingLabel(deg) {
  if (deg === null || deg === undefined) return '—';
  const labels = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return labels[Math.round(deg / 22.5) % 16];
}

// Smallest signed angle difference in degrees
function angleDiff(a, b) {
  let d = (a - b + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

// Fix mode → text + colour
function modeLabel(mode) {
  if (mode >= 3) return { text: '3D', color: '#00e676' };
  if (mode === 2) return { text: '2D', color: '#ffb300' };
  return { text: 'NO FIX', color: '#ef5350' };
}

// ── 0-60 state machine ────────────────────────────────────────────────────────
// idle → armed (stopped) → timing (moving) → done (≥ 60 mph)
const TIMER_IDLE   = 'idle';
const TIMER_ARMED  = 'armed';
const TIMER_TIMING = 'timing';
const TIMER_DONE   = 'done';

export default function TrackMode({ onMinus, onPlus }) {
  const [fix,       setFix]       = useState(null);   // latest GPS fix
  const [gforce,    setGforce]    = useState(null);   // derived g-force
  const [timer,     setTimer]     = useState({ state: TIMER_IDLE, startMs: null, elapsed: null });
  const [logging,   setLogging]   = useState(false);
  const [logCount,  setLogCount]  = useState(0);

  const prevFixRef  = useRef(null);
  const prevTimeRef = useRef(null);  // wall-clock time of previous GPS poll
  const lastLogRef  = useRef(0);     // wall-clock time of last drive-log write

  // ── poll GPS ───────────────────────────────────────────────────────────────
  const poll = useCallback(async () => {
    const wallNow = Date.now();
    let data;
    try {
      const r = await fetch(`${API_BASE}/api/gps`, { signal: AbortSignal.timeout(3000) });
      data = await r.json();
    } catch {
      return; // transient network error — keep previous fix
    }

    const prev = prevFixRef.current;
    const prevWall = prevTimeRef.current;

    // ── derive g-force ───────────────────────────────────────────────────────
    if (
      data.mode >= 2 &&
      prev?.mode >= 2 &&
      typeof data.speed === 'number' &&
      typeof prev.speed === 'number' &&
      prevWall
    ) {
      const dt = (wallNow - prevWall) / 1000;  // seconds
      if (dt > 0.05) {
        const dv      = data.speed - prev.speed;                   // m/s
        const aLong   = dv / dt;                                   // m/s²

        // lateral: centripetal if heading changed meaningfully
        let aLat = 0;
        if (typeof data.track === 'number' && typeof prev.track === 'number') {
          const dHeadDeg = angleDiff(data.track, prev.track);
          // Ignore small heading changes — GPS heading is noisy when near-stationary
          if (Math.abs(dHeadDeg) >= MIN_HDG_CHANGE_DEG) {
            const dHeadRad = (dHeadDeg * Math.PI) / 180;
            const vAvg     = (data.speed + prev.speed) / 2;
            aLat = vAvg * (dHeadRad / dt);
          }
        }

        const gVal = Math.sqrt(aLong * aLong + aLat * aLat) / G;
        // Reject implausibly high spikes (GPS noise, bad fix, etc.)
        if (gVal <= MAX_G_SANITY) {
          setGforce(Math.min(gVal, MAX_G_DISPLAY));
        }
      }
    }

    // ── 0-60 timer ───────────────────────────────────────────────────────────
    const speed = data.mode >= 2 ? (data.speed ?? 0) : 0;
    setTimer(prev => {
      switch (prev.state) {
        case TIMER_IDLE:
          if (speed < ARMED_MS) return { ...prev, state: TIMER_ARMED };
          return prev;
        case TIMER_ARMED:
          if (speed >= START_MS) {
            return { state: TIMER_TIMING, startMs: wallNow, elapsed: null };
          }
          // If we speed up past armed but then come back below, stay armed.
          return prev;
        case TIMER_TIMING: {
          const elapsed = (wallNow - prev.startMs) / 1000;
          if (speed >= MS_60) {
            return { ...prev, state: TIMER_DONE, elapsed };
          }
          return { ...prev, elapsed };
        }
        case TIMER_DONE:
          // Auto-re-arm when we slow to a stop again
          if (speed < ARMED_MS) return { state: TIMER_ARMED, startMs: null, elapsed: prev.elapsed };
          return prev;
        default:
          return prev;
      }
    });

    // ── drive logging ─────────────────────────────────────────────────────────
    if (logging && data.mode >= 2 && wallNow - lastLogRef.current >= LOG_INTERVAL_MS) {
      lastLogRef.current = wallNow;
      const point = {
        time:  data.time ?? new Date().toISOString(),
        lat:   data.lat,
        lon:   data.lon,
        alt:   data.alt,
        speed: data.speed,
        track: data.track,
      };
      fetch(`${API_BASE}/api/drive-log`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(point),
      }).then(() => setLogCount(c => c + 1)).catch(() => {});
    }

    prevFixRef.current  = data;
    prevTimeRef.current = wallNow;
    setFix(data);
  }, [logging]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  // ── handlers ──────────────────────────────────────────────────────────────
  const resetTimer = useCallback(() => {
    setTimer({ state: TIMER_IDLE, startMs: null, elapsed: null });
  }, []);

  const toggleLogging = useCallback(() => {
    setLogging(l => !l);
  }, []);

  const exportLog = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/drive-log`);
      const data = await r.json();
      const blob = new Blob([JSON.stringify(data.points, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `drive-log-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  }, []);

  // ── derived display values ────────────────────────────────────────────────
  const speedMph = (fix?.mode >= 2 && fix.speed != null)
    ? (fix.speed * MS_TO_MPH).toFixed(1)
    : '—';

  const altM  = (fix?.mode >= 2 && fix.alt != null)
    ? Math.round(fix.alt) + ' m'
    : '—';

  const hdg = (fix?.mode >= 2 && fix.track != null)
    ? `${Math.round(fix.track)}° ${bearingLabel(fix.track)}`
    : '—';

  const gDisplay = gforce != null ? gforce.toFixed(2) + ' g' : '—';

  const { text: modeText, color: modeColor } = modeLabel(fix?.mode ?? 0);

  // Timer display
  const timerState = timer.state;
  let timerDisplay = '—';
  if (timerState === TIMER_TIMING && timer.startMs) {
    const live = (Date.now() - timer.startMs) / 1000;
    timerDisplay = live.toFixed(2) + ' s';
  } else if ((timerState === TIMER_DONE || timerState === TIMER_TIMING) && timer.elapsed != null) {
    timerDisplay = timer.elapsed.toFixed(2) + ' s';
  }

  const timerColor =
    timerState === TIMER_ARMED  ? '#ffb300' :
    timerState === TIMER_TIMING ? '#00e676' :
    timerState === TIMER_DONE   ? '#64b5f6' :
    '#777';

  const timerLabel =
    timerState === TIMER_ARMED  ? 'ARMED'  :
    timerState === TIMER_TIMING ? 'TIMING' :
    timerState === TIMER_DONE   ? 'DONE'   :
    'IDLE';

  return (
    <div style={S.root}>

      {/* ── Header ── */}
      <div style={S.header}>
        <span style={S.headerTitle}>TRACK MODE</span>
        <span style={{ ...S.fixBadge, color: modeColor, borderColor: modeColor }}>
          {modeText}
        </span>
      </div>

      {/* ── Big speed ── */}
      <div style={S.speedBlock}>
        <div style={S.speedNum}>{speedMph}</div>
        <div style={S.speedUnit}>MPH</div>
      </div>

      {/* ── Divider ── */}
      <div style={S.divider} />

      {/* ── Heading / Alt / G-force ── */}
      <div style={S.infoGrid}>
        <InfoRow label="HDG"     value={hdg}      />
        <InfoRow label="ALT"     value={altM}     />
        <InfoRow label="G-FORCE" value={gDisplay} />
      </div>

      {/* ── Divider ── */}
      <div style={S.divider} />

      {/* ── 0-60 timer ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>0-60 TIMER</div>
        <div style={S.timerRow}>
          <span style={{ ...S.timerBadge, color: timerColor, borderColor: timerColor }}>
            {timerLabel}
          </span>
          <span style={{ ...S.timerValue, color: timerColor }}>{timerDisplay}</span>
          <button style={S.smallBtn} onClick={resetTimer} type="button">RESET</button>
        </div>
      </div>

      {/* ── Divider ── */}
      <div style={S.divider} />

      {/* ── Drive log ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>DRIVE LOG</div>
        <div style={S.logRow}>
          <button
            style={{ ...S.smallBtn, ...(logging ? S.smallBtnActive : null) }}
            onClick={toggleLogging}
            type="button"
          >
            {logging ? '● REC' : '○ REC'}
          </button>
          <span style={S.logCount}>{logCount} pts</span>
          <button style={S.smallBtn} onClick={exportLog} type="button">EXPORT</button>
        </div>
      </div>

      {/* ── Nav buttons ── */}
      <div style={S.navButtons}>
        <button style={S.navBtn} onClick={onMinus} type="button">−</button>
        <button style={S.navBtn} onClick={onPlus}  type="button">+</button>
      </div>

    </div>
  );
}

TrackMode.propTypes = {
  onMinus: PropTypes.func,
  onPlus:  PropTypes.func,
};

// ── sub-component ─────────────────────────────────────────────────────────────
function InfoRow({ label, value }) {
  return (
    <div style={S.infoRow}>
      <span style={S.infoLabel}>{label}</span>
      <span style={S.infoValue}>{value}</span>
    </div>
  );
}
InfoRow.propTypes = { label: PropTypes.string.isRequired, value: PropTypes.node };

// ── styles ────────────────────────────────────────────────────────────────────
const AMBER = '#ffb300';
const MONO  = "'Courier New', monospace";

const S = {
  root: {
    width:      '320px',
    height:     '480px',
    background: '#000',
    position:   'relative',
    display:    'flex',
    flexDirection: 'column',
    alignItems: 'center',
    boxSizing:  'border-box',
    padding:    '8px 12px 0',
    gap:        '6px',
  },

  // Header
  header: {
    width:          '100%',
    display:        'flex',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  headerTitle: {
    color:       AMBER,
    fontSize:    '11px',
    fontFamily:  MONO,
    letterSpacing: '0.2em',
    textShadow:  `0 0 6px ${AMBER}66`,
  },
  fixBadge: {
    fontSize:     '9px',
    fontFamily:   MONO,
    letterSpacing: '0.1em',
    border:       '1px solid',
    borderRadius: '3px',
    padding:      '1px 5px',
  },

  // Speed
  speedBlock: {
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    flex:           1,
    minHeight:      '120px',
  },
  speedNum: {
    color:       '#fff',
    fontSize:    '96px',
    fontFamily:  MONO,
    fontWeight:  'bold',
    lineHeight:  1,
    letterSpacing: '-4px',
    textShadow:  '0 0 18px rgba(255,255,255,0.25)',
  },
  speedUnit: {
    color:       '#555',
    fontSize:    '14px',
    fontFamily:  MONO,
    letterSpacing: '0.3em',
    marginTop:   '2px',
  },

  divider: {
    width:      '100%',
    height:     '1px',
    background: '#1e1e1e',
  },

  // Info grid (HDG / ALT / G-FORCE)
  infoGrid: {
    width:         '100%',
    display:       'flex',
    flexDirection: 'column',
    gap:           '4px',
  },
  infoRow: {
    display:        'flex',
    justifyContent: 'space-between',
    alignItems:     'baseline',
  },
  infoLabel: {
    color:       '#555',
    fontSize:    '9px',
    fontFamily:  MONO,
    letterSpacing: '0.1em',
  },
  infoValue: {
    color:       '#ccc',
    fontSize:    '13px',
    fontFamily:  MONO,
  },

  // Sections
  section: {
    width:         '100%',
    display:       'flex',
    flexDirection: 'column',
    gap:           '5px',
  },
  sectionTitle: {
    color:       '#555',
    fontSize:    '9px',
    fontFamily:  MONO,
    letterSpacing: '0.15em',
  },

  // Timer
  timerRow: {
    display:     'flex',
    alignItems:  'center',
    gap:         '8px',
  },
  timerBadge: {
    fontSize:    '9px',
    fontFamily:  MONO,
    letterSpacing: '0.1em',
    border:      '1px solid',
    borderRadius: '3px',
    padding:     '1px 5px',
    flexShrink:  0,
  },
  timerValue: {
    fontSize:    '22px',
    fontFamily:  MONO,
    fontWeight:  'bold',
    flex:        1,
    textAlign:   'center',
  },

  // Log row
  logRow: {
    display:     'flex',
    alignItems:  'center',
    gap:         '8px',
  },
  logCount: {
    color:       '#555',
    fontSize:    '10px',
    fontFamily:  MONO,
    flex:        1,
    textAlign:   'center',
  },

  // Shared small button
  smallBtn: {
    height:      '24px',
    padding:     '0 8px',
    background:  '#1a1000',
    border:      `1px solid #7a5500`,
    borderRadius: '4px',
    color:       AMBER,
    fontSize:    '9px',
    fontFamily:  MONO,
    letterSpacing: '0.08em',
    cursor:      'pointer',
    WebkitTapHighlightColor: 'transparent',
    userSelect:  'none',
    flexShrink:  0,
  },
  smallBtnActive: {
    background:  '#2a0000',
    borderColor: '#ef5350',
    color:       '#ef5350',
  },

  // Nav buttons
  navButtons: {
    position:       'absolute',
    bottom:         '10px',
    left:           '50%',
    transform:      'translateX(-50%)',
    width:          '296px',
    display:        'flex',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  navBtn: {
    width:       '128px',
    height:      '48px',
    background:  '#1a1000',
    border:      `2px solid #7a5500`,
    borderRadius: '10px',
    color:       AMBER,
    fontSize:    '32px',
    lineHeight:  1,
    cursor:      'pointer',
    fontFamily:  MONO,
    display:     'flex',
    alignItems:  'center',
    justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
    userSelect:  'none',
  },
};
