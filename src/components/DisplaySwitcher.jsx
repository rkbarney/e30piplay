import { useState, useCallback } from 'react';
import BootScreen      from './BootScreen';
import LogoIntro       from './LogoIntro';
import FactoryClock    from './FactoryClock';
import DigitalClock    from './DigitalClock';
import AnalogClock     from './AnalogClock';
import CarPlayReceiver from './CarPlayReceiver';

// Faces cycled by the − button
const CLOCK_FACES = ['factory', 'digital', 'analog'];

export default function DisplaySwitcher() {
  const [screen,    setScreen]    = useState('boot');
  const [clockFace, setClockFace] = useState('factory');

  const handleBootComplete = useCallback(() => setScreen('logo'),    []);
  const handleLogoComplete = useCallback(() => setScreen('clock'),   []);

  // − cycles through clock faces
  const handleMinus = useCallback((e) => {
    e.stopPropagation();
    setClockFace(prev => {
      const idx = CLOCK_FACES.indexOf(prev);
      return CLOCK_FACES[(idx + 1) % CLOCK_FACES.length];
    });
  }, []);

  // + enters CarPlay; if already in CarPlay, go back to clock
  const handlePlus = useCallback((e) => {
    e.stopPropagation();
    setScreen(prev => prev === 'carplay' ? 'clock' : 'carplay');
  }, []);

  const isClockScreen = screen === 'clock';

  return (
    <div style={styles.container}>
      {screen === 'boot'    && <BootScreen onComplete={handleBootComplete} />}
      {screen === 'logo'    && <LogoIntro  onComplete={handleLogoComplete} />}
      {screen === 'carplay' && <CarPlayReceiver onBack={handlePlus} />}

      {isClockScreen && clockFace === 'factory' &&
        <FactoryClock onMinus={handleMinus} onPlus={handlePlus} />}
      {isClockScreen && clockFace === 'digital' &&
        <DigitalClock onMinus={handleMinus} onPlus={handlePlus} />}
      {isClockScreen && clockFace === 'analog' &&
        <AnalogClock  onMinus={handleMinus} onPlus={handlePlus} />}
    </div>
  );
}

const styles = {
  container: {
    width: '320px',
    height: '480px',
    position: 'relative',
    background: '#000',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
  },
};
