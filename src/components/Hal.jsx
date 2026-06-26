import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import ScreenFrame from './ScreenFrame';
import useAudioLevel from '../useAudioLevel';

// Raw mic RMS is quiet on kiosk/Pi mics (~0.02-0.15 for speech). A power
// curve lifts whispers without pegging brightness on normal conversation.
const AUDIO_GAIN = 9;
const AUDIO_CURVE = 0.65; // pow exponent; <1 boosts quiet levels

// Listening glow on the chrome ring only after wake-word match (sidecar).
const RING_GLOW = { idle: 0, listening: 0.85, speaking: 1 };
const STATUS_LABEL = { idle: '', listening: '', speaking: 'SPEAKING…' };

// HAL is rendered as a glass camera lens, not a flat gradient: a deep red
// dome, a small orange-white pupil, and a stack of faint refraction rings —
// each its own off-center, possibly elliptical "lens element". A WebGL
// fragment shader draws the whole thing in one pass (cheaper on the Pi than
// the old stack of CSS radial gradients, which could only ever be circles).
//
// GLOBALS + LENSES were dialed in by hand with tools/hal-lens-editor.html;
// re-open that file to retune and paste the new config back here.
const GLOBALS = {
  pupilR: 0.159,
  pupilGlow: 1.3,
  redSpread: 2.87,
  redGlow: 1.31,
  ringDepth: 0.3,
  audioRings: 2.09,
  audioPupil: 0.2,
  audioGlow: 0.8,
  breath: 0.15,
};
// Each lens element: center (cx,cy), ring radius r, band width w, darkness
// dep, ellipse aspect asp (1 = circle), tilt ang°, and its own slow drift
// (wAmp/wSpeed). Off-center + elliptical is what reads as organic glass.
const LENSES = [
  { cx: 0.006, cy: -0.025, r: 0.4,  w: 0.06, dep: 0.18, asp: 1.01, ang: 0,   wAmp: 0,    wSpeed: 0 },
  { cx: 0,     cy: -0.018, r: 1.11, w: 0.12, dep: 1,    asp: 1,    ang: 0,   wAmp: 0.02, wSpeed: 0.2 },
  { cx: -0.002, cy: -0.023, r: 0.05, w: 0.12, dep: 1,    asp: 1,    ang: 0,   wAmp: 0.02, wSpeed: 0.2 },
  { cx: 0.005, cy: -0.18,  r: 0.5,  w: 0.12, dep: 0.16, asp: 0.35, ang: -39, wAmp: 0.02, wSpeed: 0.2 },
];
const MAX_LENSES = 14; // shader array bound; keep in sync with the GLSL loop.

const VERT_SRC = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';
const FRAG_SRC = [
  'precision highp float;',
  'uniform vec2 u_res;uniform float u_time,u_audio,u_boot;',
  'uniform float u_pupilR,u_pupilGlow,u_redSpread,u_redGlow,u_ringDepth,u_audioRings,u_audioPupil,u_audioGlow,u_breath;',
  'uniform int u_count;uniform vec2 u_cen[14];uniform float u_rad[14];uniform float u_wid[14];uniform float u_dep[14];uniform float u_asp[14];uniform float u_ang[14];uniform float u_wamp[14];uniform float u_wspd[14];',
  'void main(){',
  '  vec2 P=(gl_FragCoord.xy-0.5*u_res)/min(u_res.x,u_res.y);',
  '  vec2 p=P*2.0;float t=u_time;float audio=u_audio;',
  '  float d=length(p);',
  '  float lift=u_redGlow*(0.8+u_audioGlow*audio);',
  '  float bloom=exp(-d*u_redSpread);',
  '  float bloom2=exp(-d*(u_redSpread*2.1));',
  '  vec3 dome=vec3(0.42,0.02,0.0)*bloom*lift+vec3(0.82,0.07,0.0)*bloom2*lift*0.9;',
  '  float dark=0.0;',
  '  for(int i=0;i<14;i++){',
  '    if(i>=u_count) break;',
  '    float fi=float(i);',
  '    vec2 c=u_cen[i];',
  '    c+=u_wamp[i]*vec2(sin(t*u_wspd[i]+fi*2.0),cos(t*u_wspd[i]*0.9+fi*2.3));',
  '    c+=0.05*u_audioRings*audio*vec2(sin(t*0.7+fi),cos(t*0.6+fi));',
  '    vec2 q=p-c;',
  '    float ca=cos(u_ang[i]),sa=sin(u_ang[i]);',
  '    vec2 qr=vec2(ca*q.x+sa*q.y,-sa*q.x+ca*q.y);',
  '    qr.x/=max(0.05,u_asp[i]);',
  '    float dist=length(qr);',
  '    float r=u_rad[i]+0.03*u_audioRings*audio*sin(t*1.3+fi*3.0);',
  '    float w=max(0.01,u_wid[i]);',
  '    float e=(dist-r)/w;',
  '    dark+=u_dep[i]*exp(-e*e);',
  '  }',
  '  dark*=smoothstep(0.04,0.16,d);',
  '  dome*=1.0-clamp(u_ringDepth*dark,0.0,0.92);',
  '  vec3 col=dome;',
  '  float pr=u_pupilR*(1.0+u_audioPupil*audio+u_breath*sin(t*0.9)+0.04*sin(t*0.37));',
  '  vec2 pp=p-vec2(0.0,-0.02);float pd=length(pp);',
  '  float pupil=smoothstep(pr,pr*0.25,pd);',
  '  float hot=smoothstep(pr*0.65,0.0,pd);',
  '  float pg=u_pupilGlow*(1.0+0.5*u_audioGlow*audio);',
  '  col+=vec3(1.0,0.55,0.12)*pupil*pg;',
  '  col+=vec3(1.0,0.92,0.62)*hot*pg*1.05;',
  '  col*=u_boot;',
  '  col*=smoothstep(1.06,0.3,d)*0.75+0.25;',
  '  col*=smoothstep(1.02,0.92,d);',
  '  float g=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233))+t)*43758.5453);',
  '  col+=(g-0.5)*0.012;',
  '  gl_FragColor=vec4(col,1.0);',
  '}',
].join('\n');

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('HAL shader compile failed:', gl.getShaderInfoLog(s));
  }
  return s;
}

