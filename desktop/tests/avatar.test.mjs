#!/usr/bin/env node
// Renders desktop/avatar.html in Chromium and drives it the way main.js does.
// Needs Playwright (local or global). Run: node tests/avatar.test.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  try { return createRequire(execSync('npm root -g', { encoding: 'utf8' }).trim() + '/')('playwright'); } catch {}
  console.error('Playwright not found'); process.exit(2);
}
const { chromium } = await loadPlaywright();

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));

let failed = 0;
const check = (cond, name) => { console.log(`  ${cond ? '✓' : '✗'} ${name}`); if (!cond) failed++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 180, height: 180 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/desktop/avatar.html?state=sleeping&fps=15`);
await page.waitForFunction(() => window.orb && window.applyCommand);

check(await page.evaluate(() => orb.getState()) === 'sleeping', 'starts asleep');
const steps = [
  [{ state: 'listening', immediate: true, fps: 60 }, 'listening'],
  [{ audio: 0.8 }, 'listening'],
  [{ state: 'processing', symbol: 'network' }, 'processing'],
  [{ state: 'memory' }, 'memory'],
  [{ state: 'processing', symbol: 'code' }, 'processing'],
  [{ state: 'talking' }, 'talking'],
  [{ state: 'idle' }, 'idle'],
  [{ state: 'sleeping', fps: 15 }, 'sleeping'],
];
for (const [cmd, want] of steps) {
  const st = await page.evaluate((c) => { applyCommand(c); return orb.getState(); }, cmd);
  check(st === want, `${JSON.stringify(cmd)} -> ${want}`);
  await page.waitForTimeout(300);
}
await page.evaluate(() => applyCommand({ state: 'processing', symbol: 'code', immediate: true }));
await page.waitForTimeout(800);
fs.mkdirSync(new URL('./output/', import.meta.url), { recursive: true });
await page.screenshot({ path: fileURLToPath(new URL('./output/processing.png', import.meta.url)), omitBackground: true });
check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`);

await browser.close();
server.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
