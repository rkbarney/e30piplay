import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import ScreenFrame from './ScreenFrame';

const LED = '#ff5500';
// Height of each 7-segment digit in px (viewBox aspect is 14:24 → width = SEG_H * 14/24)
const SEG_H = 78;

// AM/PM label height as a proportion of SEG_H — sized like a "5th character slot"
const AMPM_SCALE = 0.42;
// a=top, b=top-right, c=bot-right, d=bottom, e=bot-left, f=top-left, g=middle
const DIGIT_SEGS = [
  [1,1,1,1,1,1,0], // 0
  [0,1,1,0,0,0,0], // 1
  [1,1,0,1,1,0,1], // 2
  [1,1,1,1,0,0,1], // 3
  [0,1,1,0,0,1,1], // 4
  [1,0,1,1,0,1,1], // 5
  [1,0,1,1,1,1,1], // 6
  [1,1,1,0,0,0,0], // 7
  [1,1,1,1,1,1,1], // 8
  [1,1,1,1,0,1,1], // 9
];

// SevenSeg renders one LED digit using SVG segment shapes.
// digit=null renders all segments at dim opacity (blank/ghost cell).
function SevenSeg({ digit, height }) {
  const w = Math.round(height * 14 / 24);
  const segs = (digit != null && digit >= 0 && digit <= 9)
    ? DIGIT_SEGS[digit]
    : [0,0,0,0,0,0,0];
  const op = (i) => segs[i] ? 1 : 0.07;

  return (
    <svg
      width={w}
      height={height}
      viewBox="0 0 14 24"
      fill={LED}
      style={{ filter: `drop-shadow(0 0 3px ${LED}cc)`, display: 'block', flexShrink: 0 }}
    >
      {/* a – top */}
      <rect x="1"  y="0"  width="12" height="2" rx="1" opacity={op(0)} />
      {/* b – top-right */}
      <rect x="12" y="1"  width="2" height="10" rx="1" opacity={op(1)} />
      {/* c – bot-right */}
      <rect x="12" y="13" width="2" height="10" rx="1" opacity={op(2)} />
      {/* d – bottom */}
      <rect x="1"  y="22" width="12" height="2" rx="1" opacity={op(3)} />
      {/* e – bot-left */}
      <rect x="0"  y="13" width="2" height="10" rx="1" opacity={op(4)} />
      {/* f – top-left */}
      <rect x="0"  y="1"  width="2" height="10" rx="1" opacity={op(5)} />
      {/* g – middle */}
      <rect x="1"  y="11" width="12" height="2" rx="1" opacity={op(6)} />
    </svg>
  );
}

SevenSeg.propTypes = {
  digit: PropTypes.oneOf([0,1,2,3,4,5,6,7,8,9,null]),
  height: PropTypes.number.isRequired,
};

export default function DigitalClock({ onMinus, onPlus }) {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hours  = time.getHours();
  const mins   = time.getMinutes();
  const isPM   = hours >= 12;
  const h12    = hours % 12 || 12;

  // Four digit positions — leading hour digit is null (blank) for 1–9
  const hTens  = h12 >= 10 ? Math.floor(h12 / 10) : null;
  const hUnits = h12 % 10;
  const mTens  = Math.floor(mins / 10);
  const mUnits = mins % 10;

  return (
    <ScreenFrame
      variant="amber"
      buttons={[
        { label: '−', onClick: onMinus },
        { label: '+', onClick: onPlus },
      ]}
    >
      {/* ── Display module ── */}
      <div style={styles.unit}>

        {/* Top: 7-segment time + AM/PM label to the right */}
        <div style={styles.displayRow}>
          <div style={styles.timeDisplay}>
            <SevenSeg digit={hTens}  height={SEG_H} />
            <SevenSeg digit={hUnits} height={SEG_H} />
            {/* period decimal-point separator between HH and MM */}
            <div style={styles.period} />
            <SevenSeg digit={mTens}  height={SEG_H} />
            <SevenSeg digit={mUnits} height={SEG_H} />
          </div>
          {/* AM/PM inline label to the right of digits */}
          <div style={styles.ampm}>{isPM ? 'PM' : 'AM'}</div>
        </div>

        {/* Divider */}
        <div style={styles.divider} />

        {/* All button rows in one flex container that fills remaining height */}
        <div style={styles.btnSection}>
          {/* 3×3 pill grid rows */}
          {[
            ['HR-DATE', 'AVG MPH', 'M MPH'],
            ['AVG MPG', 'RANGE',   'TIMER'],
            ['TEMP',    'CODE',    'SET-RES'],
          ].map((row) => (
            <div key={row[0]} style={styles.btnRow}>
              {row.map(label => (
                <button key={label} style={styles.gridBtn}>{label}</button>
              ))}
            </div>
          ))}

          {/* Number row — 4 narrower buttons */}
          <div style={styles.btnRow}>
            {['1000', '100', '10', '1'].map(label => (
              <button key={label} style={styles.numBtn}>{label}</button>
            ))}
          </div>
        </div>
      </div>
    </ScreenFrame>
  );
}

DigitalClock.propTypes = {
  onMinus: PropTypes.func,
  onPlus: PropTypes.func,
};

const styles = {
  // Shared panel footprint — matches SystemScreen so every screen lines up.
  unit: {
    width: '300px',
    height: '320px',
    boxSizing: 'border-box',
    background: '#000',
    border: '1px solid #2a2a2a',
    borderRadius: '8px',
    padding: '14px 16px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
  },

  displayRow: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '8px',
  },

  timeDisplay: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '2px',
  },

  // Small LED decimal-point dot sitting at the bottom of the digit row
  period: {
    width: '5px',
    height: '5px',
    borderRadius: '2px',
    background: LED,
    flexShrink: 0,
    boxShadow: `0 0 5px ${LED}`,
    marginBottom: '3px',
  },

  // Single inline AM/PM label to the right of the digits
  ampm: {
    color: LED,
    fontSize: `${Math.round(SEG_H * AMPM_SCALE)}px`,
    fontFamily: "'Courier New', monospace",
    fontWeight: 'bold',
    letterSpacing: '0.04em',
    textShadow: `0 0 6px ${LED}`,
    lineHeight: 1,
    flexShrink: 0,
    marginBottom: '4px',
  },

  divider: {
    height: '1px',
    background: '#2a2a2a',
    margin: '8px -2px 10px',
  },

  btnSection: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  btnRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '6px',
  },
  gridBtn: {
    flex: 1,
    height: '28px',
    background: '#000',
    border: '1px solid #333',
    borderRadius: '14px',
    color: '#fff',
    fontSize: '18px',
    fontFamily: "'Courier New', monospace",
    fontWeight: 'bold',
    letterSpacing: '0',
    cursor: 'default',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
    overflow: 'hidden',
  },

  numBtn: {
    flex: 1,
    height: '24px',
    background: '#000',
    border: '1px solid #333',
    borderRadius: '12px',
    color: '#fff',
    fontSize: '15px',
    fontFamily: "'Courier New', monospace",
    fontWeight: 'bold',
    letterSpacing: '0',
    cursor: 'default',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
    overflow: 'hidden',
  },
};

