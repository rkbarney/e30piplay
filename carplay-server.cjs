'use strict';

/**
 * Small HTTP helper for Pi kiosk: switch between cage+Chromium and cage+react-carplay.
 * Proxied by nginx as /api/* → PORT (default 3001). Runs as the kiosk user; uses sudo -n
 * for specific systemctl commands (see /etc/sudoers.d/s52-carplay-launcher).
 */

const http = require('http');
const path = require('path');
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Kill the AppImage; the autostart relaunch loop respawns it. Wait until the
// Wayland toplevel exists again, then focus it — used when CarPlay lost the
// phone link and wlrctl focus alone is not enough.
async function restartReactCarplay() {
  try {
    await run('pkill', ['-f', 'squashfs-root/react-carplay']);
  } catch {
    /* already stopped */
  }

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (await carplayReady()) {
      await launchReactCarplay();
      return;
    }
    await sleep(1000);
  }
  throw new Error('react-carplay did not become ready within 90s');
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api')) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

    if (req.method === 'POST' && url.pathname === '/api/relaunch-react-carplay') {
      await restartReactCarplay();
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/return-to-kiosk') {
      await returnToKiosk();
      json(res, 200, { ok: true });
      return;
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
