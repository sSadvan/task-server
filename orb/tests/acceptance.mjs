#!/usr/bin/env node
// Browser acceptance tests for the orb (README → "Acceptance tests").
// Needs Playwright with Chromium:  npm i -D playwright && npx playwright install chromium
// (a globally installed playwright is picked up automatically).  Run: node tests/acceptance.mjs

import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(root + '/')('playwright');
  } catch {}
  console.error('Playwright not found. Install it: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const { chromium } = await loadPlaywright();
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = new URL('./output/', import.meta.url);
const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}/`;

const results = [];
async function test(name, fn) {
  try {
    const note = await fn();
    results.push({ name, ok: true, note });
    console.log(`  ✓ ${name}${note ? `  (${note})` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, note: err.message });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// --- start the documented local server -----------------------------------------------
const server = spawn(process.execPath, ['tools/serve.mjs', String(PORT)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => {
  server.stdout.on('data', d => String(d).includes('http://') && res());
  server.on('exit', code => rej(new Error(`server exited (${code})`)));
  setTimeout(() => rej(new Error('server did not start')), 5000);
});
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const external = [];
const pageErrors = [];
async function open(path, viewport = { width: 900, height: 700 }) {
  const page = await browser.newPage({ viewport });
  page.on('request', r => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  page.on('pageerror', e => pageErrors.push(`${path}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(`${path}: ${m.text()}`); });
  await page.goto(BASE + path);
  await page.waitForFunction(() => window.orb);
  return page;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// Helpers evaluated in the page
const angleOf = (page, ribbon) => page.evaluate(r => {
  const t = orb.svg.querySelector(`[data-ribbon="${r}"]`).getAttribute('transform') || '';
  return Number((/rotate\(([-\d.e]+)/.exec(t) || [])[1] || 0);
}, ribbon);
const cssVar = (page, name) => page.evaluate(n => orb.svg.style.getPropertyValue(n).trim(), name);
const unwrap = (a, b) => { let d = b - a; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

console.log('Orb acceptance tests\n');
const page = await open('avatar.html');
const durations = await page.evaluate(() => ({
  color: orb.getParameter('colorDuration'), motion: orb.getParameter('motionDuration'), symbol: orb.getParameter('symbolDuration'),
}));
const SLEEP_PACE = await page.evaluate(() => orb.getConfig().presets.sleeping.motion.transitionPace);
const settle = Math.max(durations.color, durations.motion, durations.symbol) * SLEEP_PACE + 400;
const presets = await page.evaluate(() => Object.fromEntries(orb.listStates().map(s => [s, orb.getConfig().presets[s]])));

await test('1. Renders with a transparent background', async () => {
  const p = await open('avatar.html', { width: 512, height: 512 });
  await wait(500);
  const png = await p.screenshot({ omitBackground: true, path: fileURLToPath(new URL('transparent-512.png', OUT)) });
  const px = await p.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const a = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
    return { corner: a(2, 2), center: a(img.width / 2, img.height / 2) };
  }, png.toString('base64'));
  await p.close();
  assert(px.corner === 0, `corner alpha ${px.corner} (expected 0)`);
  assert(px.center > 200, `centre alpha ${px.center} (expected opaque)`);
  return `corner α=${px.corner}, centre α=${px.center}`;
});

await test('2. All states (incl. sleeping) activate through the API', async () => {
  for (const s of ['idle', 'listening', 'processing', 'memory', 'sleeping', 'talking']) {
    assert(await page.evaluate(s => orb.setState(s), s) === true, `setState(${s}) returned false`);
    assert(await page.evaluate(() => orb.getState()) === s, `getState() !== ${s}`);
    await wait(settle);
    const primary = await cssVar(page, '--orb-primary');
    assert(primary === presets[s].colors.primary, `${s}: --orb-primary ${primary} != ${presets[s].colors.primary}`);
    assert(await page.evaluate(() => orb.svg.dataset.state) === s, 'data-state not updated');
  }
  assert(await page.evaluate(() => orb.setState('nope')) === false, 'invalid state should return false');
  return 'invalid state rejected';
});

await test('3. Colour changes are smooth and leave geometry untouched', async () => {
  await page.evaluate(() => orb.setState('idle', { immediate: true }));
  const geo = () => page.evaluate(() => [...orb.svg.querySelectorAll('.orb-ribbon__body')].map(p => p.getAttribute('d')).join('|'));
  const before = await geo();
  const samples = await page.evaluate(async dur => {
    orb.setState('listening');
    const out = [];
    const t0 = performance.now();
    while (performance.now() - t0 < dur + 150) {
      await new Promise(r => requestAnimationFrame(r));
      out.push(orb.svg.style.getPropertyValue('--orb-primary').trim());
    }
    return out;
  }, durations.color);
  const distinct = new Set(samples).size;
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  let maxStep = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = rgb(samples[i - 1]), b = rgb(samples[i]);
    maxStep = Math.max(maxStep, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  }
  assert(samples.every(s => /^#[0-9a-f]{6}$/.test(s)), 'non-hex colour emitted');
  assert(distinct > 10, `only ${distinct} intermediate colours`);
  assert(maxStep < 40, `largest per-frame colour jump ${maxStep.toFixed(1)}`);
  assert(before === await geo(), 'ribbon geometry changed');
  return `${distinct} steps, max jump ${maxStep.toFixed(1)}/441`;
});

await test('4. Ribbon layers move independently', async () => {
  await page.evaluate(() => orb.setState('idle', { immediate: true }));
  const names = ['back-1', 'inner-1', 'main-1', 'main-2', 'front-1'];
  const a0 = await Promise.all(names.map(n => angleOf(page, n)));
  await wait(1500);
  const a1 = await Promise.all(names.map(n => angleOf(page, n)));
  const d = names.map((n, i) => unwrap(a0[i], a1[i]));
  assert(d.some(x => x > 0) && d.some(x => x < 0), `no opposite directions: ${d.map(x => x.toFixed(2))}`);
  assert(new Set(d.map(x => x.toFixed(1))).size >= 4, `rates too similar: ${d.map(x => x.toFixed(2))}`);
  return names.map((n, i) => `${n} ${d[i] >= 0 ? '+' : ''}${d[i].toFixed(1)}°`).join(', ');
});

// Rotation rate (°/s) of one ribbon, measured inside the page from its rendered transform.
const rate = async (ribbon = 'main-1', ms = 1200) => {
  await page.bringToFront();
  return page.evaluate(async ([r, ms]) => {
    const read = () => Number((/rotate\(([-\d.e]+)/.exec(orb.svg.querySelector(`[data-ribbon="${r}"]`).getAttribute('transform')) || [])[1] || 0);
    // Read right after a rendered frame and use that frame's timestamp, so a stale
    // (throttled) frame never stretches or shrinks the measured interval.
    const frame = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(t => res(t))));
    const t0 = await frame(), a0 = read();
    await new Promise(res => setTimeout(res, ms));
    const t1 = await frame();
    let d = read() - a0;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d / ((t1 - t0) / 1000);
  }, [ribbon, ms]);
};

await test('5. Animation speed changes at runtime', async () => {
  await page.evaluate(() => { orb.setState('idle', { immediate: true }); orb.setParameters({ ribbonAmplitude: 0 }, { immediate: true }); });
  // Alternate ×1 / ×3 twice and average, so a momentary rendering stall can't skew one sample.
  let r1 = 0, r3 = 0;
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => orb.setParameter('animationSpeed', 1, { immediate: true }));
    r1 += (await rate()) / 2;
    await page.evaluate(() => orb.setParameter('animationSpeed', 3, { immediate: true }));
    r3 += (await rate()) / 2;
  }
  await page.evaluate(() => orb.resetParameters({ immediate: true }));
  const ratio = r3 / r1;
  assert(ratio > 2.5 && ratio < 3.5, `speed ratio ${ratio.toFixed(2)} (expected ≈3; ×1 ${r1.toFixed(2)}°/s, ×3 ${r3.toFixed(2)}°/s)`);
  return `×1 → ${r1.toFixed(1)}°/s, ×3 → ${r3.toFixed(1)}°/s`;
});

await test('6. Glow and pulse intensity adjust at runtime', async () => {
  await page.evaluate(() => { orb.resetParameters({ immediate: true }); orb.setState('idle', { immediate: true }); });
  const halo = () => page.evaluate(() => Number(orb.svg.querySelector('.orb-glow-halo').style.opacity));
  await page.evaluate(() => orb.setParameters({ glowIntensity: 0.2, breathingIntensity: 0, pulseIntensity: 0 }, { immediate: true }));
  await wait(100);
  const low = await halo();
  await page.evaluate(() => orb.setParameter('glowIntensity', 0.9, { immediate: true }));
  await wait(100);
  const high = await halo();
  assert(high > low * 3, `halo opacity ${low} -> ${high}`);
  const spread = async () => page.evaluate(async () => {
    const v = [];
    for (let i = 0; i < 90; i++) { await new Promise(r => requestAnimationFrame(r)); v.push(Number(orb.svg.querySelector('.orb-core-inner-light').style.opacity)); }
    return Math.max(...v) - Math.min(...v);
  });
  const flat = await spread();
  await page.evaluate(() => orb.setParameters({ pulseIntensity: 1, pulseFrequency: 2 }, { immediate: true }));
  const pulsing = await spread();
  await page.evaluate(() => orb.resetParameters({ immediate: true }));
  assert(flat < 0.01 && pulsing > 0.1, `inner light swing ${flat.toFixed(3)} -> ${pulsing.toFixed(3)}`);
  return `halo ${low}→${high}, pulse swing ${flat.toFixed(3)}→${pulsing.toFixed(3)}`;
});

await test('7. Central symbol changes without replacing the orb', async () => {
  await page.evaluate(() => { orb.setState('idle', { immediate: true }); orb.svg.__marker = 42; });
  const vis = () => page.evaluate(() => Object.fromEntries([...orb.symbolEls].map(([n, g]) =>
    [n, g.style.display === 'none' ? 0 : Number(g.style.opacity)])));
  for (const s of ['code', 'soundwave', 'brain', 'network', 'eyes']) {
    assert(await page.evaluate(s => orb.setSymbol(s), s), `setSymbol(${s}) false`);
    // During the swap at most one symbol is ever visible.
    for (let i = 0; i < 6; i++) {
      await wait(durations.symbol / 6);
      const shown = Object.values(await vis()).filter(o => o > 0.001).length;
      assert(shown <= 1, `${shown} symbols visible at once`);
    }
    await wait(250);
    const v = await vis();
    assert(v[s] > 0.95, `${s} opacity ${v[s]}`);
  }
  assert(await page.evaluate(() => orb.svg.__marker === 42 && document.querySelectorAll('svg.orb').length === 1), 'SVG was replaced');
  assert(await page.evaluate(() => orb.setSymbol('unicorn')) === false, 'unknown symbol accepted');
  return 'code, soundwave, brain, network, eyes; never two at once';
});

await test('8. Custom symbols register via the documented API (sanitised)', async () => {
  const r = await page.evaluate(() => {
    window.__pwned = false;
    const ok = orb.registerSymbol('bolt',
      `<svg viewBox="0 0 100 100" onload="window.__pwned=true"><script>window.__pwned=true</script>
       <path d="M55 5L20 55H48L40 95L80 40H52Z" onclick="window.__pwned=true" style="fill:red" class="orb-line evil"/>
       <a href="javascript:window.__pwned=true"><circle cx="5" cy="5" r="5"/></a>
       <image href="http://evil.example/x.png"/><foreignObject><div>x</div></foreignObject>
       <rect x="0" y="0" width="5" height="5" fill="url(http://evil.example/#g)"/></svg>`, { label: 'Bolt' });
    orb.setSymbol('bolt');
    const g = orb.symbolEls.get('bolt');
    const html = g.querySelector('.orb-symbol__art').innerHTML;   // the sanitised user content
    return {
      ok, listed: orb.listSymbols().some(s => s.name === 'bolt'),
      bad: /script|onload|onclick|href|style=|foreignObject|<image|<a[\s>]|evil/i.test(html),
      path: !!g.querySelector('path'), cls: g.querySelector('path').getAttribute('class'),
      broken: orb.registerSymbol('bad', '<path d="M0 0"'), empty: orb.registerSymbol('bad2', '<script>alert(1)</script>'),
      builtin: orb.registerSymbol('eyes', '<circle r="5"/>'),
    };
  });
  await wait(durations.symbol + 300);
  const pwned = await page.evaluate(() => window.__pwned);
  const visible = await page.evaluate(() => Number(orb.symbolEls.get('bolt').style.opacity));
  assert(r.ok && r.listed && r.path, 'symbol not registered');
  assert(!r.bad && !pwned, 'unsafe content survived sanitising');
  assert(r.cls === 'orb-line', `class filter kept "${r.cls}"`);
  assert(!r.broken && !r.empty && !r.builtin, 'invalid/builtin registration accepted');
  assert(visible > 0.95, `custom symbol opacity ${visible}`);
  await page.evaluate(() => orb.setSymbol('eyes', { immediate: true }));
  return 'scripts, handlers, links, styles, external refs stripped';
});

await test('9. Transitions work in every direction (and redirect mid-way)', async () => {
  const states = ['idle', 'listening', 'processing', 'memory', 'sleeping', 'talking'];
  await page.evaluate(() => orb.resetParameters({ immediate: true }));
  const fast = { colorDuration: 250, motionDuration: 250, glowDuration: 250, generalDuration: 250, symbolDuration: 200 };
  await page.evaluate(f => orb.setParameters(f), fast);
  let pairs = 0;
  for (const a of states) for (const b of states) {
    if (a === b) continue;
    await page.evaluate(a => orb.setState(a, { immediate: true }), a);
    await page.evaluate(b => orb.setState(b), b);
    await wait(250 * SLEEP_PACE + 300);
    const got = await page.evaluate(() => ({ p: orb.svg.style.getPropertyValue('--orb-primary').trim(), sym: [...orb.symbolEls].find(([, g]) => g.style.display !== 'none')?.[0] }));
    assert(got.p === presets[b].colors.primary, `${a}→${b}: primary ${got.p}`);
    assert(got.sym === presets[b].interface.symbol, `${a}→${b}: symbol ${got.sym}`);
    pairs++;
  }
  await page.evaluate(() => orb.resetParameters({ immediate: true }));
  // Redirect: idle → processing, then memory half-way. The colour must not jump.
  const jump = await page.evaluate(async () => {
    orb.setState('idle', { immediate: true });
    orb.setState('processing');
    await new Promise(r => setTimeout(r, orb.getParameter('colorDuration') / 2));
    const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const before = rgb(orb.svg.style.getPropertyValue('--orb-primary').trim());
    orb.setState('memory');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const after = rgb(orb.svg.style.getPropertyValue('--orb-primary').trim());
    return Math.hypot(...before.map((c, i) => c - after[i]));
  });
  assert(jump < 30, `colour jumped ${jump.toFixed(1)} on redirect`);
  await wait(settle);
  assert(await cssVar(page, '--orb-primary') === presets.memory.colors.primary, 'redirect did not reach memory');
  return `${pairs} state pairs; redirect jump ${jump.toFixed(1)}`;
});

await test('10. Control panel updates the orb immediately', async () => {
  const p = await open('index.html', { width: 1280, height: 900 });
  await p.click('button.cp-state[data-state="processing"]');
  assert(await p.evaluate(() => orb.getState()) === 'processing', 'state button');
  await p.locator('#cp-glowIntensity').fill('0.2');
  assert(await p.evaluate(() => orb.getParameter('glowIntensity')) === 0.2, 'glow slider');
  await p.locator('#cp-animationSpeed').fill('2.5');
  assert(await p.evaluate(() => orb.getParameter('animationSpeed')) === 2.5, 'speed slider');
  await p.locator('#cp-primary').evaluate((el) => { el.value = '#123456'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert(await p.evaluate(() => orb.getParameter('primary')) === '#123456', 'colour picker');
  await p.click('summary:has-text("Layers")');
  await p.click('summary:has-text("Transitions")');
  await p.locator('#cp-layerBack').uncheck();
  assert(await p.evaluate(() => orb.getParameter('layerBack')) === false, 'layer toggle');
  await p.locator('#cp-colorDuration').fill('300');
  assert(await p.evaluate(() => orb.getParameter('colorDuration')) === 300, 'transition duration');
  await p.selectOption('.cp-block select >> nth=2', 'network');
  assert(await p.evaluate(() => orb.getParameter('symbol')) === 'network', 'symbol select');
  await p.click('text=Pause');
  assert(await p.evaluate(() => orb.isPaused()), 'pause');
  await p.click('text=Resume');
  await p.selectOption('.cp-block select >> nth=0', 'checker');
  await wait(600);
  await p.screenshot({ path: fileURLToPath(new URL('studio-checker.png', OUT)) });
  await p.click('text=Reset all');
  assert(await p.evaluate(() => orb.getParameter('glowIntensity')) === 0.75, 'reset (processing default glow)');
  // External API calls are reflected in the panel.
  await p.evaluate(() => orb.setParameter('glowIntensity', 0.33));
  assert(await p.locator('#cp-glowIntensity').inputValue() === '0.33', 'panel did not reflect API change');
  await p.close();
  return 'state, sliders, colour, layer, duration, symbol, pause, reset';
});

await test('11. Configuration export / import round-trips', async () => {
  const r = await page.evaluate(() => {
    orb.resetParameters({ immediate: true });
    orb.setState('memory', { immediate: true });
    orb.setParameters({ glowIntensity: 0.31, pulseFrequency: 2.2, primary: '#00aeef' });
    orb.setParameter('colorDuration', 1234);
    const json = orb.exportConfig();
    orb.resetParameters({ immediate: true });
    orb.setState('idle', { immediate: true });
    const res = orb.loadConfig(json, { immediate: true });
    const simple = orb.loadConfig({ state: 'listening', colors: { primary: '#00BFFF' }, motion: { pulseIntensity: 0.2 }, bogus: 1 }, { immediate: true });
    return {
      state: orb.getState(), rejected: res.rejected,
      mem: orb.getConfig().presets.memory, dur: orb.getParameter('colorDuration'),
      simple: { primary: orb.getParameter('primary'), pulse: orb.getParameter('pulseIntensity'), rejected: simple.rejected },
      bad: orb.loadConfig('{not json').applied.length,
    };
  });
  assert(r.rejected.length === 0, `rejected on import: ${r.rejected}`);
  assert(r.mem.lighting.glowIntensity === 0.31 && r.mem.motion.pulseFrequency === 2.2 && r.mem.colors.primary === '#00aeef', 'memory preset not restored');
  assert(r.dur === 1234, 'global not restored');
  assert(r.state === 'listening' && r.simple.primary === '#00bfff' && r.simple.pulse === 0.2, 'single-state config shape');
  assert(r.simple.rejected.includes('listening.bogus') && r.bad === 0, 'unknown keys / bad JSON');
  await page.evaluate(() => orb.resetParameters({ immediate: true }));
  return 'full + single-state shapes; unknown keys ignored';
});

await test('12. Usable at 128 × 128 and 512 × 512', async () => {
  const notes = [];
  for (const size of [128, 512]) {
    const p = await open('avatar.html?state=idle', { width: size, height: size });
    await wait(700);
    const png = await p.screenshot({ omitBackground: true, path: fileURLToPath(new URL(`avatar-${size}.png`, OUT)) });
    const m = await p.evaluate(async ([b64, size]) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      // Eyes sit at (±27, -4) in a 512-unit viewBox: sample left eye centre vs the core between the eyes.
      const at = (ux, uy) => { const d = ctx.getImageData(Math.round((ux + 256) / 512 * size), Math.round((uy + 256) / 512 * size), 1, 1).data; return (d[0] + d[1] + d[2]) / 3; };
      return { eye: at(-27, -4), core: at(0, 40), fps: orb.stats.fps };
    }, [png.toString('base64'), size]);
    await p.close();
    assert(m.eye - m.core > 100, `${size}px: eye/core contrast ${m.eye.toFixed(0)} vs ${m.core.toFixed(0)}`);
    notes.push(`${size}px eye ${m.eye.toFixed(0)} / core ${m.core.toFixed(0)}`);
  }
  return notes.join('; ');
});

await test('Sleeping: slow drift, dim glow, slow breath, closed eyes, gentle in/out', async () => {
  await page.evaluate(() => { orb.resetParameters({ immediate: true }); orb.setState('idle', { immediate: true }); });
  const geo = () => page.evaluate(() => [...orb.svg.querySelectorAll('.orb-ribbon__body')].map(p => p.getAttribute('d')).join('|'));
  const geoBefore = await geo();
  await wait(300);
  const idleRate = Math.abs(await rate('main-1', 1000));
  const idleHalo = await page.evaluate(() => Number(orb.svg.querySelector('.orb-glow-halo').style.opacity));

  // Enter sleep: sample glow + colour every frame; nothing may jump.
  const enter = await page.evaluate(async () => {
    orb.setState('sleeping');
    const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    let maxHaloStep = 0, maxColStep = 0, prevH = null, prevC = null, frames = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 3000) {
      await new Promise(r => requestAnimationFrame(r));
      const h = Number(orb.svg.querySelector('.orb-glow-halo').style.opacity);
      const c = rgb(orb.svg.style.getPropertyValue('--orb-primary').trim());
      if (prevH !== null) maxHaloStep = Math.max(maxHaloStep, Math.abs(h - prevH));
      if (prevC) maxColStep = Math.max(maxColStep, Math.hypot(...c.map((x, i) => x - prevC[i])));
      prevH = h; prevC = c; frames++;
    }
    return { maxHaloStep, maxColStep, frames };
  });
  const sleepRate = Math.abs(await rate('main-1', 1500));
  const sleepHalo = await page.evaluate(() => Number(orb.svg.querySelector('.orb-glow-halo').style.opacity));
  const breath = await page.evaluate(async () => {
    const s = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 3600) {
      await new Promise(r => setTimeout(r, 50));
      s.push(Number(/scale\(([\d.]+)/.exec(orb.svg.querySelector('.orb-root').getAttribute('transform'))[1]));
    }
    return { min: Math.min(...s), max: Math.max(...s) };
  });
  const eyes = await page.evaluate(() => {
    const vis = n => { const g = orb.symbolEls.get(n); return g.style.display === 'none' ? 0 : Number(g.style.opacity); };
    return { open: vis('eyes'), closed: vis('eyes-closed'), indicator: getComputedStyle(orb.svg.querySelector('.orb-sleep-indicator')).display };
  });
  const p2p = (breath.max - breath.min) * 100;
  assert(sleepRate < idleRate * 0.45, `ribbons ${idleRate.toFixed(1)} → ${sleepRate.toFixed(1)} °/s (not much slower)`);
  assert(sleepHalo < idleHalo * 0.5 && sleepHalo > 0.05, `halo ${idleHalo} → ${sleepHalo}`);
  assert(enter.maxHaloStep < 0.03 && enter.maxColStep < 20, `jumps: halo ${enter.maxHaloStep.toFixed(3)}, colour ${enter.maxColStep.toFixed(1)}`);
  assert(p2p >= 1 && p2p <= 3, `breathing swing ${p2p.toFixed(2)} % (expected ±0.5–1.5 %)`);
  assert(eyes.open === 0 && eyes.closed > 0.5 && eyes.closed < 0.7, `eyes open ${eyes.open} closed ${eyes.closed}`);
  assert(eyes.indicator === 'none', 'sleep indicator should be off by default');

  // Configurable: indicator on, glow tweak, both through the normal parameter API.
  await page.evaluate(() => orb.setParameters({ sleepIndicatorVisible: true, glowIntensity: 0.1 }));
  await wait(2500);
  const ind = await page.evaluate(() => ({
    display: orb.svg.querySelector('.orb-sleep-indicator').style.display,
    z: [...orb.svg.querySelectorAll('.orb-sleep-z')].map(z => Number(z.style.opacity)),
    glow: orb.getParameter('glowIntensity'),
  }));
  assert(ind.display === 'inline' && ind.z.some(o => o > 0.01) && ind.glow === 0.1, `indicator/config ${JSON.stringify(ind)}`);
  const pngs = [];
  for (const size of [128, 512]) {
    const p = await open('avatar.html?state=sleeping', { width: size, height: size });
    await wait(800);
    await p.screenshot({ omitBackground: true, path: fileURLToPath(new URL(`sleeping-${size}.png`, OUT)) });
    pngs.push(size); await p.close();
  }

  // Wake up: back to idle values, eyes open again, geometry untouched.
  await page.evaluate(() => orb.resetParameters({ state: 'sleeping', immediate: true }));
  const wake = await page.evaluate(async () => {
    orb.setState('idle');
    const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    let maxColStep = 0, prev = null;
    const t0 = performance.now();
    while (performance.now() - t0 < 3200) {
      await new Promise(r => requestAnimationFrame(r));
      const c = rgb(orb.svg.style.getPropertyValue('--orb-primary').trim());
      if (prev) maxColStep = Math.max(maxColStep, Math.hypot(...c.map((x, i) => x - prev[i])));
      prev = c;
    }
    const g = orb.symbolEls.get('eyes');
    return { maxColStep, primary: orb.svg.style.getPropertyValue('--orb-primary').trim(), eyes: Number(g.style.opacity) };
  });
  assert(wake.primary === presets.idle.colors.primary && wake.eyes > 0.95, `wake: ${JSON.stringify(wake)}`);
  assert(wake.maxColStep < 20, `wake colour jump ${wake.maxColStep.toFixed(1)}`);
  assert(geoBefore === await geo(), 'ribbon geometry changed');
  return `ribbons ${idleRate.toFixed(1)}→${sleepRate.toFixed(1)}°/s, halo ${idleHalo}→${sleepHalo}, breath ${p2p.toFixed(2)}% p2p, eyes closed @${eyes.closed}`;
});

await test('Talking: layers jump in a voice-like rhythm without audio input', async () => {
  const sample = () => page.evaluate(async () => {
    const scaleOf = r => Number(/scale\(([\d.]+)/.exec(orb.svg.querySelector(`[data-ribbon="${r}"]`).getAttribute('transform'))[1]);
    const back = [], main = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 4000) {
      await new Promise(r => requestAnimationFrame(r));
      back.push(scaleOf('back-1')); main.push(scaleOf('main-1'));
    }
    const range = a => Math.max(...a) - Math.min(...a);
    const step = a => Math.max(...a.slice(1).map((x, i) => Math.abs(x - a[i])));
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const mb = mean(back), mm = mean(main);
    const cov = back.reduce((acc, x, i) => acc + (x - mb) * (main[i] - mm), 0);
    const corr = cov / Math.sqrt(back.reduce((a, x) => a + (x - mb) ** 2, 0) * main.reduce((a, x) => a + (x - mm) ** 2, 0) || 1);
    const quiet = main.filter(x => x < Math.min(...main) + 0.003).length / main.length;
    return { range: range(main), step: step(main), corr, quiet };
  });
  await page.evaluate(() => { orb.resetParameters({ immediate: true }); orb.setParameter('ribbonAmplitude', 0, { all: true, immediate: true }); });
  await page.evaluate(() => orb.setState('idle', { immediate: true }));
  const idle = await sample();
  await page.evaluate(() => orb.setState('talking'));
  await wait(1200);
  const talk = await sample();
  const audio = await page.evaluate(() => orb.audio);
  await page.evaluate(() => orb.resetParameters({ immediate: true }));
  assert(idle.range < 0.004, `idle should be steady, scale range ${idle.range.toFixed(4)}`);
  assert(talk.range > 0.025, `talking scale range ${talk.range.toFixed(4)}`);
  assert(talk.step > 0.003, `talking not jerky enough, max step ${talk.step.toFixed(4)}`);
  assert(talk.corr < 0.85, `layers move in lockstep (corr ${talk.corr.toFixed(2)})`);
  assert(audio === 0, 'talking must not depend on audio input');
  return `scale range ${idle.range.toFixed(4)}→${talk.range.toFixed(3)}, max jump ${talk.step.toFixed(4)}, layer corr ${talk.corr.toFixed(2)}`;
});

await test('Extra: pause, reduced motion and per-frame cost', async () => {
  await page.evaluate(() => { orb.resetParameters({ immediate: true }); orb.setState('processing', { immediate: true }); });
  await wait(300);
  const normal = Math.abs(await rate('main-1', 1000));
  await page.evaluate(() => orb.setReducedMotion(true));
  const reduced = Math.abs(await rate('main-1', 1000));
  await page.evaluate(() => { orb.setReducedMotion('auto'); orb.pause(); });
  await wait(100);
  const paused = Math.abs(await rate('main-1', 600));
  await page.evaluate(() => orb.resume());
  const cost = await page.evaluate(() => {
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) orb._renderFrame(performance.now(), 1 / 60);
    return (performance.now() - t0) / 300;
  });
  assert(paused < 0.01, `paused but rotating ${paused}`);
  assert(reduced < normal * 0.4, `reduced motion ${reduced.toFixed(1)} vs ${normal.toFixed(1)}`);
  assert(cost < 2, `engine frame cost ${cost.toFixed(3)} ms`);
  return `rotation ${normal.toFixed(1)}°/s → reduced ${reduced.toFixed(1)} → paused ${paused}; JS ${cost.toFixed(3)} ms/frame`;
});

await page.goto(BASE + 'examples/api-demo.html');
await wait(3000);

await test('13. No external services required', async () => {
  assert(external.length === 0, `external requests: ${external.join(', ')}`);
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  return 'all requests served locally, no page errors';
});

await test('14. Launches locally with the documented command', async () => 'node tools/serve.mjs served every page above');

await browser.close();
server.kill();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: tests/output/`);
process.exit(failed.length ? 1 : 0);
