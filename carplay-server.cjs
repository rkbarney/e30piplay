'use strict';

/**
 * Small HTTP helper for Pi kiosk: switch between cage+Chromium and cage+react-carplay.
 * Proxied by nginx as /api/* → PORT (default 3001). Runs as the kiosk user; uses sudo -n
 * for specific systemctl commands (see /etc/sudoers.d/s52-carplay-launcher).
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number.parseInt(process.env.PORT || '3001', 10) || 3001;
const HOST = process.env.HOST || '127.0.0.1';
const WLRCTL = '/usr/bin/wlrctl';

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

function readReceiverEnvFile() {
  const envPath = path.join(os.homedir(), '.config', 's52-carplay-receiver.env');
  try {
    const out = {};
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

/** Which receiver is booted: react-carplay (default) or LIVI (issue #23). */
const ALLOWED_APP_IDS = new Set(['react-carplay', 'dev.f-io.livi']);

function normalizeAppId(raw, fallback) {
  return ALLOWED_APP_IDS.has(raw) ? raw : fallback;
}

function normalizeReceiver(raw) {
  return raw === 'livi' ? 'livi' : 'react-carplay';
}

function getReceiverConfig() {
  const file = readReceiverEnvFile();
  const receiver = normalizeReceiver(
    process.env.S52_CARPLAY_RECEIVER || file.S52_CARPLAY_RECEIVER || 'react-carplay',
  );
  if (receiver === 'livi') {
    return {
      receiver: 'livi',
      appId: normalizeAppId(
        process.env.S52_CARPLAY_APP_ID || file.S52_CARPLAY_APP_ID,
        'dev.f-io.livi',
      ),
      processName: 'livi',
    };
  }
  return {
    receiver: 'react-carplay',
    appId: normalizeAppId(
      process.env.S52_CARPLAY_APP_ID || file.S52_CARPLAY_APP_ID,
      'react-carplay',
    ),
    processName: 'react-carplay',
  };
}

// Focus/minimize via wlrctl as the kiosk user (same session as carplayReady).
// Avoids sudo→root Wayland socket issues that break LIVI after exit/restart.
async function wlrctlToplevel(action, appId) {
  await run(WLRCTL, ['toplevel', action, `app_id:${appId}`]);
}

async function launchCarplayReceiver() {
  const { appId } = getReceiverConfig();
  try {
    await wlrctlToplevel('focus', appId);
  } catch {
    // Focus can fail when the window is already foreground; ok if it exists.
    if (!(await carplayReady())) throw new Error(`no CarPlay toplevel (${appId}) to focus`);
  }
}

async function returnToKiosk() {
  const { appId } = getReceiverConfig();
  try {
    await wlrctlToplevel('minimize', appId);
  } catch {
    /* already exited / iconified — kiosk is visible either way */
  }
}

