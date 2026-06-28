import { useState, useCallback, useEffect, useRef } from 'react';
import FactoryClock    from './FactoryClock';
import DigitalClock    from './DigitalClock';
import CarPlayReceiver from './CarPlayReceiver';
import SystemScreen    from './SystemScreen';
import SettingsScreen  from './SettingsScreen';
import MapsReceiver    from './MapsReceiver';
import Games           from './Games';
import Hal             from './Hal';
import useHalVoice     from '../useHalVoice';
import useSettings     from '../useSettings';
import { FACES, DEFAULT_BOOT_SCREEN } from '../screens';

const BUILD_BOOT_SCREEN = import.meta.env.VITE_BOOT_SCREEN ?? DEFAULT_BOOT_SCREEN;
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
  const [settings, updateSettings] = useSettings();
  const bootScreen = (settings.bootScreen && FACES.includes(settings.bootScreen))
    ? settings.bootScreen
    : BUILD_BOOT_SCREEN;

  // `screen` is either a face name (from FACES), 'carplay', or 'settings'.
  const [screen, setScreen] = useState(bootScreen);
  const lastFaceRef = useRef(bootScreen);
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

  const openSettings  = useCallback(() => setScreen('settings'), []);
  const closeSettings = useCallback(() => setScreen('system'), []);

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
          sidecarLevel={sidecarLevel}
          sidecarConnected={sidecarConnected}
        />
      )}
      {screen === 'carplay'  && <CarPlayReceiver onBack={handlePlus} />}
      {screen === 'factory'  && <FactoryClock onMinus={handleMinus} onPlus={handlePlus} />}
      {screen === 'digital'  && <DigitalClock onMinus={handleMinus} onPlus={handlePlus} />}
      {screen === 'system'   && <SystemScreen onMinus={handleMinus} onPlus={handlePlus} onSettings={openSettings} />}
      {screen === 'maps'     && <MapsReceiver onMinus={handleMinus} onPlus={handlePlus} />}
      {screen === 'games'    && <Games onMinus={handleMinus} onPlus={handlePlus} />}
      {screen === 'settings' && (
        <SettingsScreen settings={settings} onUpdate={updateSettings} onBack={closeSettings} />
      )}
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
