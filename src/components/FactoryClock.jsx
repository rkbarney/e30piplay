import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import ScreenFrame from './ScreenFrame';

const SIZE = 320;        // SVG canvas — full design width
const CX   = SIZE / 2;
const CY   = SIZE / 2;
const R    = 150;        // half the OEM square face — nearly edge-to-edge

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
    <ScreenFrame
      variant="mono"
      buttons={[
        { label: '−', onClick: onMinus },
        { label: '+', onClick: onPlus },
      ]}
    >
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
          fill="#0d0d0d"
          stroke="#3a3a3a"
          strokeWidth="3"
        />

        {/* Cardinal cross */}
        <line x1={CX} y1={CY - R * 0.92} x2={CX} y2={CY + R * 0.92}
          stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity="0.9" />
        <line x1={CX - R * 0.92} y1={CY} x2={CX + R * 0.92} y2={CY}
          stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity="0.9" />

        {/* Minor spokes */}
        {minorAngles.map(angle => {
          const p1 = polarToXY(angle, R * 0.22);
          const p2 = polarToXY(angle, R * 0.88);
          return (
            <line key={angle}
              x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
              stroke="#fff" strokeWidth="3.5" strokeLinecap="round" opacity="0.85"
            />
          );
        })}

        {/* Hour hand */}
        <line
          x1={polarToXY(hourAngle + 180, R * 0.12).x}
          y1={polarToXY(hourAngle + 180, R * 0.12).y}
          x2={polarToXY(hourAngle, R * 0.52).x}
          y2={polarToXY(hourAngle, R * 0.52).y}
          stroke="#fff" strokeWidth="12" strokeLinecap="round"
        />

        {/* Minute hand */}
        <line
          x1={polarToXY(minAngle + 180, R * 0.14).x}
          y1={polarToXY(minAngle + 180, R * 0.14).y}
          x2={polarToXY(minAngle, R * 0.78).x}
          y2={polarToXY(minAngle, R * 0.78).y}
          stroke="#fff" strokeWidth="8" strokeLinecap="round"
        />

        {/* Second hand */}
        <line
          x1={polarToXY(secAngle + 180, R * 0.18).x}
          y1={polarToXY(secAngle + 180, R * 0.18).y}
          x2={polarToXY(secAngle, R * 0.84).x}
          y2={polarToXY(secAngle, R * 0.84).y}
          stroke="#ff3333" strokeWidth="3.5" strokeLinecap="round"
        />

        {/* Center cap */}
        <circle cx={CX} cy={CY} r={11} fill="#fff" />
        <circle cx={CX} cy={CY} r={5}  fill="#0d0d0d" />
      </svg>
    </ScreenFrame>
  );
}

FactoryClock.propTypes = {
  onMinus: PropTypes.func,
  onPlus: PropTypes.func,
};

const styles = {
  svg: {
    filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.10))',
  },
};
