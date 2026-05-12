import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

const SIZE = 260;
const CX   = SIZE / 2;
const CY   = SIZE / 2;
const R    = 118;

function polarToXY(angleDeg, radius) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: CX + radius * Math.cos(rad),
    y: CY + radius * Math.sin(rad),
  };
}

export default function FactoryClock({ onMinus, onPlus }) {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const secs  = time.getSeconds();
  const mins  = time.getMinutes() + secs / 60;
  const hours = (time.getHours() % 12) + mins / 60;

  const secAngle  = secs  * 6;
  const minAngle  = mins  * 6;
  const hourAngle = hours * 30;

  const minorAngles = [30, 60, 120, 150, 210, 240, 300, 330];

  return (
    <div style={styles.root}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={styles.svg}
      >
        {/* Face */}
        <rect
          x={CX - R} y={CY - R}
          width={R * 2} height={R * 2}
          rx={R * 0.28}
          fill="#111"
          stroke="#2a2a2a"
          strokeWidth="1.5"
        />

        {/* Cardinal cross */}
        <line x1={CX} y1={CY - R * 0.92} x2={CX} y2={CY + R * 0.92}
          stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.75" />
        <line x1={CX - R * 0.92} y1={CY} x2={CX + R * 0.92} y2={CY}
          stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.75" />

        {/* Minor spokes */}
        {minorAngles.map(angle => {
          const p1 = polarToXY(angle, R * 0.22);
          const p2 = polarToXY(angle, R * 0.88);
          return (
            <line key={angle}
              x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
              stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.75"
            />
          );
        })}

        {/* Hour hand */}
        <line
          x1={polarToXY(hourAngle + 180, R * 0.12).x}
          y1={polarToXY(hourAngle + 180, R * 0.12).y}
          x2={polarToXY(hourAngle, R * 0.52).x}
          y2={polarToXY(hourAngle, R * 0.52).y}
          stroke="#fff" strokeWidth="7" strokeLinecap="round"
        />

        {/* Minute hand */}
        <line
          x1={polarToXY(minAngle + 180, R * 0.14).x}
          y1={polarToXY(minAngle + 180, R * 0.14).y}
          x2={polarToXY(minAngle, R * 0.76).x}
          y2={polarToXY(minAngle, R * 0.76).y}
          stroke="#fff" strokeWidth="5" strokeLinecap="round"
        />

        {/* Second hand */}
        <line
          x1={polarToXY(secAngle + 180, R * 0.18).x}
          y1={polarToXY(secAngle + 180, R * 0.18).y}
          x2={polarToXY(secAngle, R * 0.82).x}
          y2={polarToXY(secAngle, R * 0.82).y}
          stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.85"
        />

        {/* Center cap */}
        <circle cx={CX} cy={CY} r={7}   fill="#fff" />
        <circle cx={CX} cy={CY} r={3.5} fill="#111" />
      </svg>

      {/* OEM-style -/+ buttons */}
      <div style={styles.buttons}>
        <button style={styles.btn} onClick={onMinus}>−</button>
        <button style={styles.btn} onClick={onPlus}>+</button>
      </div>
    </div>
  );
}

FactoryClock.propTypes = {
  onMinus: PropTypes.func,
  onPlus: PropTypes.func,
};

const styles = {
  root: {
    width: '320px',
    height: '480px',
    background: '#000',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  svg: {
    filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.08))',
  },
  // Buttons sit at a fixed position below center, not in flow
  buttons: {
    position: 'absolute',
    bottom: '52px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '200px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  btn: {
    width: '56px',
    height: '28px',
    background: '#1a1a1a',
    border: '1px solid #444',
    borderRadius: '5px',
    color: '#fff',
    fontSize: '18px',
    lineHeight: 1,
    cursor: 'pointer',
    fontFamily: "'Courier New', monospace",
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
    userSelect: 'none',
  },
};
