import { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

const LOGO = [
  '  ███╗   ███╗      ████████╗███████╗ ██████╗██╗  ██╗',
  '  ████╗ ████║         ██╔══╝██╔════╝██╔════╝██║  ██║',
  '  ██╔████╔██║         ██║   █████╗  ██║     ███████║',
  '  ██║╚██╔╝██║         ██║   ██╔══╝  ██║     ██╔══██║',
  '  ██║ ╚═╝ ██║         ██║   ███████╗╚██████╗██║  ██║',
  '  ╚═╝     ╚═╝         ╚═╝   ╚══════╝ ╚═════╝╚═╝  ╚═╝',
];

const TAGLINE = '  S52 SOLUTIONS — E30 SYSTEM v1.0';

const BOOT_MESSAGES = [
  '[  0.001]  KERNEL: Initializing S52 subsystems...',
  '[  0.043]  CPU: ARM Cortex-A76 @ 2.4GHz — 4 cores online',
  '[  0.089]  MEM: 8192MB LPDDR4X — OK',
  '[  0.134]  DISPLAY: 480x320 HDMI — framebuffer ready',
  '[  0.201]  TOUCH: SPI touchscreen — calibrated',
  '[  0.312]  AUDIO: USB DAC → 3.5mm AUX — OK',
  '[  0.445]  USB:  Carlinkit dongle — detected',
  '[  0.520]  NET:  Wireless interface — up',
  '[  0.680]  CARPLAY: react-carplay receiver — loaded',
  '[  0.891]  ENGINE: S52 3.2L I6 — all systems nominal',
  '[  1.120]  M-TECH: Sport mode — engaged',
  '[  1.340]  S52 Solutions display — READY',
];

const BOOT_DURATION_MS = 4000;

export default function BootScreen({ onComplete }) {
  const [visibleLines, setVisibleLines] = useState([]);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const startTime = useRef(Date.now());
  const rafRef = useRef(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    const totalLines = BOOT_MESSAGES.length;

    function tick() {
      const elapsed = Date.now() - startTime.current;
      const pct = Math.min(elapsed / BOOT_DURATION_MS, 1);
      const lineCount = Math.floor(pct * totalLines);

      setProgress(Math.round(pct * 100));
      setVisibleLines(BOOT_MESSAGES.slice(0, lineCount));

      if (pct < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDone(true);
        // Hold the complete screen for 800ms then hand off
        timeoutRef.current = setTimeout(() => onComplete?.(), 800);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(timeoutRef.current);
    };
  }, [onComplete]);

  const barFilled = Math.round(progress / 2); // 50 chars wide
  const barEmpty  = 50 - barFilled;

  return (
    <div style={styles.root}>
      {/* Logo */}
      <div style={styles.logoBlock}>
        {LOGO.map((line, i) => (
          <div key={i} style={styles.logoLine}>{line}</div>
        ))}
        <div style={styles.tagline}>{TAGLINE}</div>
      </div>

      {/* Divider */}
      <div style={styles.divider}>{'─'.repeat(60)}</div>

      {/* Scrolling log */}
      <div style={styles.logArea}>
        {visibleLines.map((line, i) => (
          <div key={i} style={styles.logLine}>{line}</div>
        ))}
        {!done && <span style={styles.cursor}>█</span>}
      </div>

      {/* Progress bar */}
      <div style={styles.progressSection}>
        <div style={styles.divider}>{'─'.repeat(60)}</div>
        <div style={styles.progressRow}>
          <span style={styles.progressLabel}>BOOT</span>
          <span style={styles.progressBar}>
            {'['}
            <span style={styles.filled}>{'█'.repeat(barFilled)}</span>
            <span style={styles.empty}>{'░'.repeat(barEmpty)}</span>
            {']'}
          </span>
          <span style={styles.progressPct}>{String(progress).padStart(3, ' ')}%</span>
        </div>
        {done && (
          <div style={styles.readyLine}>
            ✓ ALL SYSTEMS NOMINAL — LAUNCHING S52 DISPLAY
          </div>
        )}
      </div>
    </div>
  );
}

BootScreen.propTypes = {
  onComplete: PropTypes.func,
};

const styles = {
  root: {
    width: '320px',
    height: '480px',
    background: '#000',
    color: '#ffb300',
    fontFamily: "'Courier New', monospace",
    fontSize: '9px',
    lineHeight: 1.35,
    display: 'flex',
    flexDirection: 'column',
    padding: '6px 8px',
    overflow: 'hidden',
  },
  logoBlock: {
    marginBottom: '3px',
  },
  logoLine: {
    fontSize: '7.5px',
    lineHeight: 1.2,
    letterSpacing: '0.05em',
    color: '#ffb300',
    whiteSpace: 'pre',
  },
  tagline: {
    fontSize: '8px',
    color: '#ffb300',
    marginTop: '2px',
    letterSpacing: '0.12em',
    whiteSpace: 'pre',
  },
  divider: {
    color: '#3a2800',
    fontSize: '9px',
    marginBottom: '2px',
    whiteSpace: 'pre',
  },
  logArea: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
  },
  logLine: {
    color: '#cc8800',
    fontSize: '9px',
    lineHeight: 1.35,
    whiteSpace: 'pre',
  },
  cursor: {
    color: '#ffb300',
    animation: 'blink 0.6s step-end infinite',
  },
  progressSection: {
    marginTop: '3px',
  },
  progressRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '2px',
  },
  progressLabel: {
    color: '#ffb300',
    fontSize: '9px',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
  },
  progressBar: {
    flex: 1,
    fontSize: '9px',
    whiteSpace: 'pre',
  },
  filled: {
    color: '#ffb300',
  },
  empty: {
    color: '#3a2800',
  },
  progressPct: {
    color: '#ffb300',
    fontSize: '9px',
    minWidth: '30px',
    textAlign: 'right',
  },
  readyLine: {
    color: '#ffb300',
    fontSize: '9px',
    marginTop: '2px',
    letterSpacing: '0.05em',
    animation: 'blink 0.8s step-end 3',
  },
};
