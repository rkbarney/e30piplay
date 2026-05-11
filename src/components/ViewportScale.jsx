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
    const vv = window.visualViewport;
    const vw = vv?.width ?? window.innerWidth;
    const vh = vv?.height ?? window.innerHeight;
    const s = Math.min(vw / DW, vh / DH);
    setScale(Number.isFinite(s) && s > 0 ? s : 1);
  }, []);

  useEffect(() => {
    update();
    window.addEventListener('resize', update);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, [update]);

  const slotW = DW * scale;
  const slotH = DH * scale;

  return (
    <div className="viewport-scale-outer">
      {/* Slot is the real painted size. Flex centers this instead of the pre-scale
          320×480 box — avoids asymmetric clipping when scale≠1 and overflow:hidden
          interacted with transform on the same element (Chrome device mode). */}
      <div
        className="viewport-scale-slot"
        style={{
          width: slotW,
          height: slotH,
        }}
      >
        <div
          className="viewport-scale-inner"
          style={{
            width: DW,
            height: DH,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {children}
          <KioskExit />
        </div>
      </div>
    </div>
  );
}

ViewportScale.propTypes = {
  children: PropTypes.node,
};
