import { useState } from 'react';
import PropTypes from 'prop-types';
import ScreenFrame from './ScreenFrame';
import { FACES, FACE_LABELS } from '../screens';

export default function SettingsScreen({ settings, onUpdate, onBack }) {
  const [bootPicker, setBootPicker] = useState(false);

  const bootScreen = settings.bootScreen || FACES[0];

  return (
    <ScreenFrame variant="amber" buttons={[{ label: 'BACK', onClick: onBack }]}>
      <div style={styles.unit}>
        <div style={styles.headRow}>
          <span style={styles.title}>SETTINGS</span>
        </div>
        <div style={styles.divider} />

        <div style={styles.body}>
          <button
            type="button"
            style={styles.row}
            onClick={() => onUpdate({ showMouse: !settings.showMouse })}
            aria-label="Show mouse pointer"
          >
            <span style={styles.rowLabel}>SHOW MOUSE</span>
            <span style={{ ...styles.rowValue, ...(settings.showMouse ? styles.rowValueOn : null) }}>
              {settings.showMouse ? 'ON' : 'OFF'}
            </span>
          </button>

          <button
            type="button"
            style={styles.row}
            onClick={() => setBootPicker(true)}
            aria-label="Default boot screen"
          >
            <span style={styles.rowLabel}>BOOT SCREEN</span>
            <span style={styles.rowValue}>{FACE_LABELS[bootScreen]} ▾</span>
          </button>
        </div>

        <div style={styles.hint}>
          SHOW MOUSE stays off for the car (no pointer device) — flip it on at
          the bench. BOOT SCREEN takes effect on next launch.
        </div>

        {bootPicker ? (
          <div style={styles.dialog}>
            <div style={styles.dialogTitle}>BOOT SCREEN</div>
            <div style={styles.dialogList}>
              {FACES.map((face) => {
                const isCurrent = face === bootScreen;
                return (
                  <button
                    key={face}
                    type="button"
                    onClick={() => {
                      onUpdate({ bootScreen: face });
                      setBootPicker(false);
                    }}
                    disabled={isCurrent}
                    style={{ ...styles.choice, ...(isCurrent ? styles.choiceCurrent : null) }}
                  >
                    <span style={styles.choiceName}>{FACE_LABELS[face]}</span>
                    <span style={styles.choiceTag}>{isCurrent ? '● ON' : '›'}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" style={styles.dialogCancel} onClick={() => setBootPicker(false)}>
              CANCEL
            </button>
          </div>
        ) : null}
      </div>
    </ScreenFrame>
  );
}

SettingsScreen.propTypes = {
  settings: PropTypes.shape({
    showMouse: PropTypes.bool,
    bootScreen: PropTypes.string,
  }).isRequired,
  onUpdate: PropTypes.func.isRequired,
  onBack: PropTypes.func,
};

const AMBER = '#ffb300';
const MONO = "'Courier New', monospace";

const styles = {
  unit: {
    position: 'relative',
    width: '300px',
    height: '320px',
    boxSizing: 'border-box',
    background: '#0d0d0d',
    border: '2px solid #3a2800',
    borderRadius: '12px',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  headRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: '8px',
  },
  title: {
    color: AMBER,
    fontSize: '17px',
    fontFamily: MONO,
    fontWeight: 'bold',
    letterSpacing: '0.2em',
    textShadow: `0 0 8px ${AMBER}66`,
  },
  divider: { height: '1px', background: '#3a2800' },
  body: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'stretch',
    gap: '8px',
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%',
    flex: 1,
    minHeight: '88px',
    background: '#161208',
    border: '2px solid #3a2800',
    borderRadius: '10px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  rowLabel: {
    color: '#888',
    fontSize: '15px',
    fontFamily: MONO,
    fontWeight: 'bold',
    letterSpacing: '0.12em',
  },
  rowValue: {
    color: AMBER,
    fontSize: '22px',
    fontWeight: 'bold',
    fontFamily: MONO,
    maxWidth: '260px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowValueOn: { color: '#88ff88' },
  hint: {
    color: '#665533',
    fontSize: '10px',
    fontFamily: MONO,
    lineHeight: 1.4,
    flexShrink: 0,
  },

  dialog: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(8,6,0,0.97)',
    borderRadius: '12px',
    padding: '14px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  dialogTitle: {
    color: AMBER,
    fontSize: '20px',
    fontFamily: MONO,
    fontWeight: 'bold',
    letterSpacing: '0.15em',
    textAlign: 'center',
    flexShrink: 0,
  },
  dialogList: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  choice: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    minHeight: '84px',
    padding: '20px 16px',
    background: '#161208',
    border: '2px solid #3a2800',
    borderRadius: '10px',
    color: '#eee',
    fontFamily: MONO,
    fontSize: '24px',
    fontWeight: 'bold',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    textAlign: 'left',
  },
  choiceCurrent: {
    background: '#2a1c00',
    borderColor: AMBER,
    color: AMBER,
    cursor: 'default',
  },
  choiceName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  choiceTag: { flexShrink: 0, fontSize: '16px', opacity: 0.85 },
  dialogCancel: {
    flexShrink: 0,
    height: '56px',
    background: '#1a1000',
    border: '2px solid #7a5500',
    borderRadius: '10px',
    color: AMBER,
    fontSize: '18px',
    fontWeight: 'bold',
    fontFamily: MONO,
    letterSpacing: '0.1em',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
};
