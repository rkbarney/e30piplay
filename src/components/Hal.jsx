import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import ScreenFrame from './ScreenFrame';
import useHalVoice from '../useHalVoice';

// How long the lens takes to glow up to full brightness on mount.
const BOOT_MS = 2400;

// Fractal (fBm-style) flicker: several sine octaves at different
// frequencies/phases summed together, like a candle flame's motion rather
// than a single random jump. Mostly settles within roughly -0.85..0.85.
const OCTAVES = [
  { freq: 0.55, amp: 0.5 },
  { freq: 1.3,  amp: 0.27 },
  { freq: 2.9,  amp: 0.14 },
  { freq: 6.1,  amp: 0.07 },
];

function fbm(t, phases) {
  let v = 0;
  for (let i = 0; i < OCTAVES.length; i++) {
    v += OCTAVES[i].amp * Math.sin(t * OCTAVES[i].freq + phases[i]);
  }
  return v;
}

// Listening/speaking dance a little faster and a little more — HAL gets
// visibly more "alert" without changing his shape.
const SPEED = { idle: 1, listening: 1.7, speaking: 2.3 };
const REACH = { idle: 1, listening: 1.25, speaking: 1.4 };

/**
 * HAL 9000-inspired glowing eye. Original CSS/SVG artwork drawn for this
 * project — not derived from or redistributing any third-party asset.
 * (Inspiration only: the animated HAL fractal piece by jayaprime on
 * DeviantArt, https://www.deviantart.com/jayaprime/art/HAL-9000-Animated-Fractal-455267246
 * — that work is the artist's own and isn't used here.)
 */
