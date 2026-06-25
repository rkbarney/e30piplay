import { useEffect, useRef, useState } from 'react';

/**
 * Connects to the local HAL speech sidecar (scripts/s52-hal-voice.py). The
 * sidecar runs offline whisper.cpp STT against the USB mic and pushes JSON
 * frames over a WebSocket: { type: 'listening' | 'speaking' | 'idle' } for
 * HAL's eye state, and { type: 'command', intent: 'start_carplay' | ... }
 * once it matches a "hal ..." phrase. It also speaks the "I'm sorry, Dave"
 * refusal itself (over AUX) when "hal" is heard but the rest doesn't match
 * a known command — there's no separate intent for that.
 *
 * `active` tells the sidecar whether it should be listening at all — false
 * while CarPlay is in the foreground, since the dongle already owns the mic
 * for Siri and we don't want two listeners fighting over it. The sidecar
 * stays connected either way; this just mutes capture on its end.
 *
 * No sidecar running -> the socket fails to connect and this hook is a
 * silent no-op, so the UI works (eye just idles) before the sidecar exists.
 */
const WS_URL = import.meta.env.VITE_HAL_WS_URL ?? 'ws://127.0.0.1:8765';

export default function useHalVoice(onIntent, active = true) {
  const [state, setState] = useState('idle'); // idle | listening | speaking
  const onIntentRef = useRef(onIntent);
  onIntentRef.current = onIntent;
  const socketRef = useRef(null);

  const sendActive = (socket, isActive) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'set_active', active: isActive }));
    }
  };

  useEffect(() => {
    let socket;
    let retryTimer;

    const connect = () => {
      socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.onopen = () => sendActive(socket, active);

      socket.onmessage = (event) => {
        let frame;
        try {
          frame = JSON.parse(event.data);
        } catch {
          return;
        }
        if (frame.type === 'idle' || frame.type === 'listening' || frame.type === 'speaking') {
          setState(frame.type);
        } else if (frame.type === 'command' && frame.intent) {
          onIntentRef.current?.(frame.intent);
        }
      };

      socket.onclose = () => {
        setState('idle');
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

  return state;
}
