import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

const SIZE = 300;      // SVG canvas — bezel reaches near the 320px edge
const CX   = SIZE / 2; // center x
const CY   = SIZE / 2; // center y
const R    = 143;      // outer face radius

function polarToXY(angleDeg, radius) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: CX + radius * Math.cos(rad),
    y: CY + radius * Math.sin(rad),
  };
}

function Hand({ angleDeg, length, width, color, shadow = false }) {
  const tip  = polarToXY(angleDeg, length);
  const tail = polarToXY(angleDeg + 180, length * 0.18);
  return (
    <line
      x1={tail.x} y1={tail.y}
      x2={tip.x}  y2={tip.y}
      stroke={shadow ? '#000' : color}
      strokeWidth={shadow ? width + 2 : width}
      strokeLinecap="round"
      opacity={shadow ? 0.4 : 1}
    />
  );
}

Hand.propTypes = {
  angleDeg: PropTypes.number.isRequired,
  length: PropTypes.number.isRequired,
  width: PropTypes.number.isRequired,
  color: PropTypes.string.isRequired,
  shadow: PropTypes.bool,
};

export default function AnalogClock({ onMinus, onPlus }) {
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

  const hh = String(time.getHours()).padStart(2, '0');
  const mm = String(time.getMinutes()).padStart(2, '0');
  const ss = String(time.getSeconds()).padStart(2, '0');

  // Hour markers at 12, 3, 6, 9
  const majorMarkers = [0, 90, 180, 270]; // angles
  const majorLabels  = ['12', '3', '6', '9'];

  // Minor tick marks (all 60 positions minus major)
  const minorTicks = Array.from({ length: 60 }, (_, i) => i * 6)
    .filter(a => ![0, 90, 180, 270].includes(a));

  return (
    <div style={styles.root}>
      {/* Top label */}
      <div style={styles.topLabel}>S52 SOLUTIONS</div>

      {/* Clock face */}
      <svg
        width={SIZE}
        height={SIZE}
        style={styles.svg}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
      >
        <defs>
          <radialGradient id="faceGrad" cx="50%" cy="45%" r="55%">
            <stop offset="0%" stopColor="#1a1000" />
            <stop offset="100%" stopColor="#000000" />
          </radialGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Outer bezel */}
        <circle cx={CX} cy={CY} r={R + 6} fill="#111" stroke="#444" strokeWidth="4" />
        {/* Face */}
        <circle cx={CX} cy={CY} r={R} fill="url(#faceGrad)" stroke="#ffb300" strokeWidth="2" opacity="0.85" />

        {/* Minor ticks */}
        {minorTicks.map(angle => {
          const outer = polarToXY(angle, R - 4);
          const inner = polarToXY(angle, R - 13);
          return (
            <line
              key={angle}
              x1={outer.x} y1={outer.y}
              x2={inner.x} y2={inner.y}
              stroke="#6b4a00"
              strokeWidth="2.2"
            />
          );
        })}

        {/* Major markers (12/3/6/9) */}
        {majorMarkers.map((angle, i) => {
          const outer = polarToXY(angle, R - 3);
          const inner = polarToXY(angle, R - 18);
          const lPos  = polarToXY(angle, R - 30);
          return (
            <g key={angle}>
              <line
                x1={outer.x} y1={outer.y}
                x2={inner.x} y2={inner.y}
                stroke="#ffb300"
                strokeWidth="5"
                strokeLinecap="round"
              />
              <text
                x={lPos.x} y={lPos.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#ffb300"
                fontSize="18"
                fontFamily="'Courier New', monospace"
                fontWeight="bold"
              >
                {majorLabels[i]}
              </text>
            </g>
          );
        })}

        {/* Hour hand (shadow + fill) */}
        <Hand angleDeg={hourAngle} length={66}  width={11} color="#ffb300" shadow />
        <Hand angleDeg={hourAngle} length={66}  width={9} color="#ffb300" />

        {/* Minute hand */}
        <Hand angleDeg={minAngle}  length={88}  width={8} color="#ffb300" shadow />
        <Hand angleDeg={minAngle}  length={88}  width={6} color="#ffb300" />

        {/* Second hand */}
        <Hand angleDeg={secAngle}  length={96}  width={4} color="#ff3333" shadow />
        <Hand angleDeg={secAngle}  length={96}  width={3} color="#ff3333" />

        {/* Center cap */}
        <circle cx={CX} cy={CY} r={9} fill="#ffb300" />
        <circle cx={CX} cy={CY} r={4.5} fill="#000" />
      </svg>

      {/* Digital readout */}
      <div style={styles.digital}>
        <span style={styles.digitalTime}>{hh}:{mm}</span>
        <span style={styles.digitalSec}>{ss}</span>
      </div>

      {/* OEM-style buttons */}
      <div style={styles.buttons}>
        <button style={styles.btn} onClick={onMinus} type="button">−</button>
        <button style={styles.btn} onClick={onPlus} type="button">+</button>
      </div>
    </div>
  );
}

AnalogClock.propTypes = {
  onMinus: PropTypes.func,
  onPlus: PropTypes.func,
};

const styles = {
  root: {
    width: '320px',
    height: '480px',
    background: '#000',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontFamily: "'Courier New', monospace",
  },
  topLabel: {
    color: '#ffb300',
    fontSize: '11px',
    letterSpacing: '0.3em',
    fontWeight: 'bold',
  },
  svg: {
    filter: 'drop-shadow(0 0 6px #ffb30060)',
  },
  digital: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '4px',
  },
  digitalTime: {
    color: '#ffb300',
    fontSize: '30px',
    fontWeight: 'bold',
    letterSpacing: '0.12em',
    fontFamily: "'Courier New', monospace",
    textShadow: '0 0 12px #ffb30080',
  },
  digitalSec: {
    color: '#7a5500',
    fontSize: '18px',
    letterSpacing: '0.05em',
    fontFamily: "'Courier New', monospace",
  },
  buttons: {
    width: '300px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  btn: {
    width: '128px',
    height: '66px',
    background: '#1a1000',
    border: '2px solid #7a5500',
    borderRadius: '12px',
    color: '#ffb300',
    fontSize: '44px',
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
