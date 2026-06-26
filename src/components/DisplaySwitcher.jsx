import { useState, useCallback, useEffect, useRef } from 'react';
import FactoryClock    from './FactoryClock';
import DigitalClock    from './DigitalClock';
import CarPlayReceiver from './CarPlayReceiver';
import SystemScreen    from './SystemScreen';
import Games           from './Games';
import Hal             from './Hal';
import useHalVoice     from '../useHalVoice';

// Faces cycled by the − button — one loop, HAL included, so it's always
// reachable again no matter where you wander off to.
const FACES = ['hal', 'factory', 'digital', 'system', 'games'];

const BOOT_SCREEN = import.meta.env.VITE_BOOT_SCREEN ?? 'hal';
const API_BASE = import.meta.env.VITE_S52_API_BASE ?? '';

async function postCarplayApi(path) {
  try {
    await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
  } catch {
    /* non-fatal — user can still tap + / RESTART */
  }
}

export default function DisplaySwitcher() {
  // `screen` is either a face name (from FACES) or 'carplay'.
  const [screen, setScreen] = useState(BOOT_SCREEN);
  const lastFaceRef = useRef(BOOT_SCREEN);
  if (FACES.includes(screen)) lastFaceRef.current = screen;

  // Voice intents from the HAL speech sidecar (see useHalVoice) map onto the
  // same navigation the +/− buttons already drive. Claude emits the
  // switch_to_*/return_to_kiosk vocabulary; the older start_carplay/go_* names
  // are kept as aliases so nothing breaks mid-migration.
  const handleHalIntent = useCallback((intent) => {
    if (intent === 'switch_to_carplay' || intent === 'start_carplay') {
      // Match the + button: navigate first, let CarPlayReceiver mount and POST
      // /api/launch-react-carplay from its useEffect. Eager launch (026d1c6)
      // raced wlrctl focus ahead of React and showed LIVI over the wrong face.
      setScreen(prev => {
        if (prev === 'carplay') {
          postCarplayApi('/api/launch-react-carplay');
        }
        return 'carplay';
      });
    } else if (intent === 'return_to_kiosk' || intent === 'go_clock') {
      postCarplayApi('/api/return-to-kiosk');
      setScreen('factory');
    } else if (intent === 'switch_to_emulator' || intent === 'go_games') setScreen('games');
    else if (intent === 'exit_carplay' || intent === 'go_hal') {
      postCarplayApi('/api/return-to-kiosk');
      setScreen('hal');
    }
  }, []);

  // Listening lives here (not inside the Hal screen) so "HAL, switch to
  // CarPlay" works from any face. It's only suspended once CarPlay is
  // actually on screen — the dongle owns the mic for Siri at that point.
  const {
    state: voiceState,
    transcript: voiceTranscript,
    label: voiceLabel,
    level: sidecarLevel,
    connected: sidecarConnected,
  } = useHalVoice(
    handleHalIntent,
    screen !== 'carplay',
  );

  // − cycles through every face, looping back around to HAL.
  const handleMinus = useCallback((e) => {
    e.stopPropagation();
    setScreen(prev => {
      const idx = FACES.indexOf(prev);
      return FACES[(idx + 1) % FACES.length];
    });
  }, []);

  // + enters CarPlay (auto-opens it); if already in CarPlay, go back to
  // whichever face you were last on.
  const handlePlus = useCallback((e) => {
    e.stopPropagation();
    setScreen(prev => (prev === 'carplay' ? lastFaceRef.current : 'carplay'));
  }, []);

  useEffect(() => {
    document.body.classList.add('clock-active');
    return () => document.body.classList.remove('clock-active');
  }, []);

  return (
    <div style={{ ...styles.container, background: '#000' }}>
      {screen === 'hal'     && (
        <Hal
          onMinus={handleMinus}
          onPlus={handlePlus}
          voiceState={voiceState}
          voiceTranscript={voiceTranscript}
          voiceLabel={voiceLabel}
          sidecarLevel={sidecarLevel}
          sidecarConnected={sidecarConnected}
        />
      )}
      {screen === 'carplay' && <CarPlayReceiver onBack={handlePlus} />}
      {screen === 'factory' && <FactoryClock onMinus={handleMinus} onPlus={handlePlus} />}
      {screen === 'digital' && <DigitalClock onMinus={handleMinus} onPlus={handlePlus} />}
      {screen === 'system'  && <SystemScreen onMinus={handleMinus} onPlus={handlePlus} />}
      {screen === 'games'   && <Games onMinus={handleMinus} onPlus={handlePlus} />}
    </div>
  );
}

const styles = {
  container: {
    width: '320px',
    height: '480px',
    position: 'relative',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
  },
};
