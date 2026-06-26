import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import ScreenFrame from './ScreenFrame';
import useAudioLevel from '../useAudioLevel';

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

// Solar-system rim glow — each planet is an independent soft blob on its own
// orbit with mass-scaled gravity (Earth = 1). Incommensurate periods avoid
// n-fold symmetry; Jupiter uses a high-eccentricity comet sweep.
// Orbit radii breathe with audio: silent ≈ stacked on sun; loud ≈ bezel edge.
const ORBIT_AUDIO_CURVE = 0.85; // <1 expands orbits sooner on quiet Pi mics
const SOLAR_PLANETS = [
  {
    orbit: 'circular',
    rimSilent: 0.08,
    rimLoud: 0.49,
    period: 1.0,
    mass: 1.0,
  },
  {
    orbit: 'elliptical',
    perihelionSilent: 0.06,
    perihelionLoud: 0.20,
    aphelionSilent: 0.25,
    aphelionLoud: 0.49,
    period: 0.8, // ~40s full loop at TIME_SCALE
    keplerSpeed: true,
    mass: 317.8,
  },
];
const MASS_LOG_MIN = Math.log10(SOLAR_PLANETS[0].mass);
const MASS_LOG_MAX = Math.log10(SOLAR_PLANETS[1].mass);
// Visual orbit period ≈ period / TIME_SCALE seconds (Earth ~50s, Jupiter ~40s).
const TIME_SCALE = 0.02;

function fbm(t, phases) {
  let v = 0;
  for (let i = 0; i < OCTAVES.length; i++) {
    v += OCTAVES[i].amp * Math.sin(t * OCTAVES[i].freq + phases[i]);
  }
  return v;
}

// Raw mic RMS is quiet on kiosk/Pi mics (~0.02-0.15 for speech). A power
// curve lifts whispers without pegging brightness on normal conversation.
const AUDIO_GAIN = 10;
const AUDIO_CURVE = 0.65; // pow exponent; <1 boosts quiet levels
const AUDIO_REACH = { glow: 0.62, breathe: 0.52, rim: 0.38 };

// Listening/speaking dance a little faster and a little more — HAL gets
// visibly more "alert" without changing his shape.
const SPEED = { idle: 1, listening: 2.2, speaking: 2.8 };
const REACH = { idle: 1, listening: 1.55, speaking: 1.75 };
const RING_GLOW = { idle: 0, listening: 0.85, speaking: 1 };
// Listening glow only after wake-word match (sidecar); no on-screen label.
const STATUS_LABEL = { idle: '', listening: '', speaking: 'SPEAKING…' };

/**
 * HAL 9000-inspired glowing eye. Original CSS/SVG artwork drawn for this
 * project — not derived from or redistributing any third-party asset.
 * (Inspiration only: the animated HAL fractal piece by jayaprime on
 * DeviantArt, https://www.deviantart.com/jayaprime/art/HAL-9000-Animated-Fractal-455267246
 * — that work is the artist's own and isn't used here.)
 */
