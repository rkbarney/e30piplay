'use strict';

/**
 * Small HTTP helper for Pi kiosk: switch between cage+Chromium and cage+react-carplay.
 * Proxied by nginx as /api/* → PORT (default 3001). Runs as the kiosk user; uses sudo -n
 * for specific systemctl commands (see /etc/sudoers.d/s52-carplay-launcher).
 */

const http = require('http');
const { execFile } = require('child_process');

const PORT = Number.parseInt(process.env.PORT || '3001', 10) || 3001;

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120000 }, (err, stdout, stderr) => {
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

const WLRCTL = '/usr/bin/wlrctl';

const HOME = process.env.HOME || '/home/admin';
const AUDIO_SCRIPT = `${HOME}/.local/bin/s52-audio-output.sh`;
const BT_SCRIPT = `${HOME}/.local/bin/s52-bt.sh`;
const AUDIO_TARGETS = new Set(['aux', 'bt', 'hdmi']);

// Current output token: aux | bt | hdmi | unknown.
async function getAudioOutput() {
  const { stdout } = await run(AUDIO_SCRIPT, ['current']);
  return stdout.trim();
}

// Switch the output sink. For Bluetooth, try to (re)connect the saved Kenwood
// first so the sink exists before we route to it.
async function setAudioOutput(target) {
  if (target === 'bt') {
    try {
      await run(BT_SCRIPT, ['connect']);
    } catch {
      // fall through; s52-audio-output.sh will report if no BT sink exists
    }
  }
  await run(AUDIO_SCRIPT, [target]);
}

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

    if (req.method === 'GET' && url.pathname === '/api/audio-output') {
      const output = await getAudioOutput();
      json(res, 200, { ok: true, output });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/audio-output') {
      const target = url.searchParams.get('target');
      if (!AUDIO_TARGETS.has(target)) {
        json(res, 400, { ok: false, error: 'bad_target', detail: 'target must be aux|bt|hdmi' });
        return;
      }
      await setAudioOutput(target);
      const output = await getAudioOutput();
      json(res, 200, { ok: true, output });
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
