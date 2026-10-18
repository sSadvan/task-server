'use strict';
// Local event bridge: John (Python) -> orb window.
// Listens on 127.0.0.1 only. Accepts small JSON commands, never any spoken text.
//
//   POST /event  {"state":"memory"} | {"state":"processing","symbol":"code"} | {"audio":0.6}
//   GET  /poll   -> {"requests":["wake"]}  (requests from the orb: hotkey / click), cleared on read
//   GET  /health -> {"ok":true,"state":"idle"}

const http = require('node:http');

const STATES = ['idle', 'listening', 'processing', 'memory', 'talking', 'sleeping'];
const SYMBOLS = ['eyes', 'eyes-closed', 'code', 'soundwave', 'brain', 'network'];
const LOCAL_HOSTS = /^(127\.0\.0\.1|localhost)(:\d+)?$/;
const MAX_BODY = 1024;

// Turn an untrusted JSON payload into a clean command, or return an error string.
function parseCommand(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'expected a JSON object';
  const cmd = {};
  if ('state' in body) {
    if (!STATES.includes(body.state)) return `unknown state: ${body.state}`;
    cmd.state = body.state;
  }
  if ('symbol' in body && body.symbol != null) {
    if (!SYMBOLS.includes(body.symbol)) return `unknown symbol: ${body.symbol}`;
    cmd.symbol = body.symbol;
  }
  if ('audio' in body) {
    const level = Number(body.audio);
    if (!Number.isFinite(level)) return 'audio must be a number 0..1';
    cmd.audio = Math.min(1, Math.max(0, level));
  }
  if (body.immediate === true) cmd.immediate = true;
  if (!('state' in cmd) && !('symbol' in cmd) && !('audio' in cmd)) return 'nothing to do';
  return cmd;
}

function createBridge({ port = 47821, onCommand, getState = () => null } = {}) {
  const requests = [];

  const send = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  const server = http.createServer((req, res) => {
    // Block browser pages (they send Origin) and DNS-rebinding hosts.
    if (req.headers.origin || !LOCAL_HOSTS.test(req.headers.host || '')) return send(res, 403, { error: 'forbidden' });

    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, state: getState() });
    if (req.method === 'GET' && req.url === '/poll') return send(res, 200, { requests: requests.splice(0) });
    if (req.method !== 'POST' || req.url !== '/event') return send(res, 404, { error: 'not found' });

    let raw = '';
    let tooBig = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return;
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'invalid JSON' }); }
      const cmd = parseCommand(body);
      if (typeof cmd === 'string') return send(res, 400, { error: cmd });
      onCommand?.(cmd);
      send(res, 200, { ok: true });
    });
  });

  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve(server.address().port));
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
    // Something on the orb side (hotkey, click) wants John's attention.
    request: (name) => { if (requests.length < 16) requests.push(name); },
  };
}

module.exports = { createBridge, parseCommand, STATES, SYMBOLS };