export default function Hal({
  onMinus,
  onPlus,
  voiceState = 'idle',
  voiceTranscript = '',
  voiceLabel = '',
  sidecarLevel = 0,
  sidecarConnected = false,
}) {
  // Lens is dark on mount and fades up — the chrome bezel is always visible,
  // only the "light" itself powers on.
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setBooted(true), 30);
    return () => clearTimeout(id);
  }, []);

  // Sidecar owns the USB mic on Pi (sounddevice holds ALSA exclusive). Browser
  // getUserMedia would fight for the same device and usually reads silence.
  const { level: browserLevel, error: audioError } = useAudioLevel({
    enabled: !sidecarConnected,
  });
  const rawLevel = sidecarConnected ? sidecarLevel : browserLevel;
  const shaped = rawLevel > 0 ? Math.pow(rawLevel, AUDIO_CURVE) : 0;
  const audio = (sidecarConnected || !audioError) ? Math.min(1, shaped * AUDIO_GAIN) : 0;
  const micLive = sidecarConnected || !audioError;

  // Continuous fractal-noise flicker, updated every frame (not on a random
  // timer) so the motion flows rather than snapping between random values.
  const [flame, setFlame] = useState({
    glow: 1,
    breathe: 1,
    rim: 0,
    t: 0,
  });
  const phasesRef = useRef(null);
  const planetPhasesRef = useRef(null);
  if (!phasesRef.current) {
    phasesRef.current = OCTAVES.map(() => Math.random() * Math.PI * 2);
  }
  if (!planetPhasesRef.current) {
    planetPhasesRef.current = SOLAR_PLANETS.map(() => Math.random() * Math.PI * 2);
  }

  useEffect(() => {
    if (!booted) return undefined;
    const FRAME_MS = 33; // ~30fps — smooth, but a timer rather than rAF so it
                          // can't get suspended by a backgrounded/headless tab.
    let t = 0;
    const speed = SPEED[voiceState] ?? 1;
    const reach = REACH[voiceState] ?? 1;
    const phases = phasesRef.current;
    const fbmScale = micLive ? 0.3 : 1;

    const id = setInterval(() => {
      t += (FRAME_MS / 1000) * speed;
      setFlame({
        glow: 1 + fbm(t, phases) * 0.16 * reach * fbmScale,
        breathe: 1 + fbm(t * 0.6 + 4, phases) * 0.22 * reach * fbmScale,
        rim: fbm(t * 0.72 + 2.5, phases) * reach * fbmScale,
        t,
      });
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [booted, voiceState, micLive]);

  const reach = REACH[voiceState] ?? 1;
  const glow = flame.glow + audio * AUDIO_REACH.glow * reach;
  const breathe = flame.breathe + audio * AUDIO_REACH.breathe * reach;
  const rimWave = flame.rim + audio * AUDIO_REACH.rim * reach;
  const ringGlow = RING_GLOW[voiceState] ?? 0;
  const statusLabel = voiceLabel || STATUS_LABEL[voiceState] || '';
  const showTranscript = Boolean(voiceTranscript) && !voiceLabel;

  return (
    <ScreenFrame
      variant="mono"
      buttons={[
        { label: '−', onClick: onMinus },
        { label: '+', onClick: onPlus },
      ]}
    >
      <div style={styles.stage}>
        <div
          style={{
            ...styles.ring,
            boxShadow: ringGlow
              ? `0 0 0 1px #2a2c2e, 0 0 ${Math.round(18 * ringGlow)}px ${Math.round(8 * ringGlow)}px rgba(212,0,0,0.75), 0 10px 24px rgba(0,0,0,0.6)`
              : styles.ring.boxShadow,
          }}
        >
          <div style={styles.bezelHighlight} />
          <div style={styles.lens}>
            {/* Planets/spokes on their own layer — Chromium rejects 14 stacked
                backgrounds in one shorthand; sun layers stay on a second div. */}
            <div
              style={lensPlanets(
                booted,
                glow,
                voiceState,
                audio,
                reach,
                rimWave,
                flame.t,
                planetPhasesRef.current,
              )}
            />
            <div
              style={{
                ...lensSun(glow, breathe, booted, voiceState, rimWave),
                opacity: booted ? 1 : 0.12,
                transition: booted ? 'none' : `opacity ${BOOT_MS}ms ease-out`,
              }}
            />
          </div>
        </div>
        {(statusLabel || showTranscript) && (
          <div style={styles.voiceHud} aria-live="polite">
            {statusLabel && <div style={styles.voiceStatus}>{statusLabel}</div>}
            {showTranscript && (
              <div style={styles.voiceHeard}>HEARD: {voiceTranscript}</div>
            )}
          </div>
        )}
      </div>
    </ScreenFrame>
  );
}

Hal.propTypes = {
  onMinus: PropTypes.func,
  onPlus: PropTypes.func,
  voiceState: PropTypes.oneOf(['idle', 'listening', 'speaking']),
  voiceTranscript: PropTypes.string,
  voiceLabel: PropTypes.string,
  sidecarLevel: PropTypes.number,
  sidecarConnected: PropTypes.bool,
};

const RED = '#d40000';
const CORE = '#ff7a1a';

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function orbitAudioFactor(audio) {
  return Math.pow(clamp01(audio), ORBIT_AUDIO_CURVE);
}

function planetOrbitRadii(planet, audio) {
  const t = orbitAudioFactor(audio);
  if (planet.orbit === 'circular') {
    const r = planet.rimSilent + t * (planet.rimLoud - planet.rimSilent);
    return { radius: r };
  }
  const perihelion = planet.perihelionSilent + t * (planet.perihelionLoud - planet.perihelionSilent);
  const aphelion = planet.aphelionSilent + t * (planet.aphelionLoud - planet.aphelionSilent);
  return { perihelion, aphelion };
}

function ellipticalRadius(theta, midR, ampR) {
  return midR + ampR * Math.cos(theta);
}

// ∫₀^θ r² dθ for r = midR + ampR·cos(θ) — used for 1/r² angular speed.
function ellipticalAreaIntegral(theta, midR, ampR) {
  return (
    midR * midR * theta
    + 2 * midR * ampR * Math.sin(theta)
    + ampR * ampR * (theta / 2 + Math.sin(2 * theta) / 4)
  );
}

function ellipticalAngleAtTime(phase0, t, period, midR, ampR) {
  const totalArea = Math.PI * (2 * midR * midR + ampR * ampR);
  const orbitFraction = ((t * TIME_SCALE / period) % 1 + 1) % 1;
  const target = orbitFraction * totalArea;
  let lo = 0;
  let hi = 2 * Math.PI;
  for (let i = 0; i < 32; i += 1) {
    const mid = (lo + hi) / 2;
    if (ellipticalAreaIntegral(mid, midR, ampR) < target) lo = mid;
    else hi = mid;
  }
  return phase0 + (lo + hi) / 2;
}

function planetPosition(planet, phase, t, audio) {
  const radii = planetOrbitRadii(planet, audio);
  if (planet.orbit === 'circular') {
    const angle = phase + t * ((2 * Math.PI) / planet.period) * TIME_SCALE;
    const r = radii.radius;
    return {
      cx: 50 + Math.cos(angle) * r * 50,
      cy: 50 + Math.sin(angle) * r * 50,
    };
  }

  const midR = (radii.perihelion + radii.aphelion) / 2;
  const ampR = (radii.aphelion - radii.perihelion) / 2;
  const angle = planet.keplerSpeed
    ? ellipticalAngleAtTime(phase, t, planet.period, midR, ampR)
    : phase + t * ((2 * Math.PI) / planet.period) * TIME_SCALE;
  const r = ellipticalRadius(angle - phase, midR, ampR);
  return {
    cx: 50 + Math.cos(angle) * r * 50,
    cy: 50 + Math.sin(angle) * r * 50,
  };
}

function massNorm(mass) {
  const logM = Math.log10(mass);
  return clamp01((logM - MASS_LOG_MIN) / (MASS_LOG_MAX - MASS_LOG_MIN));
}

// Rim-only planet blobs + faint gravity spokes — bottom layers; must not cover mainRadial.
function buildPlanetLayers(t, planetPhases, power, audio, reach, rim) {
  const audioBoost = 1 + audio * 0.18 * reach + Math.pow(audio, 2) * 0.06 * reach;
  const rimPulse = 1 + rim * 0.08;
  return SOLAR_PLANETS.flatMap((planet, i) => {
    const m = massNorm(planet.mass);
    const { cx, cy } = planetPosition(planet, planetPhases[i], t, audio);

    const alpha = clamp01((0.035 + m * 0.09) * power * audioBoost * rimPulse);
    const coreA = clamp01(alpha * 1.2);
    const midA = clamp01(alpha * 0.48);
    const edgeA = clamp01(alpha * 0.14);
    const spread = Math.round((0.045 + m * 0.11) * 100);

    const blob = [
      `radial-gradient(circle ${spread}% at ${cx.toFixed(2)}% ${cy.toFixed(2)}%,`,
      `rgba(190,10,0,${coreA.toFixed(3)}) 0%,`,
      `rgba(130,6,0,${midA.toFixed(3)}) 38%,`,
      `rgba(70,2,0,${edgeA.toFixed(3)}) 62%,`,
      'transparent 100%)',
    ].join(' ');

    // Gravity spoke: planet → lens center, very low alpha so rim detail doesn't wash out the sun.
    const spokeDeg = ((Math.atan2(50 - cy, 50 - cx) * 180) / Math.PI + 360) % 360;
    const spokeA = clamp01((0.012 + m * 0.028) * power * audioBoost);
    const spoke = [
      `linear-gradient(${spokeDeg.toFixed(1)}deg,`,
      `transparent 0%, rgba(120,4,0,${(spokeA * 0.35).toFixed(3)}) 18%,`,
      `rgba(90,3,0,${spokeA.toFixed(3)}) 42%,`,
      `rgba(50,1,0,${(spokeA * 0.45).toFixed(3)}) 58%,`,
      'transparent 72%)',
    ].join(' ');

    return [blob, spoke];
  });
}

const LENS_LAYER = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
};

// Rim planet blobs + spokes — bottom layer (z-index 0).
function lensPlanets(booted, glow, voiceState, audio, reach, rim, t, planetPhases) {
  const listen = voiceState === 'listening' ? 1.18 : 1;
  const power = booted ? glow * listen : 0.2;
  const planetLayers = buildPlanetLayers(t, planetPhases, power, audio, reach, rim);
  return {
    ...LENS_LAYER,
    zIndex: 0,
    background: planetLayers.join(', '),
  };
}

// Main sun + rim shell — top glow layer (z-index 1). mainRadial already includes
// the hot white center; no separate core div needed.
function lensSun(glow, breathe, booted, voiceState, rim) {
  const listen = voiceState === 'listening' ? 1.18 : 1;
  const sat = voiceState === 'idle' ? 1 : 1.35;
  const power = booted ? glow * listen : 0.2;
  const br = breathe;

  const redA = clamp01(0.45 + power * 0.45 * sat);
  const midA = clamp01(0.25 + power * 0.35);
  const deepA = clamp01(0.15 + power * 0.2);
  const rimVar = rim * 3.5;
  const innerFall = clamp01(0.58 - (br - 1) * 0.12 + rimVar * 0.15);
  const outerFall = clamp01(0.86 - (br - 1) * 0.06 + rimVar * 0.08);
  const innerPct = Math.round(innerFall * 100);
  const outerPct = Math.round(outerFall * 100);
  const amberStop = 4 + power * 2;
  const redStop = 14 + power * 8;

  const mainRadial = [
    'radial-gradient(circle at 50% 50%,',
    `#fff2d0 0%, ${CORE} ${amberStop.toFixed(1)}%, ${RED} ${redStop.toFixed(1)}%,`,
    `rgba(138,0,0,${redA}) 30%, rgba(98,0,0,${midA}) 46%,`,
    `rgba(66,0,0,${deepA}) 58%, rgba(20,0,0,${clamp01(0.42 + br * 0.18)}) ${innerPct}%,`,
    `rgba(8,0,0,0.55) ${outerPct - 12}%, rgba(3,0,0,0.28) ${outerPct - 4}%,`,
    `rgba(1,0,0,0.1) ${outerPct + 2}%, rgba(0,0,0,0.04) ${outerPct + 6}%,`,
    `rgba(0,0,0,1) ${Math.min(100, outerPct + 10)}%)`,
  ].join(' ');

  const rimShell = [
    'radial-gradient(circle at 50% 50%,',
    `transparent 38%, rgba(85,0,0,${clamp01(midA * 0.2 + Math.abs(rim) * 0.035)}) ${innerPct - 10}%,`,
    `rgba(32,0,0,${clamp01(deepA * 0.18 + Math.abs(rim) * 0.028)}) ${outerPct - 14}%,`,
    `rgba(14,0,0,0.1) ${outerPct - 5}%, rgba(5,0,0,0.04) ${outerPct + 1}%,`,
    `transparent ${Math.min(100, outerPct + 12)}%)`,
  ].join(' ');

  return {
    ...LENS_LAYER,
    zIndex: 1,
    background: [mainRadial, rimShell].join(', '),
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
  // other clock screen uses, so HAL lines up with them. Lens content is
  // circular-clipped to the inner edge of this padding band.
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

  // Fixed circular lens — borderRadius clip, black void. No SVG organic
  // clipPath; glow radiates inside this static circle.
  lens: {
    width: '100%',
    height: '100%',
    aspectRatio: '1 / 1',
    position: 'relative',
    borderRadius: '50%',
    overflow: 'hidden',
    background: '#000',
  },
  voiceHud: {
    width: '300px',
    textAlign: 'center',
    fontFamily: 'monospace',
    fontSize: '13px',
    lineHeight: 1.35,
    color: '#ffb4b4',
    minHeight: '36px',
  },
  voiceStatus: {
    letterSpacing: '0.12em',
    fontWeight: 700,
    color: '#ff5555',
  },
  voiceHeard: {
    marginTop: '6px',
    fontSize: '12px',
    color: '#ffd0a8',
    wordBreak: 'break-word',
  },
};
