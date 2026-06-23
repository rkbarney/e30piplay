/**
 * Games — Phase 1: self-contained Tetris driven by keyboard or a USB
 * NES-style gamepad via the Web Gamepad API.
 *
 * Keyboard:
 *   ←/→        move
 *   ↓           soft-drop
 *   ↑ / Z       rotate CW
 *   Space       hard-drop
 *   P / Escape  pause
 *   any key     restart when game over
 *
 * Gamepad (standard layout – works for 8BitDo / RetroLink NES pads):
 *   D-pad ←/→/↓  move        D-pad ↑ / A (btn 0)  rotate
 *   B (btn 1)    hard-drop   Start (btn 9)         pause / restart
 *   Select (btn 8) also pauses/restarts
 *
 * Phase 2 note: a WASM GB core can be loaded here once the ROM-loading UX
 * and licensing questions are settled (see issue #9).
 */

import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import ScreenFrame from './ScreenFrame';

// ─── Tetromino data ────────────────────────────────────────────────────────────
const PIECES = [
  { shape: [[1,1,1,1]],               color: '#00f0f0' }, // I  cyan
  { shape: [[1,1],[1,1]],             color: '#f0f000' }, // O  yellow
  { shape: [[0,1,0],[1,1,1]],         color: '#a000f0' }, // T  purple
  { shape: [[0,1,1],[1,1,0]],         color: '#00f000' }, // S  green
  { shape: [[1,1,0],[0,1,1]],         color: '#f00000' }, // Z  red
  { shape: [[1,0,0],[1,1,1]],         color: '#0000f0' }, // J  blue
  { shape: [[0,0,1],[1,1,1]],         color: '#f0a000' }, // L  orange
];

const COLS = 10;
const ROWS = 20;
const CELL = 16; // px per cell → board is 160 × 320 px

// Keys that need their default browser action suppressed (scrolling)
const SCROLL_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Space']);

// Points awarded for clearing 1–4 lines at once (multiplied by level)
const LINE_CLEAR_POINTS = [0, 100, 300, 500, 800];

// ─── Pure helpers ──────────────────────────────────────────────────────────────
function randPiece() {
  return { ...PIECES[Math.floor(Math.random() * PIECES.length)] };
}

function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function rotateCW(shape) {
  const rows = shape.length;
  const cols = shape[0].length;
  return Array.from({ length: cols }, (_, c) =>
    Array.from({ length: rows }, (_, r) => shape[rows - 1 - r][c]),
  );
}

/**
 * True if `shape` placed at `pos` {r, c} fits on `board`.
 * Cells above row 0 (spawn zone) are allowed.
 */
function fits(board, shape, pos) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nr = pos.r + r;
      const nc = pos.c + c;
      if (nr >= ROWS || nc < 0 || nc >= COLS) return false;
      if (nr >= 0 && board[nr][nc]) return false;
    }
  }
  return true;
}

function newGame() {
  const piece = randPiece();
  return {
    board:  emptyBoard(),
    piece,
    pos:    { r: 0, c: Math.floor((COLS - piece.shape[0].length) / 2) },
    next:   randPiece(),
    score:  0,
    lines:  0,
    level:  1,
    over:   false,
    paused: false,
    dropMs: 0,
  };
}

/** Milliseconds between automatic drops for the given level. */
function dropInterval(level) {
  return Math.max(80, 800 - (level - 1) * 70);
}

