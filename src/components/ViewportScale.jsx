import { useEffect, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import KioskExit from './KioskExit.jsx';

const DW = 320;
const DH = 480;

/**
 * Scales the fixed 320×480 UI to fit the browser (any resolution / HDMI mode).
 */
export default function ViewportScale({ children }) {
  const [scale, setScale] = useState(1);

  const update = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const s = Math.min(vw / DW, vh / DH);
    setScale(Number.isFinite(s) && s > 0 ? s : 1);
  }, []);

  useEffect(() => {
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [update]);

  return (
    <div className="viewport-scale-outer">
      <div
        className="viewport-scale-inner"
        style={{
          width: DW,
          height: DH,
          transform: `scale(${scale})`,
        }}
      >
        {children}
        <KioskExit />
      </div>
    </div>
  );
}

ViewportScale.propTypes = {
  children: PropTypes.node,
};
