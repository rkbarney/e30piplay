'use strict';

/**
 * Small HTTP helper for Pi kiosk: switch between cage+Chromium and cage+react-carplay.
 * Proxied by nginx as /api/* → PORT (default 3001). Runs as the kiosk user; uses sudo -n
 * for specific systemctl commands (see /etc/sudoers.d/s52-carplay-launcher).
 */

const http = require('http');
const path = require('path');
const fs   = require('fs');
const { execFile } = require('child_process');

const PORT = Number.parseInt(process.env.PORT || '3001', 10) || 3001;

// The systemd unit runs with WorkingDirectory=$APP_DIR, so cwd is the repo.
const APP_DIR = process.env.APP_DIR || process.cwd();

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120000, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        err.stdout = stdout;
        reject(err);
      } else resolve({ stdout, stderr });
    });
  });
}

async function launchReactCarplay() {
  await run('sudo', ['-n', '/usr/local/bin/s52-carplay-switch.sh', 'launch']);
}

async function returnToKiosk() {
  await run('sudo', ['-n', '/usr/local/bin/s52-carplay-switch.sh', 'return']);
}

const GIT = 'git';

// Current build info + whether the remote is ahead. `git fetch` needs network;
// if it fails we report online:false rather than erroring the whole request.
async function getVersion() {
  const git = (args, opts) => run(GIT, ['-C', APP_DIR, ...args], opts);
  const out = async (args) => (await git(args)).stdout.trim();

  const sha = await out(['rev-parse', '--short', 'HEAD']);
  const branch = await out(['rev-parse', '--abbrev-ref', 'HEAD']);
  let dirty = false;
  try {
    dirty = (await git(['status', '--porcelain'])).stdout.trim().length > 0;
  } catch { /* ignore */ }

  let online = false;
  let behind = 0;
  try {
    await git(['fetch', '--quiet', 'origin'], { timeout: 20000 });
    online = true;
    // Commits upstream has that we don't (0 = up to date).
    behind = Number.parseInt(await out(['rev-list', '--count', 'HEAD..@{u}']), 10) || 0;
  } catch {
    online = false;
  }

  return { sha, branch, dirty, online, behind, updateAvailable: behind > 0 };
}

// Pull + build + deploy. Long-running (npm ci + build), so a generous timeout.
async function runUpdate() {
  const script = path.join(APP_DIR, 'scripts', 's52-update.sh');
  const { stdout, stderr } = await run('bash', [script], {
    timeout: 600000,
    cwd: APP_DIR,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { log: `${stdout}${stderr}`.trim() };
}

const WLRCTL = '/usr/bin/wlrctl';

// Used by the React splash to know when the AppImage is alive as a labwc
// toplevel — i.e. when tapping `+` will be instant. Resolves true iff
// `wlrctl toplevel find app_id:react-carplay` returns 0.
async function carplayReady() {
  try {
    await run(WLRCTL, ['toplevel', 'find', 'app_id:react-carplay']);
    return true;
  } catch {
    return false;
  }
}

// ── GPS ────────────────────────────────────────────────────────────────────────

// Parse a stream of newline-delimited gpsd JSON objects and return the most
// recent TPV record with a real fix (mode ≥ 2).
function parseTpv(raw) {
  let best = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { continue; }
    if (obj.class === 'TPV' && typeof obj.mode === 'number' && obj.mode >= 2) {
      best = obj;
    }
  }
  return best;
}

// Poll gpspipe for up to GPS_LINES JSON lines (covers ~1 s of 10 Hz data).
// Returns a sanitised fix object or { mode: 0 } when gpsd is unreachable.
const GPS_LINES = 20;
const GPS_TIMEOUT_MS = 2500;

async function getGpsFix() {
  let stdout = '';
  try {
    ({ stdout } = await run(
      'gpspipe',
      ['-w', `-n${GPS_LINES}`],
      { timeout: GPS_TIMEOUT_MS },
    ));
  } catch {
    return { ok: true, mode: 0 };
  }
  const tpv = parseTpv(stdout);
  if (!tpv) return { ok: true, mode: 0 };
  return {
    ok:    true,
    mode:  tpv.mode,
    time:  tpv.time  ?? null,
    lat:   typeof tpv.lat   === 'number' ? tpv.lat   : null,
    lon:   typeof tpv.lon   === 'number' ? tpv.lon   : null,
    alt:   typeof tpv.alt   === 'number' ? tpv.alt   : null,    // metres
    speed: typeof tpv.speed === 'number' ? tpv.speed : null,    // m/s
    track: typeof tpv.track === 'number' ? tpv.track : null,    // degrees true
    climb: typeof tpv.climb === 'number' ? tpv.climb : null,    // m/s vertical
    epx:   typeof tpv.epx   === 'number' ? tpv.epx   : null,    // horizontal error estimate (m)
  };
}

// ── Drive log ─────────────────────────────────────────────────────────────────

const DRIVE_LOG_DIR = path.join(APP_DIR, 'drive-logs');

function driveLogPath() {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return path.join(DRIVE_LOG_DIR, `drive-${stamp}.jsonl`);
}

function ensureDriveLogDir() {
  try { fs.mkdirSync(DRIVE_LOG_DIR, { recursive: true }); } catch { /* ignore */ }
}

function appendDrivePoint(point) {
  ensureDriveLogDir();
  // Prefer the GPS timestamp; fall back to server wall-clock.
  const ts = (point.time && typeof point.time === 'string') ? point.time : new Date().toISOString();
  const line = JSON.stringify({ ...point, _logged: ts }) + '\n';
  fs.appendFileSync(driveLogPath(), line, 'utf8');
}

function readDriveLog() {
  const fp = driveLogPath();
  if (!fs.existsSync(fp)) return [];
  return fs.readFileSync(fp, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function clearDriveLog() {
  const fp = driveLogPath();
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api')) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/api/health')) {
      json(res, 200, { ok: true, service: 's52-carplay', pid: process.pid });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/carplay-ready') {
      const ready = await carplayReady();
      json(res, ready ? 200 : 503, { ready });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/version') {
      json(res, 200, { ok: true, ...(await getVersion()) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/update') {
      const { log } = await runUpdate();
      json(res, 200, { ok: true, log });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/launch-react-carplay') {
      await launchReactCarplay();
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/return-to-kiosk') {
      await returnToKiosk();
      json(res, 200, { ok: true });
      return;
    }

    // ── GPS fix ───────────────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/api/gps') {
      const fix = await getGpsFix();
      json(res, 200, fix);
      return;
    }

    // ── Drive log ─────────────────────────────────────────────────────────────
    if (url.pathname === '/api/drive-log') {
      if (req.method === 'GET') {
        json(res, 200, { ok: true, points: readDriveLog() });
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        let point;
        try { point = JSON.parse(body); } catch {
          json(res, 400, { ok: false, error: 'invalid_json' });
          return;
        }
        appendDrivePoint(point);
        json(res, 200, { ok: true });
        return;
      }
      if (req.method === 'DELETE') {
        clearDriveLog();
        json(res, 200, { ok: true });
        return;
      }
    }

    json(res, 404, { ok: false, error: 'not_found' });
  } catch (e) {
    const detail = (e.stderr && String(e.stderr).trim()) || e.message || String(e);
    json(res, 500, { ok: false, error: 'command_failed', detail });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`carplay-server listening on 127.0.0.1:${PORT}`);
});
