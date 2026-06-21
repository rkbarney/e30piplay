import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import FactoryClock from './FactoryClock';

/*
  Animation timeline (~5.2s total):
  0.0 – 0.2s   fade in
  0.2 – 3.2s   spinSettle — blast fast, continuous decel, settle (3s)
  3.2 – 3.8s   hold clear logo
  3.8 – 4.8s   logo fades out, clock fades in
*/
const SPIN_MS   = 3000;
const HOLD_MS   = 600;
const FADE_MS   = 900;
const TOTAL_MS  = SPIN_MS + HOLD_MS + FADE_MS + 200; // +200 for initial fade-in

// FactoryClock (the face the boot reveals) centers its SVG + gap + buttons as a
// flex column, so its face center sits above the screen center by half of the
// stuff below it: (gap 16 + button height 68) / 2 = 42px. Shift the roundel up
// by the same amount so the two centers coincide exactly across the transition.
const CLOCK_CENTER_OFFSET_Y = 42;

export default function LogoIntro({ onComplete }) {
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => onComplete?.(), TOTAL_MS);
    return () => clearTimeout(timerRef.current);
  }, [onComplete]);

  return (
    <div style={styles.root}>
      {/* Clock fades in from underneath as logo fades out */}
      <div style={styles.clockLayer}>
        <FactoryClock />
      </div>

      {/* Logo layer — spins, settles, fades */}
      <div style={styles.logoLayer}>
        <img
          src="/BMW-Logo-1970-1989.png"
          alt="BMW"
          style={styles.logo}
        />
      </div>
    </div>
  );
}

LogoIntro.propTypes = {
  onComplete: PropTypes.func,
};

const styles = {
  root: {
    width: '320px',
    height: '480px',
    // White during boot so the unavoidable startup white flash blends in.
    background: '#fff',
    position: 'relative',
    overflow: 'hidden',
  },
  clockLayer: {
    position: 'absolute',
    inset: 0,
    animation: `clockReveal ${FADE_MS}ms ease-out ${SPIN_MS + HOLD_MS}ms both`,
  },
  logoLayer: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    // Lift to the clock face center; logoFadeOut only animates opacity so this
    // transform is preserved throughout the spin/fade.
    transform: `translateY(-${CLOCK_CENTER_OFFSET_Y}px)`,
    animation: `logoFadeOut ${FADE_MS}ms ease-in ${SPIN_MS + HOLD_MS}ms both`,
  },
  logo: {
    // The source PNG is 16:9 with the roundel centered in wide transparent
    // side margins (roundel ≈55% of image width, ≈98% of height). `contain`
    // therefore sized the roundel to the image width and left it small.
    // `cover` crops the empty margins so the roundel fills the box edge-to-edge.
    width: '318px',
    height: '318px',
    objectFit: 'cover',
    // Soft shadow gives the white roundel segments definition on white.
    filter: 'drop-shadow(0 3px 10px rgba(0,0,0,0.30))',
    // linear so each keyframe's rotation value controls pacing directly
    animation: `spinSettle ${SPIN_MS}ms linear 0.1s both`,
  },
};
