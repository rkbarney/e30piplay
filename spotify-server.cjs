'use strict';

/**
 * Small HTTP service: Spotify OAuth (PKCE) + Web API control for the on-dash
 * Spotify Connect device (raspotify). Proxied by nginx as two trust zones —
 * see setup.sh:
 *   /api/spotify/*   loopback-only — same-origin calls from the kiosk UI.
 *   /spotify-callback  LAN-reachable — hit directly by the phone browser
 *                       after it bounces off the richardbarney.com redirect
 *                       page (Spotify requires an HTTPS authorize redirect;
 *                       the bouncer forwards the phone here over the
 *                       hotspot/WiFi LAN to finish the token exchange).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const PORT = Number.parseInt(process.env.PORT || '3002', 10) || 3002;
const HOST = process.env.HOST || '127.0.0.1';

const CLIENT_ID = (process.env.SPOTIFY_CLIENT_ID || '').trim();
const REDIRECT_URI = (process.env.SPOTIFY_REDIRECT_URI || 'https://www.richardbarney.com/spotify-callback/').trim();
const DEVICE_NAME = process.env.SPOTIFY_DEVICE_NAME || 'S52 E30';

function logOAuth(event, detail = {}) {
  // eslint-disable-next-line no-console
  console.error('[spotify-oauth]', event, JSON.stringify({ redirect_uri: REDIRECT_URI, ...detail }));
}

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
].join(' ');

const TOKENS_PATH = path.join(os.homedir(), '.config', 's52-spotify', 'tokens.json');

// ── PKCE / token storage ────────────────────────────────────────────────────

// In-memory only: a login attempt that outlives a server restart is rare
// enough (and low-stakes enough — worst case the user re-scans the QR) that
// persisting this isn't worth it.
const pendingLogins = new Map(); // state -> { verifier, expiresAt }

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function startLogin() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));
  pendingLogins.set(state, { verifier, expiresAt: Date.now() + 10 * 60 * 1000 });
  // Sweep stale attempts so the map doesn't grow if logins are abandoned.
  for (const [s, v] of pendingLogins) if (v.expiresAt < Date.now()) pendingLogins.delete(s);

  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', SCOPES);
  return url.toString();
}

function readTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function writeTokens(tokens) {
  fs.mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens), { mode: 0o600 });
}

async function exchangeCode(code, verifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    logOAuth('token_exchange_failed', {
      http_status: res.status,
      spotify_error: data.error,
      spotify_error_description: data.error_description,
    });
    throw new Error(data.error_description || data.error || 'token exchange failed');
  }
  writeTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  });
}

async function refreshTokens(tokens) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: CLIENT_ID,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'token refresh failed');
  const next = {
    access_token: data.access_token,
    // Spotify doesn't always rotate the refresh token — keep the old one if absent.
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  writeTokens(next);
  return next;
}

class NotAuthenticated extends Error {}

async function getAccessToken() {
  let tokens = readTokens();
  if (!tokens?.refresh_token) throw new NotAuthenticated('not logged in');
  if (tokens.expires_at - Date.now() < 60000) tokens = await refreshTokens(tokens);
  return tokens.access_token;
}

// ── Spotify Web API ─────────────────────────────────────────────────────────

async function spotifyApi(method, apiPath, { query, retry = true } = {}) {
  const token = await getAccessToken();
  const url = new URL(`https://api.spotify.com/v1${apiPath}`);
  for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401 && retry) {
    // Access token went stale between our expiry check and the call — force
    // one refresh and retry exactly once.
    const tokens = readTokens();
    if (tokens) await refreshTokens(tokens);
    return spotifyApi(method, apiPath, { query, retry: false });
  }
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Spotify API ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Resolve the dash unit's Connect device id by name, so transport calls can
// target it explicitly even when nothing is "active" yet (first play of a
// session needs an explicit device_id to transfer playback onto raspotify).
async function findDeviceId() {
  const data = await spotifyApi('GET', '/me/player/devices');
  const device = (data?.devices || []).find(d => d.name === DEVICE_NAME);
  return device?.id || null;
}

async function getNowPlaying() {
  const data = await spotifyApi('GET', '/me/player');
  if (!data) return { playing: false };
  const item = data.item;
  return {
    playing: Boolean(data.is_playing),
    track: item?.name || null,
    artists: (item?.artists || []).map(a => a.name).join(', ') || null,
    album: item?.album?.name || null,
    artUrl: item?.album?.images?.[0]?.url || null,
    progressMs: data.progress_ms ?? null,
    durationMs: item?.duration_ms ?? null,
    deviceName: data.device?.name || null,
    deviceIsOurs: data.device?.name === DEVICE_NAME,
  };
}

async function transport(action) {
  const deviceId = await findDeviceId();
  const query = deviceId ? { device_id: deviceId } : {};
  // A bare PUT play resumes whatever was playing; passing device_id also
  // transfers playback onto the dash unit if nothing was active there yet.
  if (action === 'play') return spotifyApi('PUT', '/me/player/play', { query });
  if (action === 'pause') return spotifyApi('PUT', '/me/player/pause', { query });
  if (action === 'next') return spotifyApi('POST', '/me/player/next', { query });
  if (action === 'previous') return spotifyApi('POST', '/me/player/previous', { query });
  throw new Error(`unknown transport action: ${action}`);
}

// Single endpoint for "HAL, play/pause" and the on-screen big button — callers
// don't need to track current playback state themselves to know which way to flip it.
async function togglePlayback() {
  const np = await getNowPlaying();
  return transport(np.playing ? 'pause' : 'play');
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function html(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

const CALLBACK_OK_PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>S52 Spotify</title><style>body{background:#0d0d0d;color:#ffb300;font-family:'Courier New',monospace;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px}</style>
</head><body><div>Logged in.<br>You can close this tab.</div></body></html>`;

function callbackErrorPage(message) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>S52 Spotify</title><style>body{background:#0d0d0d;color:#ff6644;font-family:'Courier New',monospace;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px}</style>
</head><body><div>Login failed: ${String(message).replace(/[<>&]/g, '')}</div></body></html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api')) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/spotify/health') {
      json(res, 200, {
        ok: true,
        service: 's52-spotify',
        pid: process.pid,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/spotify/status') {
      const tokens = readTokens();
      json(res, 200, {
        ok: true,
        authenticated: Boolean(tokens?.refresh_token),
        deviceName: DEVICE_NAME,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/spotify/login-url') {
      if (!CLIENT_ID) {
        json(res, 500, { ok: false, error: 'SPOTIFY_CLIENT_ID not configured' });
        return;
      }
      json(res, 200, {
        ok: true,
        url: startLogin(),
        redirectUri: REDIRECT_URI,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/spotify/logout') {
      fs.rmSync(TOKENS_PATH, { force: true });
      json(res, 200, { ok: true });
      return;
    }

    // LAN-reachable (see nginx config) — hit directly by the phone's browser.
    if (req.method === 'GET' && (url.pathname === '/spotify-callback' || url.pathname === '/spotify-callback/')) {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      if (error) {
        const errorDescription = url.searchParams.get('error_description');
        logOAuth('authorize_callback_error', {
          error,
          error_description: errorDescription,
        });
        html(res, 400, callbackErrorPage(errorDescription || error));
        return;
      }
      const pending = state && pendingLogins.get(state);
      if (!pending || pending.expiresAt < Date.now()) {
        html(res, 400, callbackErrorPage('login expired or invalid — rescan the QR code'));
        return;
      }
      pendingLogins.delete(state);
      try {
        await exchangeCode(code, pending.verifier);
        html(res, 200, CALLBACK_OK_PAGE);
      } catch (e) {
        logOAuth('callback_token_exchange_error', { message: e.message });
        html(res, 500, callbackErrorPage(e.message));
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/spotify/now-playing') {
      try {
        json(res, 200, { ok: true, ...(await getNowPlaying()) });
      } catch (e) {
        if (e instanceof NotAuthenticated) json(res, 200, { ok: true, authenticated: false });
        else throw e;
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/spotify/toggle') {
      await togglePlayback();
      json(res, 200, { ok: true });
      return;
    }

    const transportMatch = url.pathname.match(/^\/api\/spotify\/(play|pause|next|previous)$/);
    if (req.method === 'POST' && transportMatch) {
      await transport(transportMatch[1]);
      json(res, 200, { ok: true });
      return;
    }

    json(res, 404, { ok: false, error: 'not_found' });
  } catch (e) {
    if (e instanceof NotAuthenticated) {
      json(res, 401, { ok: false, error: 'not_authenticated' });
      return;
    }
    json(res, e.status || 500, { ok: false, error: 'request_failed', detail: e.message });
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  const clientHint = CLIENT_ID ? `${CLIENT_ID.slice(0, 8)}…` : '(unset)';
  console.log(
    `spotify-server listening on ${HOST}:${PORT} (client=${clientHint}, redirect=${REDIRECT_URI})`,
  );
});