async function receiverProcessRunning(processName) {
  try {
    await run('pgrep', ['-x', processName]);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Kill the AppImage; the autostart relaunch loop respawns it. Wait until the
// Wayland toplevel exists again, then focus it — used when CarPlay lost the
// phone link and wlrctl focus alone is not enough.
//
// Match by exact process name (-x), not a path pattern: the AppImage install
// path varies (squashfs-root mount vs an extracted -arm64-extracted dir
// depending on install method/version), so a path-based `pkill -f` can
// silently match nothing — this endpoint would then report {"ok":true}
// without ever actually restarting the app, with carplayReady() staying
// true because the same never-killed process is still registered.
async function restartCarplayReceiver() {
  const { processName } = getReceiverConfig();
  try {
    await run('pkill', ['-x', processName]);
  } catch {
    /* already stopped */
  }

  const deadline = Date.now() + 90000;

  if (await carplayReady()) {
    const goneDeadline = Date.now() + 30000;
    while (Date.now() < goneDeadline) {
      if (!(await carplayReady())) break;
      await sleep(500);
    }
    if (await carplayReady()) {
      // LIVI exit can leave a stale labwc handle while the process is gone.
      if (!(await receiverProcessRunning(processName))) {
        /* ghost toplevel — respawn will register a fresh handle */
      } else {
        throw new Error(`${processName} toplevel did not disappear after kill`);
      }
    }
  }

  while (Date.now() < deadline) {
    if (await carplayReady()) {
      await launchCarplayReceiver();
      return;
    }
    await sleep(1000);
  }
  throw new Error(`${processName} did not become ready within 90s`);
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
    await git(['fetch', '--quiet', '--prune', 'origin'], { timeout: 20000 });
    online = true;
    // Commits upstream has that we don't (0 = up to date).
    behind = Number.parseInt(await out(['rev-list', '--count', 'HEAD..@{u}']), 10) || 0;
  } catch {
    online = false;
  }

  // Selectable branches, most-recently-committed first (from the refs the fetch
  // above just refreshed — no extra network), so the UI can show "top N recent".
  let branches = [];
  try {
    const raw = await out([
      'for-each-ref', '--sort=-committerdate',
      '--format=%(refname:short)', 'refs/remotes/origin',
    ]);
    branches = raw.split('\n')
      .map(s => s.trim())
      .filter(s => s && s !== 'origin' && s !== 'origin/HEAD')
      .map(s => s.replace(/^origin\//, ''));
  } catch { /* ignore */ }
  branches = [...new Set(branches)];

  return { sha, branch, dirty, online, behind, updateAvailable: behind > 0, branches };
}

// Pull + build + deploy. Long-running (npm ci + build), so a generous timeout.
async function runUpdate(force = false) {
  const script = path.join(APP_DIR, 'scripts', 's52-update.sh');
  const args = force ? ['--force'] : [];
  const { stdout, stderr } = await run('bash', [script, ...args], {
    timeout: 600000,
    cwd: APP_DIR,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { log: `${stdout}${stderr}`.trim() };
}

// Branch names we'll accept from the UI. Anything else is rejected outright.
const BRANCH_RE = /^[A-Za-z0-9._/-]+$/;

// Selectable branches from origin (current first). `git fetch` refreshes the
// remote refs; if offline we still return the current branch.
async function getBranches() {
  const git = (args, opts) => run(GIT, ['-C', APP_DIR, ...args], opts);
  const out = async (args) => (await git(args)).stdout.trim();

  const current = await out(['rev-parse', '--abbrev-ref', 'HEAD']);
  try {
    await git(['fetch', '--quiet', '--prune', 'origin'], { timeout: 20000 });
  } catch { /* offline — fall back to whatever refs we have */ }

  let branches = [];
  try {
    const raw = await out(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']);
    branches = raw.split('\n')
      .map(s => s.trim())
      .filter(s => s && s !== 'origin' && s !== 'origin/HEAD')
      .map(s => s.replace(/^origin\//, ''));
  } catch { /* ignore */ }

  if (!branches.includes(current)) branches.unshift(current);
  return { current, branches: [...new Set(branches)] };
}

const WIFI_SCRIPT_NAME = 's52-wifi-switch.sh';
const WIFI_SCRIPT_INSTALLED = '/usr/local/bin/s52-wifi-switch.sh';

function wifiScriptPath() {
  return fs.existsSync(WIFI_SCRIPT_INSTALLED)
    ? WIFI_SCRIPT_INSTALLED
    : path.join(APP_DIR, 'scripts', WIFI_SCRIPT_NAME);
}

async function getWifiStatus() {
  const script = wifiScriptPath();
  const { stdout } = await run('bash', [script, 'status'], { timeout: 15000 });
  return JSON.parse(stdout.trim());
}

async function runWifiSwitch(profile) {
  const name = String(profile || '').trim();
  if (!name) throw new Error('invalid profile');
  const script = wifiScriptPath();
  try {
    const { stdout } = await run('bash', [script, 'switch', name], { timeout: 90000 });
    return JSON.parse(stdout.trim());
  } catch (e) {
    const denied = /permission|authorized|denied|not authorized|insufficient/i.test(
      `${e.stderr || ''}${e.message || ''}`,
    );
    if (denied && fs.existsSync(WIFI_SCRIPT_INSTALLED)) {
      const { stdout } = await run('sudo', ['-n', script, 'switch', name], { timeout: 90000 });
      return JSON.parse(stdout.trim());
    }
    throw e;
  }
}

// Switch to a remote branch, then build + deploy. The branch is validated and
// passed as an argv (execFile = no shell), so it cannot inject.
async function runSwitch(branch, force = false) {
  if (!BRANCH_RE.test(branch)) throw new Error(`invalid branch name: ${branch}`);
  const { branches } = await getBranches();
  if (!branches.includes(branch)) throw new Error(`unknown branch: ${branch}`);

  const script = path.join(APP_DIR, 'scripts', 's52-switch-branch.sh');
  const args = force ? [branch, '--force'] : [branch];
  const { stdout, stderr } = await run('bash', [script, ...args], {
    timeout: 600000,
    cwd: APP_DIR,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { log: `${stdout}${stderr}`.trim() };
}

// Read a small JSON request body (bounded; never rejects).
function readJson(req, limit = 10000) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) { req.destroy(); resolve({}); }
    });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// Used by the React splash to know when the receiver is alive as a labwc
// toplevel — i.e. when tapping `+` will be instant.
async function carplayReady() {
  const { appId } = getReceiverConfig();
  try {
    await run(WLRCTL, ['toplevel', 'find', `app_id:${appId}`]);
    return true;
  } catch {
    return false;
  }
}

// ── ROM listing ───────────────────────────────────────────────────────────────
// Maps file extension → EmulatorJS system name (EJS_core / config.system).
// NES uses the 'nes' system (fceumm core).
// Both .gb and .gbc use the 'gb' system — the gambatte core handles both
// Game Boy and Game Boy Color ROMs under the same system name.
// SNES uses the 'snes' system (snes9x core).
const EXT_TO_CORE = {
  '.nes': 'nes',
  '.gb':  'gb',
  '.gbc': 'gb',
  '.sfc': 'snes',
  '.smc': 'snes',
};

function romGameId(file) {
  let h = 0;
  for (let i = 0; i < file.length; i += 1) {
    h = (Math.imul(31, h) + file.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

// Returns [{id, name, url, core}] sorted by name, or [] if the roms/ dir is absent.
// ROM bytes are served statically by nginx at /roms/<filename>.
function listRoms() {
  const dir = path.join(APP_DIR, 'roms');
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return []; // dir not yet created — treat as empty
  }
  const roms = [];
  for (const file of entries) {
    const ext  = path.extname(file).toLowerCase();
    const core = EXT_TO_CORE[ext];
    if (!core) continue; // skip unknown extensions
    roms.push({
      id:   romGameId(file),
      name: path.basename(file, ext).replace(/[_-]+/g, ' ').trim(),
      url:  `/roms/${encodeURIComponent(file)}`,
      core,
    });
  }
  roms.sort((a, b) => a.name.localeCompare(b.name));
  return roms;
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
      const { receiver, appId } = getReceiverConfig();
      json(res, ready ? 200 : 503, { ready, receiver, appId });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/version') {
      json(res, 200, { ok: true, ...(await getVersion()) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/wifi') {
      json(res, 200, { ok: true, ...(await getWifiStatus()) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/roms') {
      json(res, 200, listRoms());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/update') {
      const body = await readJson(req);
      const { log } = await runUpdate(Boolean(body.force));
      json(res, 200, { ok: true, log });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/branches') {
      json(res, 200, { ok: true, ...(await getBranches()) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/switch-branch') {
      const body = await readJson(req);
      const { log } = await runSwitch(String(body.branch || ''), Boolean(body.force));
      json(res, 200, { ok: true, log });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/wifi/switch') {
      const body = await readJson(req);
      const wifi = await runWifiSwitch(String(body.profile || ''));
      json(res, 200, { ok: true, ...wifi });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/launch-react-carplay') {
      await launchCarplayReceiver();
      json(res, 200, { ok: true, ...getReceiverConfig() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/relaunch-react-carplay') {
      await restartCarplayReceiver();
      json(res, 200, { ok: true, ...getReceiverConfig() });
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

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`carplay-server listening on ${HOST}:${PORT}`);
});
