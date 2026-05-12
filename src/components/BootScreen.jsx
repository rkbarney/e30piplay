/**
 * BootScreen — S52 SOLUTIONS / M-TECH OEM splash.
 *
 * Visually mirrors the Plymouth theme (scripts/s52-boot-branding.sh →
 * /usr/share/plymouth/themes/s52-tech) so the handoff from Plymouth →
 * Chromium is continuous: same logo, same spinner, same amber.
 *
 * Holds until /api/carplay-ready returns 200 (the react-carplay AppImage
 * has been registered with labwc as a toplevel — i.e. tapping `+` will be
 * instant). 60s safety timeout falls through to the clock anyway so a
 * broken backend never bricks the UI.
 */

import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';
const POLL_INTERVAL_MS = 500;
const SAFETY_TIMEOUT_MS = 60000;
const FADE_OUT_MS = 350;

const SPINNER_DOTS = 12;
const SPINNER_RADIUS = 28;
const SPINNER_SPEED_MS = 80;

export default function BootScreen({ onComplete }) {
  const [tick, setTick] = useState(0);
  const [fading, setFading] = useState(false);
  const handedOffRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), SPINNER_SPEED_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pollTimer;
    let safetyTimer;
    let fadeTimer;

    const finish = () => {
      if (cancelled || handedOffRef.current) return;
      handedOffRef.current = true;
      setFading(true);
      fadeTimer = setTimeout(() => onComplete?.(), FADE_OUT_MS);
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`${API_BASE}/api/carplay-ready`, {
          cache: 'no-store',
        });
        if (res.ok) {
          finish();
          return;
        }
      } catch {
        // Network not ready yet — keep spinning.
      }
      pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    poll();
    safetyTimer = setTimeout(finish, SAFETY_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
      clearTimeout(safetyTimer);
      clearTimeout(fadeTimer);
    };
  }, [onComplete]);

  const lit = tick % SPINNER_DOTS;

  return (
    <div style={{ ...styles.root, opacity: fading ? 0 : 1 }}>
      <div style={styles.brand}>S52 SOLUTIONS</div>
      <div style={styles.sub}>M&nbsp;-&nbsp;T&nbsp;E&nbsp;C&nbsp;H</div>

      <div style={styles.spinnerWrap}>
        {Array.from({ length: SPINNER_DOTS }).map((_, i) => {
          const trail = (lit - i + SPINNER_DOTS) % SPINNER_DOTS;
          const alpha = Math.max(0.08, 1 - trail / SPINNER_DOTS);
          const ang = (i / SPINNER_DOTS) * Math.PI * 2 - Math.PI / 2;
          const x = Math.cos(ang) * SPINNER_RADIUS;
          const y = Math.sin(ang) * SPINNER_RADIUS;
          return (
            <span
              key={i}
              style={{
                ...styles.dot,
                transform: `translate(${x}px, ${y}px)`,
                background: `rgba(255, 179, 0, ${alpha})`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

BootScreen.propTypes = {
  onComplete: PropTypes.func,
};

const styles = {
  root: {
    width: '320px',
    height: '480px',
    background: '#000',
    color: '#ffb300',
    fontFamily: "'Courier New', monospace",
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    overflow: 'hidden',
    transition: `opacity ${FADE_OUT_MS}ms ease-out`,
  },
  brand: {
    fontSize: '22px',
    letterSpacing: '0.22em',
    fontWeight: 'bold',
    color: '#ffb300',
    marginTop: '-40px',
  },
  sub: {
    fontSize: '11px',
    letterSpacing: '0.4em',
    color: '#8c6000',
    marginBottom: '40px',
  },
  spinnerWrap: {
    position: 'relative',
    width: '80px',
    height: '80px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: '#ffb300',
  },
};