// ─── Component ─────────────────────────────────────────────────────────────────
export default function Games({ onBack }) {
  const canvasRef = useRef(null);
  const gsRef     = useRef(null); // mutable game state — no React re-renders needed
  const heldRef   = useRef({});   // { [key/padKey]: { action, nextRepeat } }
  const padPrev   = useRef({});   // previous frame's gamepad button state

  useEffect(() => {
    gsRef.current = newGame();

    // ── Layout constants ────────────────────────────────────────────────────
    const BX = 10;                    // board left edge on canvas
    const BY = 36;                    // board top edge (header above)
    const PX = BX + COLS * CELL + 8; // right-panel x origin

    // ── Drawing helpers ─────────────────────────────────────────────────────
    function drawCell(ctx, x, y, color) {
      ctx.fillStyle = color;
      ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(x + 1, y + 1, CELL - 2, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x + 1, y + CELL - 4, CELL - 2, 3);
    }

    function render() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const W   = canvas.width;
      const H   = canvas.height;
      const g   = gsRef.current;

      // Background
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);

      // ── Header ─────────────────────────────────────────────────────────
      ctx.font      = 'bold 13px "Courier New",monospace';
      ctx.fillStyle = '#ffb300';
      ctx.textAlign = 'center';
      ctx.fillText('TETRIS', BX + (COLS * CELL) / 2, 22);
      ctx.textAlign = 'left';

      // ── Board background + grid ─────────────────────────────────────────
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(BX, BY, COLS * CELL, ROWS * CELL);

      ctx.strokeStyle = '#181818';
      ctx.lineWidth   = 0.5;
      for (let r = 0; r <= ROWS; r++) {
        ctx.beginPath();
        ctx.moveTo(BX, BY + r * CELL);
        ctx.lineTo(BX + COLS * CELL, BY + r * CELL);
        ctx.stroke();
      }
      for (let c = 0; c <= COLS; c++) {
        ctx.beginPath();
        ctx.moveTo(BX + c * CELL, BY);
        ctx.lineTo(BX + c * CELL, BY + ROWS * CELL);
        ctx.stroke();
      }

      // ── Placed cells ─────────────────────────────────────────────────
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (g.board[r][c]) {
            drawCell(ctx, BX + c * CELL, BY + r * CELL, g.board[r][c]);
          }
        }
      }

      // ── Ghost piece (drop preview) ────────────────────────────────────
      let ghostR = g.pos.r;
      while (fits(g.board, g.piece.shape, { r: ghostR + 1, c: g.pos.c })) ghostR++;
      if (ghostR !== g.pos.r) {
        ctx.globalAlpha = 0.18;
        for (let r = 0; r < g.piece.shape.length; r++) {
          for (let c = 0; c < g.piece.shape[r].length; c++) {
            if (g.piece.shape[r][c] && ghostR + r >= 0) {
              drawCell(
                ctx,
                BX + (g.pos.c + c) * CELL,
                BY + (ghostR + r) * CELL,
                g.piece.color,
              );
            }
          }
        }
        ctx.globalAlpha = 1;
      }

      // ── Active piece ──────────────────────────────────────────────────
      for (let r = 0; r < g.piece.shape.length; r++) {
        for (let c = 0; c < g.piece.shape[r].length; c++) {
          if (g.piece.shape[r][c] && g.pos.r + r >= 0) {
            drawCell(
              ctx,
              BX + (g.pos.c + c) * CELL,
              BY + (g.pos.r + r) * CELL,
              g.piece.color,
            );
          }
        }
      }

      // ── Board border ──────────────────────────────────────────────────
      ctx.strokeStyle = '#2a2a2a';
      ctx.lineWidth   = 1;
      ctx.strokeRect(BX - 1, BY - 1, COLS * CELL + 2, ROWS * CELL + 2);

      // ── Right panel ───────────────────────────────────────────────────
      function panelLabel(text, y) {
        ctx.font      = '7px "Courier New",monospace';
        ctx.fillStyle = '#555';
        ctx.fillText(text, PX, y);
      }
      function panelValue(text, y) {
        ctx.font      = 'bold 11px "Courier New",monospace';
        ctx.fillStyle = '#ffb300';
        ctx.fillText(text, PX, y);
      }

      panelLabel('SCORE',  BY + 12);
      panelValue(String(g.score).padStart(6, '0'), BY + 26);
      panelLabel('LINES',  BY + 50);
      panelValue(String(g.lines),                  BY + 62);
      panelLabel('LEVEL',  BY + 86);
      panelValue(String(g.level),                  BY + 98);
      panelLabel('NEXT',   BY + 122);

      // Next-piece mini-preview (9 px per mini-cell)
      const NS  = 9;
      const npx = PX;
      const npy = BY + 130;
      for (let r = 0; r < g.next.shape.length; r++) {
        for (let c = 0; c < g.next.shape[r].length; c++) {
          if (g.next.shape[r][c]) {
            ctx.fillStyle = g.next.color;
            ctx.fillRect(npx + c * NS + 1, npy + r * NS + 1, NS - 2, NS - 2);
          }
        }
      }

      // ── Controller indicator ──────────────────────────────────────────
      const connectedPads = typeof navigator.getGamepads === 'function'
        ? Array.from(navigator.getGamepads()).filter(Boolean)
        : [];
      const hasCtrl = connectedPads.length > 0;

      ctx.fillStyle = hasCtrl ? '#00cc66' : '#2a2a2a';
      ctx.beginPath();
      ctx.arc(PX + 3, BY + 192, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.font      = '6px "Courier New",monospace';
      ctx.fillStyle = hasCtrl ? '#00cc66' : '#444';
      ctx.fillText(hasCtrl ? 'CTL OK' : 'NO CTL', PX + 10, BY + 195);

      // ── Game-over overlay ─────────────────────────────────────────────
      if (g.over) {
        const cx = BX + (COLS * CELL) / 2;
        const cy = BY + (ROWS * CELL) / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.82)';
        ctx.fillRect(BX, BY, COLS * CELL, ROWS * CELL);
        ctx.font      = 'bold 16px "Courier New",monospace';
        ctx.fillStyle = '#ff4444';
        ctx.textAlign = 'center';
        ctx.fillText('GAME', cx, cy - 14);
        ctx.fillText('OVER', cx, cy + 6);
        ctx.font      = '8px "Courier New",monospace';
        ctx.fillStyle = '#888';
        ctx.fillText('A / SPACE  to restart', cx, cy + 26);
        ctx.textAlign = 'left';
      }

      // ── Pause overlay ─────────────────────────────────────────────────
      if (g.paused && !g.over) {
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(BX, BY, COLS * CELL, ROWS * CELL);
        ctx.font      = 'bold 13px "Courier New",monospace';
        ctx.fillStyle = '#ffb300';
        ctx.textAlign = 'center';
        ctx.fillText('PAUSED', BX + (COLS * CELL) / 2, BY + (ROWS * CELL) / 2);
        ctx.textAlign = 'left';
      }
    }

    // ── Game logic ──────────────────────────────────────────────────────────
    function lockPiece() {
      const g = gsRef.current;
      // Stamp piece onto the board (skip cells above the visible area)
      const b = g.board.map(r => [...r]);
      for (let r = 0; r < g.piece.shape.length; r++) {
        for (let c = 0; c < g.piece.shape[r].length; c++) {
          if (g.piece.shape[r][c] && g.pos.r + r >= 0) {
            b[g.pos.r + r][g.pos.c + c] = g.piece.color;
          }
        }
      }
      // Remove completed lines
      const kept    = b.filter(row => row.some(v => !v));
      const cleared = ROWS - kept.length;
      g.board = [
        ...Array.from({ length: cleared }, () => Array(COLS).fill(0)),
        ...kept,
      ];
      g.score  += LINE_CLEAR_POINTS[Math.min(cleared, 4)] * g.level;
      g.lines  += cleared;
      g.level   = Math.floor(g.lines / 10) + 1;
      // Spawn the next piece
      g.piece  = g.next;
      g.pos    = { r: 0, c: Math.floor((COLS - g.next.shape[0].length) / 2) };
      g.next   = randPiece();
      g.dropMs = 0;
      if (!fits(g.board, g.piece.shape, g.pos)) g.over = true;
    }

    function tryMove(dx, dy) {
      const g  = gsRef.current;
      if (g.over || g.paused) return false;
      const np = { r: g.pos.r + dy, c: g.pos.c + dx };
      if (!fits(g.board, g.piece.shape, np)) return false;
      g.pos = np;
      return true;
    }

    function tryRotate() {
      const g   = gsRef.current;
      if (g.over || g.paused) return;
      const rot = rotateCW(g.piece.shape);
      // SRS-style wall-kick: try centre, right, left, far-right, far-left, above
      for (const [dx, dy] of [[0,0],[1,0],[-1,0],[2,0],[-2,0],[0,-1]]) {
        const np = { r: g.pos.r + dy, c: g.pos.c + dx };
        if (fits(g.board, rot, np)) {
          g.piece = { ...g.piece, shape: rot };
          g.pos   = np;
          return;
        }
      }
    }

    function hardDrop() {
      const g = gsRef.current;
      if (g.over || g.paused) return;
      while (fits(g.board, g.piece.shape, { r: g.pos.r + 1, c: g.pos.c })) {
        g.pos.r++;
      }
      lockPiece();
    }

    // ── Action dispatch ─────────────────────────────────────────────────────
    const KEY_TO_ACTION = {
      ArrowLeft:  'left',
      ArrowRight: 'right',
      ArrowDown:  'down',
      ArrowUp:    'rotateCW',
      KeyZ:       'rotateCW',
      Space:      'hardDrop',
      KeyP:       'pause',
      Escape:     'pause',
    };
    const REPEATABLE    = new Set(['left', 'right', 'down']);
    const REPEAT_DELAY  = 220; // ms before auto-repeat kicks in
    const REPEAT_RATE   =  80; // ms between repeats

    function fireAction(action) {
      const g = gsRef.current;
      switch (action) {
        case 'left':     tryMove(-1, 0); break;
        case 'right':    tryMove( 1, 0); break;
        case 'down':     tryMove( 0, 1); break;
        case 'rotateCW': tryRotate();    break;
        case 'hardDrop': hardDrop();     break;
        case 'pause':
          if (!g.over) g.paused = !g.paused;
          break;
        default: break;
      }
    }

    // ── Keyboard handling ───────────────────────────────────────────────────
    function handleKeyDown(e) {
      if (SCROLL_KEYS.has(e.code)) e.preventDefault();

      const g = gsRef.current;

      if (g.over) {
        // Any key restarts; track in held to ignore browser key-repeat
        if (!heldRef.current[e.code]) {
          heldRef.current[e.code] = { action: 'restart', nextRepeat: Infinity };
          gsRef.current = newGame();
        }
        return;
      }

      const action = KEY_TO_ACTION[e.code];
      if (!action) return;

      if (!heldRef.current[e.code]) {
        heldRef.current[e.code] = {
          action,
          nextRepeat: REPEATABLE.has(action)
            ? performance.now() + REPEAT_DELAY
            : Infinity,
        };
        fireAction(action);
      }
    }

    function handleKeyUp(e) {
      delete heldRef.current[e.code];
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup',   handleKeyUp);

    // ── Main RAF loop ───────────────────────────────────────────────────────
    let raf;
    let prev = performance.now();

    function loop(now) {
      raf  = requestAnimationFrame(loop);
      const dt = Math.min(now - prev, 100);
      prev = now;

      const g = gsRef.current;

      // ── Key repeat ──────────────────────────────────────────────────
      if (!g.over && !g.paused) {
        for (const data of Object.values(heldRef.current)) {
          if (!data || !REPEATABLE.has(data.action)) continue;
          if (now >= data.nextRepeat) {
            fireAction(data.action);
            data.nextRepeat = now + REPEAT_RATE;
          }
        }
      }

      // ── Gamepad input ────────────────────────────────────────────────
      const pads = typeof navigator.getGamepads === 'function'
        ? Array.from(navigator.getGamepads()).filter(Boolean)
        : [];
      const pad  = pads[0];

      if (pad) {
        const pv      = padPrev.current;
        const btnEdge = i => pad.buttons[i]?.pressed && !pv[`b${i}`];

        const dL = pad.buttons[14]?.pressed || pad.axes[0] < -0.5;
        const dR = pad.buttons[15]?.pressed || pad.axes[0] >  0.5;
        const dD = pad.buttons[13]?.pressed || pad.axes[1] >  0.5;
        const dU = pad.buttons[12]?.pressed || pad.axes[1] < -0.5;

        // Axis / d-pad with auto-repeat
        const padRepeat = (key, action) => {
          const entry = heldRef.current[key];
          if (!entry) {
            heldRef.current[key] = { action, nextRepeat: now + REPEAT_DELAY };
            fireAction(action);
          } else if (now >= entry.nextRepeat) {
            fireAction(action);
            entry.nextRepeat = now + REPEAT_RATE;
          }
        };

        if (!g.over && !g.paused) {
          if (dL) padRepeat('pad_L', 'left');   else delete heldRef.current['pad_L'];
          if (dR) padRepeat('pad_R', 'right');  else delete heldRef.current['pad_R'];
          if (dD) padRepeat('pad_D', 'down');   else delete heldRef.current['pad_D'];
          if (dU && !pv.dU)    tryRotate();
          if (btnEdge(0))      tryRotate();  // A
          if (btnEdge(1))      hardDrop();   // B
          if (btnEdge(2))      hardDrop();   // X (alternate)
          if (btnEdge(3))      tryRotate();  // Y (alternate)
        } else {
          ['pad_L', 'pad_R', 'pad_D'].forEach(k => delete heldRef.current[k]);
        }

        // Start (9) or Select (8) → pause when playing, restart when game over
        if (btnEdge(9) || btnEdge(8)) {
          if (g.over) gsRef.current = newGame();
          else        g.paused = !g.paused;
        }
        // A while game over → restart
        if (g.over && btnEdge(0)) gsRef.current = newGame();

        // Persist button state for next-frame edge detection
        const next = { dU };
        for (let i = 0; i < pad.buttons.length; i++) {
          next[`b${i}`] = pad.buttons[i].pressed;
        }
        padPrev.current = next;
      } else {
        ['pad_L', 'pad_R', 'pad_D'].forEach(k => delete heldRef.current[k]);
        padPrev.current = {};
      }

      // ── Auto-drop ────────────────────────────────────────────────────
      if (!g.over && !g.paused) {
        g.dropMs += dt;
        const interval = dropInterval(g.level);
        if (g.dropMs >= interval) {
          g.dropMs -= interval;
          if (!tryMove(0, 1)) lockPiece();
        }
      }

      render();
    }

    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup',   handleKeyUp);
    };
  }, []); // all mutable state lives in refs; no React-state deps needed

  return (
    <ScreenFrame variant="mono" buttons={[{ label: 'BACK', onClick: onBack }]}>
      <canvas
        ref={canvasRef}
        width={300}
        height={370}
        style={{ display: 'block', imageRendering: 'pixelated' }}
      />
    </ScreenFrame>
  );
}

Games.propTypes = {
  onBack: PropTypes.func,
};