export default function Hal({ onMinus, onPlus, onIntent }) {
  const voiceState = useHalVoice(onIntent);

  // Lens is dark on mount and fades up — the chrome bezel is always visible,
  // only the "light" itself powers on.
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setBooted(true), 30);
    return () => clearTimeout(id);
  }, []);

  // Continuous fractal-noise flicker, updated every frame (not on a random
  // timer) so the motion flows rather than snapping between random values.
  const [flame, setFlame] = useState({ glow: 1, breathe: 1, flare: 0.8 });
  const phasesRef = useRef(null);
  if (!phasesRef.current) {
    phasesRef.current = OCTAVES.map(() => Math.random() * Math.PI * 2);
  }

  useEffect(() => {
    if (!booted) return undefined;
    const FRAME_MS = 33; // ~30fps — smooth, but a timer rather than rAF so it
                          // can't get suspended by a backgrounded/headless tab.
    let t = 0;
    const speed = SPEED[voiceState] ?? 1;
    const reach = REACH[voiceState] ?? 1;
    const phases = phasesRef.current;

    const id = setInterval(() => {
      t += (FRAME_MS / 1000) * speed;
      setFlame({
        glow: 1 + fbm(t, phases) * 0.16 * reach,
        breathe: 1 + fbm(t * 0.6 + 4, phases) * 0.22 * reach,
        flare: 0.78 + fbm(t * 1.4 + 9, phases) * 0.22 * reach,
      });
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [booted, voiceState]);

  const { glow, breathe, flare } = flame;

  return (
    <ScreenFrame
      variant="mono"
      buttons={[
        { label: '−', onClick: onMinus },
        { label: '+', onClick: onPlus },
      ]}
    >
      <div style={styles.stage}>
        <div style={styles.ring}>
          <div style={styles.bezelHighlight} />
          <div
            style={{
              ...styles.sphere,
              boxShadow: booted
                ? `inset 0 0 ${Math.round(48 * breathe)}px ${Math.round(12 * breathe)}px #000`
                : 'inset 0 0 60px 16px #000',
              filter: booted ? `brightness(${glow}) saturate(1)` : 'brightness(0.1) saturate(0.2)',
              transition: booted ? 'none' : `filter ${BOOT_MS}ms ease-out`,
            }}
          >
            <div style={styles.iris} />
            <div style={{ ...styles.core, ...coreGlow(booted ? glow : 0.2) }} />
            <div style={{ ...styles.flareArc, opacity: booted ? flare : 0 }} />
            <div style={{ ...styles.flareDot, opacity: booted ? flare : 0 }} />
          </div>
        </div>
      </div>
    </ScreenFrame>
  );
}

Hal.propTypes = {
  onMinus: PropTypes.func,
  onPlus: PropTypes.func,
  onIntent: PropTypes.func,
};

const RED = '#d40000';
const CORE = '#ff7a1a';

// Core's glow recomputed every frame so the highlight dances with the flame.
// Tighter than before — a small, sharp point rather than a soft amber blob.
function coreGlow(glow) {
  const r = (px) => `${Math.round(px * glow)}px`;
  return {
    boxShadow: `0 0 ${r(5)} ${r(2)} #fff2d0, 0 0 ${r(16)} ${r(7)} ${CORE}, 0 0 ${r(56)} ${r(26)} ${RED}`,
  };
}

const styles = {
  stage: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '28px',
  },

  // Chrome bezel — a thin silver ring, sized to match the 300px face every
  // other clock screen uses, so HAL lines up with them. Contains everything;
  // nothing glows past this edge — the bezel is the edge of the screen.
  ring: {
    width: '300px',
    height: '300px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #f4f6f8 0%, #9aa1a6 22%, #4a4e52 48%, #d8dadc 62%, #8a8e91 80%, #c9cbcd 100%)',
    boxShadow: '0 0 0 1px #2a2c2e, 0 10px 24px rgba(0,0,0,0.6)',
    padding: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  bezelHighlight: {
    position: 'absolute',
    top: '18px',
    left: '40px',
    width: '76px',
    height: '20px',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.5)',
    filter: 'blur(4px)',
    transform: 'rotate(-25deg)',
  },

  // One continuous black sphere reaching all the way to the bezel — the red
  // glow emanates from its center and fades to black well inside that edge.
  sphere: {
    width: '276px',
    height: '276px',
    borderRadius: '50%',
    // No bright stop at the very center here — the "core" element below is
    // the light source. Without that gap the core's glow has nothing darker
    // to stand out against and just reads as a flat red disc.
    background: 'radial-gradient(circle at 50% 50%, #8a0000 0%, #420000 28%, #000 52%)',
    position: 'relative',
    overflow: 'hidden',
  },
  core: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: '13px',
    height: '13px',
    marginTop: '-6.5px',
    marginLeft: '-6.5px',
    borderRadius: '50%',
    background: '#fff2d0',
    zIndex: 2,
  },

  // Camera-iris diaphragm — faint alternating blades around the core, the
  // detail the real HAL prop's lens shows under the glow. Wide, low-contrast
  // blades plus a heavy blur keep it a barely-there texture, not rays.
  iris: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: '210px',
    height: '210px',
    marginTop: '-105px',
    marginLeft: '-105px',
    borderRadius: '50%',
    background: 'repeating-conic-gradient(from 0deg, rgba(0,0,0,0.16) 0deg 11deg, rgba(0,0,0,0) 11deg 36deg)',
    mixBlendMode: 'multiply',
    filter: 'blur(5px)',
    maskImage: 'radial-gradient(circle, transparent 18%, #000 38%, #000 62%, transparent 88%)',
    WebkitMaskImage: 'radial-gradient(circle, transparent 18%, #000 38%, #000 62%, transparent 88%)',
  },

  // Lens-flare elements, positioned tight around the glowing core so they
  // read as highlights on the light itself rather than marks on the sphere.
  flareArc: {
    position: 'absolute',
    top: '78px',
    left: '90px',
    width: '60px',
    height: '21px',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.5)',
    filter: 'blur(6px)',
    transform: 'rotate(-30deg)',
  },
  flareDot: {
    position: 'absolute',
    top: '105px',
    left: '167px',
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.6)',
    filter: 'blur(1px)',
  },
};
