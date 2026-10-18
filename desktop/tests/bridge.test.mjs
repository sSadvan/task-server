#!/usr/bin/env node
// Bridge tests: real HTTP server + the Python client John uses. Run: node tests/bridge.test.mjs

import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createBridge } = require('../bridge-server.js');
const run = async (code) => (await promisify(execFile)('python3', ['-I', '-c', code], { encoding: 'utf8' })).stdout.trim();
const JOHN_DIR = fileURLToPath(new URL('../john/', import.meta.url));

let failed = 0;
const check = (cond, name) => { console.log(`  ${cond ? '✓' : '✗'} ${name}`); if (!cond) failed++; };

const got = [];
const bridge = createBridge({ port: 0, onCommand: (c) => got.push(c), getState: () => 'idle' });
const port = await bridge.listen();
const base = `http://127.0.0.1:${port}`;
const post = (body, headers = {}) =>
  fetch(`${base}/event`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

check((await (await fetch(`${base}/health`)).json()).ok === true, 'health');
check((await post('{"state":"memory"}')).status === 200, 'valid state accepted');
check((await post('{"state":"dancing"}')).status === 400, 'unknown state rejected');
check((await post('{"state":"idle","symbol":"<script>"}')).status === 400, 'unknown symbol rejected');
check((await post('not json')).status === 400, 'bad JSON rejected');
check((await post('{"state":"idle"}', { Origin: 'https://evil.example' })).status === 403, 'browser origin blocked');
check((await post('{"text":"секрет"}')).status === 400, 'payload without state/symbol/audio rejected');
got.length = 0;

// The Python client, as John would call it.
bridge.request('wake');
const py = `
import sys; sys.path.insert(0, ${JSON.stringify(JOHN_DIR)})
import john_orb as orb
orb.URL = ${JSON.stringify(base)}
print(orb.wake_requested(), orb.wake_requested())
orb.awake(); orb.audio(1.7); orb.thinking(); orb.tool("memory_write"); orb.tool("claude_code_create")
orb.talking(); orb.idle(); orb.sleeping()
orb.wait_sent()
`;
const out = await run(py);
check(out === 'True False', `wake request delivered once (${out})`);
const seq = got.map((c) => [c.state, c.symbol, c.audio].filter((v) => v != null).join(':')).join(' ');
check(seq === 'listening 1 processing:network memory processing:code talking idle sleeping', `python sequence (${seq})`);

// Client must not hang or throw when the orb app is not running.
await bridge.close();
const t0 = Date.now();
await run(py.replace(/print\(.*\)\n/, ''));
check(Date.now() - t0 < 3000, 'client survives when orb is down');

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
