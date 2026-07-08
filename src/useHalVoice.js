import { useEffect, useRef, useState } from 'react';

/**
 * Connects to the local HAL speech sidecar (scripts/s52-hal-voice.py). The
 * sidecar runs whisper.cpp STT against the USB mic and, once the "hal" wake
 * word is heard (openWakeWord neural detector when a model is installed,
 * else transcript matching), sends the phrase to Claude Haiku and speaks the
 * reply in the HAL 9000 voice (Piper TTS) over AUX. It pushes JSON frames over a WebSocket:
 * { type: 'listening' | 'speaking' | 'idle' } for HAL's eye state (listening
 * only after a wake-word match — not on raw VAD), { type: 'level', value:
 * number } for live mic RMS (0..1, pre-smoothed by the sidecar so the browser
 * doesn't need a second getUserMedia on the same USB mic), { type:
 * 'transcript', text } with what HAL heard, and { type: 'command', intent:
 * 'switch_to_carplay' | 'return_to_kiosk' | 'switch_to_emulator' } when Claude
 * picks a screen-switch intent. Pure conversation (intent 'none') is spoken
 * only — no command frame.
 *
 * `active` tells the sidecar whether it should be listening at all — false
 * while CarPlay is in the foreground, since the dongle already owns the mic
 * for Siri and we don't want two listeners fighting over it. The sidecar
 * stays connected either way; this just mutes capture on its end.
 *
 * No sidecar running -> the socket fails to connect and this hook is a
 * silent no-op, so the UI works (eye just idles) before the sidecar exists.
 */
// The kiosk (which loads http://localhost) talks to the sidecar directly;
// remote browsers (a phone that scanned the REMOTE QR) reach it through the
// nginx /hal-ws proxy, since :8765 itself is loopback-only on the Pi.
const IS_KIOSK = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
const WS_URL = import.meta.env.VITE_HAL_WS_URL
  ?? (IS_KIOSK ? 'ws://127.0.0.1:8765' : `ws://${window.location.host}/hal-ws`);

export default function useHalVoice(onIntent, active = true) {
  const [state, setState] = useState('idle'); // idle | listening | speaking
  const [transcript, setTranscript] = useState('');
  const [label, setLabel] = useState(''); // e.g. OPENING CARPLAY during success ack
  const [level, setLevel] = useState(0);
  const [connected, setConnected] = useState(false);
  const onIntentRef = useRef(onIntent);
  onIntentRef.current = onIntent;
  const socketRef = useRef(null);

  const sendActive = (socket, isActive) => {
    // Kiosk-only: the sidecar's active flag is global, and it must track what
    // the CAR display shows — a remote phone sitting on the CarPlay face must
    // not mute the car's mic. Remote browsers are view-only listeners.
    if (IS_KIOSK && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'set_active', active: isActive }));
    }
  };

  useEffect(() => {
    let socket;
    let retryTimer;

    const connect = () => {
      socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        sendActive(socket, active);
      };

      socket.onmessage = (event) => {
        let frame;
        try {
          frame = JSON.parse(event.data);
        } catch {
          return;
        }
        if (frame.type === 'level' && typeof frame.value === 'number') {
          setLevel(Math.max(0, Math.min(1, frame.value)));
        } else if (frame.type === 'idle' || frame.type === 'listening' || frame.type === 'speaking') {
          setState(frame.type);
          if (frame.type === 'speaking' && frame.label) {
            setLabel(String(frame.label));
          } else if (frame.type !== 'speaking') {
            setLabel('');
          }
          if (frame.type === 'idle') {
            setTranscript('');
            setLabel('');
          }
        } else if (frame.type === 'transcript' && frame.text) {
          setTranscript(String(frame.text));
        } else if (frame.type === 'command' && frame.intent) {
          onIntentRef.current?.(frame.intent);
        }
      };

      socket.onclose = () => {
        setConnected(false);
        setLevel(0);
        setState('idle');
        setTranscript('');
        setLabel('');
        retryTimer = setTimeout(connect, 3000);
      };
      socket.onerror = () => socket.close();
    };

    connect();
    return () => {
      clearTimeout(retryTimer);
      socketRef.current = null;
      socket?.close();
    };
    // `active`'s current value is read fresh via the effect below, but the
    // socket itself should only be (re)created once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-announce active state to the already-open socket on every change.
  useEffect(() => {
    sendActive(socketRef.current, active);
  }, [active]);

  return { state, transcript, label, level, connected };
}
