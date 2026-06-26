import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import ScreenFrame from './ScreenFrame';
import useHalVoice from '../useHalVoice';
import useAudioLevel from '../useAudioLevel';

// How long the lens takes to glow up to full brightness on mount.
const BOOT_MS = 2400;

// Listening/speaking read as visibly more "alert" — same audio-driven
// motion, just amplified — without changing the eye's shape.
const REACH = { idle: 1, listening: 1.25, speaking: 1.4 };

// Raw mic RMS is quiet (~0.05-0.2 for speech) — push it into a usable 0..1
// range before it drives the glow.
const AUDIO_GAIN = 5;

/**
 * HAL 9000-inspired glowing eye. Original CSS/SVG artwork drawn for this
 * project — not derived from or redistributing any third-party asset.
 * (Inspiration only: the animated HAL fractal piece by jayaprime on
 * DeviantArt, https://www.deviantart.com/jayaprime/art/HAL-9000-Animated-Fractal-455267246
 * — that work is the artist's own and isn't used here.)
 */
export default function Hal({ onMinus, onPlus, onIntent }) {
  const voiceState = useHalVoice(onIntent);
  const { level: audioLevel, error: audioError } = useAudioLevel();

  // Lens is dark on mount and fades up — the chrome bezel is always visible,
  // only the "light" itself powers on.
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setBooted(true), 30);
    return () => clearTimeout(id);
  }, []);

  // Eye is purely audio-driven: useAudioLevel already smooths the mic's
  // amplitude with an attack/release envelope, so the glow just maps that
  // straight through — no separate animation loop needed here.
  const reach = REACH[voiceState] ?? 1;
  const audio = audioError ? 0 : Math.min(1, audioLevel * AUDIO_GAIN);
  const glow = 1 + audio * 0.55 * reach;
  const breathe = 1 + audio * 0.45 * reach;
  const flare = 0.78 + audio * 0.9 * reach;

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
        {audioError && <div style={styles.status}>NO AUDIO DETECTED</div>}
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

  // Honest status line for when there's nothing to react to — dim and
  // small, a status readout rather than an error banner.
  status: {
    fontSize: '12px',
    letterSpacing: '0.08em',
    color: '#666',
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
