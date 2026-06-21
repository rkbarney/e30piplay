import { useState, useCallback, useEffect } from 'react';
import LogoIntro       from './LogoIntro';
import FactoryClock    from './FactoryClock';
import DigitalClock    from './DigitalClock';
import AnalogClock     from './AnalogClock';
import CarPlayReceiver from './CarPlayReceiver';
import SystemScreen    from './SystemScreen';

// Faces cycled by the − button
const CLOCK_FACES = ['factory', 'digital', 'clock', 'system'];

export default function DisplaySwitcher() {
  // Boot goes straight to the spinning roundel ('logo'), then to the clock.
  const [screen,    setScreen]    = useState('logo');
  const [clockFace, setClockFace] = useState('factory');

  const handleLogoComplete = useCallback(() => setScreen('clock'), []);

  // − cycles through clock faces
  const handleMinus = useCallback((e) => {
    e.stopPropagation();
    setClockFace(prev => {
      const idx = CLOCK_FACES.indexOf(prev);
      return CLOCK_FACES[(idx + 1) % CLOCK_FACES.length];
    });
  }, []);

  // After backing out of CarPlay, the next visit shows reconnect instead of auto-launch.
  const [carplayNeedsReconnect, setCarplayNeedsReconnect] = useState(false);

  // + enters CarPlay; if already in CarPlay, go back to clock
  const handlePlus = useCallback((e) => {
    e.stopPropagation();
    setScreen(prev => {
      if (prev === 'carplay') {
        setCarplayNeedsReconnect(true);
        return 'clock';
      }
      return 'carplay';
    });
  }, []);

  const handleCarPlayConnected = useCallback(() => setCarplayNeedsReconnect(false), []);

  const isClockScreen = screen === 'clock';

  // Boot timeline (spinning roundel) is white so the startup white flash blends
  // in; the screen flips to black once the clock / CarPlay surface takes over.
  const darkScreen = screen === 'clock' || screen === 'carplay';
  useEffect(() => {
    document.body.classList.toggle('clock-active', darkScreen);
    return () => document.body.classList.remove('clock-active');
  }, [darkScreen]);

  return (
    <div style={{ ...styles.container, background: darkScreen ? '#000' : '#fff' }}>
      {screen === 'logo'    && <LogoIntro  onComplete={handleLogoComplete} />}
      {screen === 'carplay' && (
        <CarPlayReceiver
          onBack={handlePlus}
          reconnect={carplayNeedsReconnect}
          onConnected={handleCarPlayConnected}
        />
      )}

      {isClockScreen && clockFace === 'factory' &&
        <FactoryClock onMinus={handleMinus} onPlus={handlePlus} />}
      {isClockScreen && clockFace === 'digital' &&
        <DigitalClock onMinus={handleMinus} onPlus={handlePlus} />}
      {isClockScreen && clockFace === 'clock' &&
        <AnalogClock  onMinus={handleMinus} onPlus={handlePlus} />}
      {isClockScreen && clockFace === 'system' &&
        <SystemScreen onMinus={handleMinus} onPlus={handlePlus} />}
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
