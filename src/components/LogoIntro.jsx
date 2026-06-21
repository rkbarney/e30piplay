import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import FactoryClock from './FactoryClock';

/*
  Boot timeline — the spinning roundel is now GATED on CarPlay readiness
  instead of a fixed timer:
    0.0s          fade in + spin/settle (min spin, looks intentional)
    >= SPIN_MS    if /api/carplay-ready hasn't returned 200 yet, keep spinning
                  (continuous loop) while polling
    ready 200     hold briefly, then fade the logo out / reveal the clock
    SPIN+GRACE    if still not ready after the min spin, keep looping briefly
                  then reveal the clock (~8s total — close to the old ~5.2s boot)
    SAFETY_MS     absolute backstop if /api/carplay-ready never responds
*/
const SPIN_MS = 3000; // minimum spin (the existing decel/settle animation)
const HOLD_MS = 400;  // brief hold once we decide to transition
const FADE_MS = 900;  // logo fade-out / clock reveal

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';
const POLL_INTERVAL_MS = 500;
// wlrctl often never sees react-carplay (503 forever) even when the AppImage is
// fine, so don't make the user stare at a spinner for 25s — match legacy boot time.
const MAX_WAIT_AFTER_SPIN_MS = 5000;
const SAFETY_TIMEOUT_MS = 10000; // API unreachable: reveal the clock regardless

// FactoryClock (the face the boot reveals) centers its SVG + gap + buttons as a
// flex column, so its face center sits above the screen center by half of the
// stuff below it: (gap 16 + button height 68) / 2 = 42px. Shift the roundel up
// by the same amount so the two centers coincide exactly across the transition.
const CLOCK_CENTER_OFFSET_Y = 42;

export default function LogoIntro({ onComplete }) {
  // looping: min spin elapsed but CarPlay not ready yet → keep spinning.
  // finishing: ready (or safety) → play the fade/reveal, then onComplete.
  const [looping, setLooping] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let pollTimer;
    let graceTimer;
    let fadeTimer;
    let ready = false;
    let minSpinDone = false;
    let finished = false;

    const finish = () => {
      if (cancelled || finished) return;
      finished = true;
      setFinishing(true);
      fadeTimer = setTimeout(() => onComplete?.(), HOLD_MS + FADE_MS);
    };

    const maybeFinish = () => {
      if (ready && minSpinDone) finish();
    };

    const minSpinTimer = setTimeout(() => {
      minSpinDone = true;
      // Not ready when the settle finishes → keep the roundel spinning briefly.
      if (!ready && !finished) {
        setLooping(true);
        graceTimer = setTimeout(() => {
          if (!cancelled && !finished) finish();
        }, MAX_WAIT_AFTER_SPIN_MS);
      }
      maybeFinish();
    }, SPIN_MS);

    const safetyTimer = setTimeout(() => {
      ready = true;
      minSpinDone = true;
      finish();
    }, SAFETY_TIMEOUT_MS);

    const poll = async () => {
      if (cancelled || finished) return;
      try {
        const res = await fetch(`${API_BASE}/api/carplay-ready`, { cache: 'no-store' });
        if (res.ok) {
          ready = true;
          maybeFinish();
          return;
        }
      } catch {
        // Backend not up yet — keep spinning and polling.
      }
      pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();

    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
      clearTimeout(graceTimer);
      clearTimeout(minSpinTimer);
      clearTimeout(safetyTimer);
      clearTimeout(fadeTimer);
    };
  }, [onComplete]);

  // While waiting past the settle, loop a constant spin; otherwise run the
  // one-shot decel/settle. `both` fill keeps the settled frame (upright) when
  // we finish straight from the settle without ever looping.
  const logoAnimation = looping
    ? 'spinLoop 1.1s linear infinite'
    : `spinSettle ${SPIN_MS}ms linear 0.1s both`;

  return (
    <div style={styles.root}>
      {/* Clock fades in from underneath as the logo fades out */}
      <div
        style={{
          ...styles.clockLayer,
          animation: finishing
            ? `clockReveal ${FADE_MS}ms ease-out ${HOLD_MS}ms both`
            : 'none',
          opacity: finishing ? undefined : 0,
        }}
      >
        <FactoryClock />
      </div>

      {/* Logo layer — spins (settle or loop), then fades */}
      <div
        style={{
          ...styles.logoLayer,
          animation: finishing
            ? `logoFadeOut ${FADE_MS}ms ease-in ${HOLD_MS}ms both`
            : 'none',
        }}
      >
        <img
          src="/BMW-Logo-1970-1989.png"
          alt="BMW"
          style={{ ...styles.logo, animation: logoAnimation }}
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
  },
};
