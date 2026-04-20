/**
 * CarPlayReceiver
 *
 * Placeholder component — will be replaced with react-carplay integration.
 * https://github.com/rhysmorgan134/react-carplay
 *
 * When the Carlinkit dongle is plugged in and react-carplay is installed:
 *   npm install react-carplay
 *
 * Then swap this file for the real receiver:
 *   import Carplay from 'react-carplay';
 *   <Carplay width={480} height={272} fps={60} />
 *
 * The dongle handles all iPhone ↔ Pi communication; this component
 * just renders whatever the dongle streams.
 */

export default function CarPlayReceiver() {
  return (
    <div style={styles.root}>
      {/* Status bar */}
      <div style={styles.statusBar}>
        <span style={styles.brand}>S52 SOLUTIONS</span>
        <span style={styles.mode}>CARPLAY</span>
      </div>

      {/* Main area */}
      <div style={styles.main}>
        <div style={styles.iconWrap}>
          {/* SVG so the icon shows without emoji fonts (Chromium/Linux kiosk) */}
          <div style={styles.bigIcon} aria-hidden>
            <svg width="56" height="56" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <rect
                x="6.5"
                y="2.5"
                width="11"
                height="19"
                rx="2.2"
                fill="none"
                stroke="#ffb300"
                strokeWidth="1.4"
              />
              <line x1="9" y1="4.5" x2="15" y2="4.5" stroke="#ffb300" strokeWidth="1" opacity="0.35" />
              <circle cx="12" cy="18.5" r="1.1" fill="#ffb300" />
            </svg>
          </div>
          <div style={styles.title}>CarPlay</div>
        </div>

        <div style={styles.instructions}>
          <div style={styles.step}>1  Plug Carlinkit dongle into Pi USB port</div>
          <div style={styles.step}>2  Enable Wireless CarPlay on iPhone</div>
          <div style={styles.step}>3  Select &quot;S52 Solutions&quot; from CarPlay list</div>
          <div style={styles.step}>4  Install react-carplay:  npm install react-carplay</div>
          <div style={styles.step}>5  Replace this component with &lt;Carplay /&gt;</div>
        </div>
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <span style={styles.footerLeft}>CARLINKIT WIRELESS DONGLE</span>
        <span style={styles.footerRight}>WAITING FOR CONNECTION...</span>
      </div>

      {/* Blinking dot */}
      <div style={styles.waitDot} />
    </div>
  );
}

const styles = {
  root: {
    width: '320px',
    height: '480px',
    background: '#000',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: "'Courier New', monospace",
    overflow: 'hidden',
  },
  statusBar: {
    height: '22px',
    background: '#0a0a0a',
    borderBottom: '1px solid #3a2800',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 10px',
  },
  brand: {
    color: '#ffb300',
    fontSize: '9px',
    letterSpacing: '0.2em',
    fontWeight: 'bold',
  },
  mode: {
    color: '#ffb300',
    fontSize: '9px',
    letterSpacing: '0.15em',
  },
  main: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '32px',
    padding: '0 24px',
  },
  iconWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
  },
  bigIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 0,
  },
  title: {
    color: '#ffb300',
    fontSize: '12px',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
  },
  instructions: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '7px',
  },
  step: {
    color: '#cc8800',
    fontSize: '9.5px',
    lineHeight: 1.3,
    borderLeft: '2px solid #3a2800',
    paddingLeft: '8px',
  },
  footer: {
    height: '22px',
    background: '#0a0a0a',
    borderTop: '1px solid #3a2800',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 10px',
  },
  footerLeft: {
    color: '#3a2800',
    fontSize: '8px',
    letterSpacing: '0.12em',
  },
  footerRight: {
    color: '#ffb300',
    fontSize: '8px',
    letterSpacing: '0.1em',
    animation: 'blink 1.2s step-end infinite',
  },
  waitDot: {
    position: 'absolute',
    bottom: '28px',
    right: '12px',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: '#ffb300',
    animation: 'blink 1s ease-in-out infinite',
  },
};
