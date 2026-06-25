import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import ScreenFrame from './ScreenFrame';

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
  const minStr = String(mins).padStart(2, '0');

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

        {/* Top: AM/PM pip + time */}
        <div style={styles.displayRow}>
          <div style={styles.pips}>
            <div style={{ ...styles.pip, opacity: isPM ? 0.2 : 1 }}>AM</div>
            <div style={{ ...styles.pip, opacity: isPM ? 1   : 0.2 }}>PM</div>
          </div>
          <div style={styles.timeDisplay}>
            <span style={styles.digits}>{h12}</span>
            <span style={styles.colon}>:</span>
            <span style={styles.digits}>{minStr}</span>
          </div>
        </div>

        {/* Divider */}
        <div style={styles.divider} />

        {/* All button rows in one flex container that fills remaining height */}
        <div style={styles.btnSection}>
          {/* 3×3 pill grid rows */}
          {[
            ['HOUR',  'DATE',  'TEMP'],
            ['SPEED', 'RANGE', 'TIMER'],
            ['LAP',   'DIST',  'SET'],
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

const LED = '#ff5500';

const styles = {
  // Shared panel footprint — matches SystemScreen so every screen lines up.
  unit: {
    width: '300px',
    height: '320px',
    boxSizing: 'border-box',
    background: '#0d0d0d',
    border: '1px solid #2a2a2a',
    borderRadius: '8px',
    padding: '14px 16px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
  },

  displayRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  pips: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    flexShrink: 0,
  },
  pip: {
    color: LED,
    fontSize: '7px',
    fontFamily: "'Courier New', monospace",
    letterSpacing: '0.03em',
    textShadow: `0 0 4px ${LED}`,
    lineHeight: 1.2,
    transition: 'opacity 0.3s',
  },

  timeDisplay: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '1px',
  },
  digits: {
    color: LED,
    fontSize: '80px',
    fontFamily: "'Courier New', monospace",
    fontWeight: 'bold',
    lineHeight: 1,
    textShadow: `0 0 12px ${LED}99`,
    letterSpacing: '-2px',
    minWidth: '58px',
    textAlign: 'right',
  },
  colon: {
    color: LED,
    fontSize: '70px',
    fontFamily: "'Courier New', monospace",
    fontWeight: 'bold',
    lineHeight: 1,
    textShadow: `0 0 12px ${LED}`,
    paddingBottom: '4px',
    animation: 'blink 1s step-end infinite',
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
    background: '#1c1c1c',
    border: '1px solid #404040',
    borderRadius: '14px',
    color: '#bbb',
    fontSize: '8px',
    fontFamily: "'Courier New', monospace",
    letterSpacing: '0.06em',
    cursor: 'default',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
  },

  numBtn: {
    flex: 1,
    height: '24px',
    background: '#1c1c1c',
    border: '1px solid #404040',
    borderRadius: '12px',
    color: '#bbb',
    fontSize: '8px',
    fontFamily: "'Courier New', monospace",
    letterSpacing: '0.04em',
    cursor: 'default',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
  },
};