/**
 * HAL 9000-inspired glowing lens. Original WebGL/CSS artwork drawn for this
 * project — not derived from or redistributing any third-party asset.
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
  // Sidecar owns the USB mic on Pi (sounddevice holds ALSA exclusive). Browser
  // getUserMedia would fight for the same device and usually reads silence.
  const { level: browserLevel, error: audioError } = useAudioLevel({
    enabled: !sidecarConnected,
  });
  const rawLevel = sidecarConnected ? sidecarLevel : browserLevel;
  const shaped = rawLevel > 0 ? Math.pow(rawLevel, AUDIO_CURVE) : 0;
  const audio = (sidecarConnected || !audioError) ? Math.min(1, shaped * AUDIO_GAIN) : 0;

  // The render loop runs once for the component's life; it reads the latest
  // audio/state from refs so prop changes don't tear down the GL context.
  const audioRef = useRef(0);
  const stateRef = useRef(voiceState);
  audioRef.current = audio;
  stateRef.current = voiceState;

  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return undefined;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT_SRC));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const U = (n) => gl.getUniformLocation(prog, n);

    // Static uniforms — the dialed-in look never changes at runtime, so push
    // it once. Only time/audio/boot are updated per frame below.
    Object.entries(GLOBALS).forEach(([k, v]) => {
      gl.uniform1f(U(`u_${k}`), v);
    });
    const n = Math.min(MAX_LENSES, LENSES.length);
    const cen = new Float32Array(MAX_LENSES * 2);
    const flat = (key) => {
      const a = new Float32Array(MAX_LENSES);
      for (let i = 0; i < n; i += 1) a[i] = LENSES[i][key];
      return a;
    };
    for (let i = 0; i < n; i += 1) {
      cen[2 * i] = LENSES[i].cx;
      cen[2 * i + 1] = LENSES[i].cy;
    }
    const ang = new Float32Array(MAX_LENSES);
    for (let i = 0; i < n; i += 1) ang[i] = (LENSES[i].ang * Math.PI) / 180;
    gl.uniform1i(U('u_count'), n);
    gl.uniform2fv(U('u_cen[0]'), cen);
    gl.uniform1fv(U('u_rad[0]'), flat('r'));
    gl.uniform1fv(U('u_wid[0]'), flat('w'));
    gl.uniform1fv(U('u_dep[0]'), flat('dep'));
    gl.uniform1fv(U('u_asp[0]'), flat('asp'));
    gl.uniform1fv(U('u_ang[0]'), ang);
    gl.uniform1fv(U('u_wamp[0]'), flat('wAmp'));
    gl.uniform1fv(U('u_wspd[0]'), flat('wSpeed'));

    const uRes = U('u_res');
    const uTime = U('u_time');
    const uAudio = U('u_audio');
    const uBoot = U('u_boot');

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const sizeCanvas = () => {
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (w && h && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);

    let raf = 0;
    let boot = 0;
    let audioSm = 0;
    const start = performance.now();
    const draw = (now) => {
      const t = (now - start) / 1000;
      boot += (1 - boot) * 0.02; // power-on fade, ~2s to full
      // A small floor while listening keeps HAL faintly "alert" in silence.
      const floor = stateRef.current === 'listening' ? 0.06 : 0;
      const target = Math.max(audioRef.current, floor);
      audioSm += (target - audioSm) * 0.12;
      sizeCanvas();
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, t);
      gl.uniform1f(uAudio, audioSm);
      gl.uniform1f(uBoot, boot);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', sizeCanvas);
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    };
  }, []);

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
            <canvas ref={canvasRef} style={styles.canvas} />
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

  // Fixed circular lens — borderRadius clip, black void. The WebGL canvas
  // fills it; deep-red CSS fallback shows if WebGL is unavailable.
  lens: {
    width: '100%',
    height: '100%',
    aspectRatio: '1 / 1',
    position: 'relative',
    borderRadius: '50%',
    overflow: 'hidden',
    background: 'radial-gradient(circle at 50% 50%, #2a0400 0%, #000 70%)',
  },
  canvas: {
    width: '100%',
    height: '100%',
    display: 'block',
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
