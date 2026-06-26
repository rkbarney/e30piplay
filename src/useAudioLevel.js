import { useEffect, useRef, useState } from 'react';

// Attack/release envelope constants — fast attack so transients (a word,
// a drum hit) pop immediately, slower release so the glow decays like a
// VU meter or candle flame instead of snapping back to zero between samples.
const ATTACK = 0.65;
const RELEASE = 0.11;

/**
 * Live mic amplitude, 0..1, smoothed with an attack/release envelope.
 * Winamp-style: read the raw waveform, take its RMS, and let the eye react
 * to whatever the mic actually hears (voice, music, road noise) rather than
 * a synthetic animation.
 *
 * No mic / permission denied -> `error` is set and `level` stays 0, so
 * callers can fall back to a non-audio animation instead of going dark.
 */
export default function useAudioLevel({ enabled = true } = {}) {
  const [level, setLevel] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const levelRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setLevel(0);
      setReady(false);
      setError(null);
      levelRef.current = 0;
      return undefined;
    }

    let audioCtx;
    let stream;
    let rafId;
    let cancelled = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        // Kiosk Chromium may start suspended (no user gesture); resume so the
        // analyser actually receives samples.
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        const buf = new Uint8Array(analyser.fftSize);

        const tick = () => {
          analyser.getByteTimeDomainData(buf);

          let sumSquares = 0;
          for (let i = 0; i < buf.length; i++) {
            const centered = (buf[i] - 128) / 128;
            sumSquares += centered * centered;
          }
          const rms = Math.sqrt(sumSquares / buf.length);

          const k = rms > levelRef.current ? ATTACK : RELEASE;
          levelRef.current += (rms - levelRef.current) * k;
          setLevel(levelRef.current);

          rafId = requestAnimationFrame(tick);
        };

        setReady(true);
        rafId = requestAnimationFrame(tick);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    }

    start();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
      audioCtx?.close();
    };
  }, [enabled]);

  return { level, ready, error };
}
