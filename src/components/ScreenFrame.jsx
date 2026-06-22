/**
 * ScreenFrame — the shared 320×480 chrome every screen sits in, so the dialog
 * (clock / system / carplay) always occupies the same centered area and the two
 * action buttons are fixed in the same spot at the bottom.
 *
 * Proportions follow the analog clock (the reference): ~300px content column,
 * a 128×66 button pair pinned to the bottom band.
 *
 *   <ScreenFrame variant="amber" buttons={[{label:'−',onClick:a},{label:'+',onClick:b}]}>
 *     ...dialog content...
 *   </ScreenFrame>
 *
 * `buttons` entries: { label, onClick, disabled?, key? }. Single-character labels
 * (−/+) render large; word labels (BACK/RESTART) render smaller. Pass [] for no
 * buttons (e.g. the boot screen).
 */

import PropTypes from 'prop-types';

const VARIANTS = {
  amber: { color: '#ffb300', border: '#7a5500', bg: '#1a1000' },
  mono:  { color: '#ffffff', border: '#555555', bg: '#1a1a1a' },
};

export default function ScreenFrame({ children, variant = 'amber', buttons = [] }) {
  const v = VARIANTS[variant] || VARIANTS.amber;
  const single = buttons.length === 1; // one button spans the full button-row width

  return (
    <div style={styles.root}>
      <div style={styles.content}>{children}</div>

      <div style={{ ...styles.buttons, justifyContent: single ? 'center' : 'space-between' }}>
        {buttons.map((b, i) => {
          const big = String(b.label).length <= 1;
          return (
            <button
              key={b.key ?? b.label ?? i}
              type="button"
              onClick={b.onClick}
              disabled={b.disabled}
              style={{
                ...styles.btn,
                width: single ? '100%' : '128px',
                color: v.color,
                background: v.bg,
                border: `2px solid ${v.border}`,
                fontSize: big ? '44px' : '16px',
                letterSpacing: big ? 0 : '0.06em',
                opacity: b.disabled ? 0.4 : 1,
                cursor: b.disabled ? 'default' : 'pointer',
              }}
            >
              {b.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

ScreenFrame.propTypes = {
  children: PropTypes.node,
  variant: PropTypes.oneOf(['amber', 'mono']),
  buttons: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.node,
      onClick: PropTypes.func,
      disabled: PropTypes.bool,
      key: PropTypes.string,
    })
  ),
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
  },
  // The dialog area: every screen's main element centers here, same region.
  content: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '6px 0 0',
  },
  // Fixed bottom band — identical position/size on every screen.
  buttons: {
    flexShrink: 0,
    width: '300px',
    margin: '0 auto',
    paddingTop: '8px',
    paddingBottom: '20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  btn: {
    width: '128px',
    height: '66px',
    borderRadius: '12px',
    lineHeight: 1,
    fontFamily: "'Courier New', monospace",
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
    userSelect: 'none',
  },
};
