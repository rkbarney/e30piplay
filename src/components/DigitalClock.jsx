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

        {/* Button grid — 3 rows × 2 cols, matching OEM labels */}
        <div style={styles.btnGrid}>
          {[
            ['h/DAT',  'min/DAT'],
            ['HOUR',   'DATE'],
            ['TEMP',   'MEMO'],
          ].map(([left, right]) => (
            <div key={left} style={styles.btnRow}>
              <button style={styles.gridBtn}>{left}</button>
              <button style={styles.gridBtn}>{right}</button>
            </div>
          ))}
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
  // The whole OEM unit — expanded to fill most of the screen width
  unit: {
    width: '296px',
    background: '#0d0d0d',
    border: '1px solid #2a2a2a',
    borderRadius: '8px',
    padding: '14px 16px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
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
    margin: '0 -2px',
  },

  btnGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  btnRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '8px',
  },
  gridBtn: {
    flex: 1,
    height: '20px',
    background: '#1c1c1c',
    border: '1px solid #383838',
    borderRadius: '3px',
    color: '#aaa',
    fontSize: '7px',
    fontFamily: "'Courier New', monospace",
    letterSpacing: '0.05em',
    cursor: 'default',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
  },
};
