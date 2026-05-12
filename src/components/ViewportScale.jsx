import { useLayoutEffect, useState, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import KioskExit from './KioskExit.jsx';

const DW = 320;
const DH = 480;

/**
 * Scales the fixed 320×480 UI to fit the browser (any resolution / HDMI mode).
 * Scale is derived from the outer flex container's real size (ResizeObserver),
 * not window.innerWidth / visualViewport — those can disagree with Chrome device
 * mode's iframe dimensions (e.g. responsive width 291px while APIs report 320).
 */
export default function ViewportScale({ children }) {
  const outerRef = useRef(null);
  const [scale, setScale] = useState(1);

  const measure = useCallback(() => {
    const el = outerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (!(width > 0 && height > 0)) return;
    const s = Math.min(width / DW, height / DH);
    setScale(Number.isFinite(s) && s > 0 ? s : 1);
  }, []);

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const slotW = DW * scale;
  const slotH = DH * scale;

  return (
    <div className="viewport-scale-outer" ref={outerRef}>
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
