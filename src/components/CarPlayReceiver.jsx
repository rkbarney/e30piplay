/**
 * CarPlayReceiver
 *
 * Placeholder — real CarPlay UI is not wired into this Chromium kiosk yet.
 *
 * Upstream reference project (Electron, not an npm library):
 *   https://github.com/rhysmorgan134/react-carplay
 * Install via their setup-pi.sh or AppImage releases — `npm install react-carplay`
 * does not exist on the registry (404).
 *
 * A future path would bridge node-carplay / WebSockets / video into this React app;
 * that integration is TBD.
 */

import PropTypes from 'prop-types';

export default function CarPlayReceiver({ onBack }) {
  return (
    <div style={styles.root}>
      {/* Status bar */}
      <div style={styles.statusBar}>
        <div style={styles.statusLeft}>
          {typeof onBack === 'function' && (
            <button
              type="button"
              style={styles.backBtn}
              onClick={(e) => {
                e.stopPropagation();
                onBack(e);
              }}
            >
              ← back
            </button>
          )}
          <span style={styles.brand}>S52 SOLUTIONS</span>
        </div>
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
          <div style={styles.step}>4  CarPlay UI: github.com/rhysmorgan134/react-carplay — Releases AppImage or setup-pi.sh (Electron app; not on npm)</div>
          <div style={styles.step}>5  In-browser CarPlay in this kiosk is not implemented yet</div>
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

CarPlayReceiver.propTypes = {
  onBack: PropTypes.func,
};

const styles = {
  root: {
    width: '320px',
    height: '480px',
    background: '#000',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: "'Courier New', monospace",
    overflow: 'hidden',
    position: 'relative',
  },
  statusBar: {
    height: '22px',
    background: '#0a0a0a',
    borderBottom: '1px solid #3a2800',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 8px',
    gap: '6px',
    flexShrink: 0,
  },
  statusLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: 0,
    flex: 1,
  },
  backBtn: {
    flexShrink: 0,
    padding: '1px 5px',
    fontFamily: 'inherit',
    fontSize: '8px',
    lineHeight: 1.2,
    color: '#ffb300',
    background: 'rgba(0,0,0,0.35)',
    border: '1px solid #3a2800',
    borderRadius: '2px',
    cursor: 'pointer',
    letterSpacing: '0.06em',
  },
  brand: {
    color: '#ffb300',
    fontSize: '9px',
    letterSpacing: '0.2em',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  mode: {
    color: '#ffb300',
    fontSize: '9px',
    letterSpacing: '0.15em',
    flexShrink: 0,
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
