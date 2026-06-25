import { useEffect, useRef, useState } from 'react';

/**
 * Connects to the local HAL speech sidecar (not yet built — see issue #10).
 * The sidecar runs offline STT against the USB mic and pushes JSON frames
 * over a WebSocket: { type: 'listening' | 'speaking' | 'idle' } for HAL's
 * eye state, and { type: 'command', intent: 'start_carplay' | 'go_games' |
 * 'go_clock' | 'exit_carplay' } once it matches a "hal ..." phrase.
 *
 * No sidecar running yet -> the socket fails to connect and this hook is a
 * silent no-op, so the UI works (eye just idles) before the sidecar exists.
 */
const WS_URL = import.meta.env.VITE_HAL_WS_URL ?? 'ws://127.0.0.1:8765';

export default function useHalVoice(onIntent) {
  const [state, setState] = useState('idle'); // idle | listening | speaking
  const onIntentRef = useRef(onIntent);
  onIntentRef.current = onIntent;

  useEffect(() => {
    let socket;
    let retryTimer;

    const connect = () => {
      socket = new WebSocket(WS_URL);

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
      socket?.close();
    };
  }, []);

  return state;
}
