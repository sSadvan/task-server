// Development control panel. Generated from the parameter schema, so new parameters
// show up automatically. Talks to the orb only through its public API.
// Not part of the avatar: the desktop window loads the engine without this file.

import { PARAMS, GROUPS } from './orb-params.js';

const OPEN_GROUPS = new Set(['colors', 'motion', 'lighting']);

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
};

/**
 * @param {OrbEngine} orb
 * @param {HTMLElement} container  where the panel is rendered
 * @param {{ stage?: HTMLElement }} options  stage = element holding the orb (for background/size previews)
 */
export function createControlPanel(orb, container, { stage } = {}) {
  const inputs = new Map();        // param key -> { set(value) }
  let applyAll = false;
  let sending = false;             // true while the panel itself is calling the API
  const opts = () => (applyAll ? { all: true } : {});
  const sendParam = (key, value) => { sending = true; try { orb.setParameter(key, value, opts()); } finally { sending = false; } };

  // ---- States ---------------------------------------------------------------
  const stateBtns = h('div', { class: 'cp-states', role: 'group', 'aria-label': 'State' });
  const renderStates = () => {
    stateBtns.replaceChildren(...orb.listStates().map(name =>
      h('button', { type: 'button', class: 'cp-state', 'data-state': name, 'aria-pressed': String(name === orb.getState()),
        onclick: () => orb.setState(name) }, name)));
  };

  // ---- Playback ---------------------------------------------------------------
  const pauseBtn = h('button', { type: 'button', onclick: () => (orb.isPaused() ? orb.resume() : orb.pause()) }, 'Pause');
  const resetBtn = h('button', { type: 'button', onclick: () => { orb.resetParameters(); setStatus('All settings reset to defaults'); } }, 'Reset all');
  const fps = h('span', { class: 'cp-fps' }, '– fps');
  setInterval(() => { fps.textContent = orb.isPaused() ? 'paused' : `${orb.stats.fps} fps`; }, 500);

  // ---- Preview (stage only, not engine) ----------------------------------------
  const bgSelect = h('select', { onchange: e => stage && (stage.dataset.bg = e.target.value) },
    h('option', { value: 'dark' }, 'Dark'), h('option', { value: 'checker' }, 'Checkerboard (transparency)'),
    h('option', { value: 'neutral' }, 'Neutral grey'), h('option', { value: 'light' }, 'Light'));
  const sizeSelect = h('select', { onchange: e => stage && stage.style.setProperty('--orb-size', e.target.value) },
    ...['min(512px, 90vw)', '512px', '256px', '128px', '64px'].map((v, i) =>
      h('option', { value: v }, i === 0 ? 'Fit (≤512)' : v.replace('px', ' × ' + v))));

  // ---- Symbol ---------------------------------------------------------------------
  const symbolSelect = h('select', { onchange: e => orb.setSymbol(e.target.value, opts()) });
  const renderSymbols = () => {
    symbolSelect.replaceChildren(...orb.listSymbols().map(s => h('option', { value: s.name }, s.label)));
    symbolSelect.value = orb.getParameter('symbol');
  };
  inputs.set('symbol', { set: v => { symbolSelect.value = v; } });

  const customName = h('input', { type: 'text', value: 'star', placeholder: 'name', 'aria-label': 'Custom symbol name' });
  const customMarkup = h('textarea', { rows: 4, spellcheck: 'false', 'aria-label': 'Custom symbol SVG markup' },
    '<path d="M0 -44L12 -12L44 0L12 12L0 44L-12 12L-44 0L-12 -12Z"/>');
  const registerBtn = h('button', { type: 'button', onclick: () => {
    const name = customName.value.trim();
    if (orb.registerSymbol(name, customMarkup.value, { label: `${name} (custom)` })) {
      orb.setSymbol(name, opts());
      setStatus(`Registered symbol "${name}"`);
    } else setStatus(`Could not register "${name}" — see console`, true);
  } }, 'Register & show');

  // ---- Audio ------------------------------------------------------------------------
  const audioLevel = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: 0, 'aria-label': 'Audio level' });
  const audioSim = h('input', { type: 'checkbox' });
  let simRaf = 0;
  const feed = () => {
    if (audioSim.checked) {
      const t = performance.now() / 1000;
      // Speech-like envelope: syllable bursts with pauses.
      const v = Math.max(0, Math.sin(t * 7.3) * 0.5 + Math.sin(t * 2.1) * 0.35 + Math.random() * 0.25) * (Math.sin(t * 0.9) > -0.3 ? 1 : 0.1);
      audioLevel.value = v.toFixed(2);
    }
    if (Number(audioLevel.value) > 0) orb.setAudioLevel(Number(audioLevel.value));
    simRaf = requestAnimationFrame(feed);
  };
  simRaf = requestAnimationFrame(feed);

  // ---- Config import/export -------------------------------------------------------------
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async e => {
    const file = e.target.files[0];
    if (!file) return;
    const res = orb.loadConfig(await file.text());
    renderSymbols();
    setStatus(`Imported ${res.applied.length} values` + (res.rejected.length ? `, ignored ${res.rejected.length}` : ''), !!res.rejected.length);
    e.target.value = '';
  } });
  const exportBtn = h('button', { type: 'button', onclick: () => {
    const blob = new Blob([orb.exportConfig()], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `orb-config-${orb.getState()}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setStatus('Configuration exported');
  } }, 'Export JSON');
  const importBtn = h('button', { type: 'button', onclick: () => fileInput.click() }, 'Import JSON');
  const copyBtn = h('button', { type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(orb.exportConfig()); setStatus('Configuration copied'); }
    catch { setStatus('Clipboard unavailable', true); }
  } }, 'Copy');

  const status = h('div', { class: 'cp-status', role: 'status' });
  let statusTimer = 0;
  function setStatus(msg, warn = false) {
    status.textContent = msg;
    status.classList.toggle('is-warn', warn);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = ''; }, 4000);
  }

  // ---- Schema-driven parameter sections ----------------------------------------------------
  const sections = Object.entries(GROUPS).map(([group, title]) => {
    const rows = Object.entries(PARAMS)
      .filter(([key, p]) => p.group === group && p.type !== 'symbol')
      .map(([key, p]) => paramRow(key, p));
    const scopeNote = group === 'layers' || group === 'transitions' || group === 'system'
      ? h('p', { class: 'cp-note' }, 'Shared by all states.') : null;
    return h('details', { class: 'cp-section', open: OPEN_GROUPS.has(group) }, h('summary', {}, title), scopeNote, ...rows);
  });

  function paramRow(key, p) {
    const id = `cp-${key}`;
    let input, out, set;
    const send = value => sendParam(key, value);
    if (p.type === 'color') {
      input = h('input', { type: 'color', id, oninput: e => send(e.target.value) });
      set = v => { input.value = v; };
    } else if (p.type === 'number') {
      out = h('output', { for: id });
      const fmt = v => (p.step >= 1 ? String(Math.round(v)) : Number(v).toFixed(2)) + (p.unit ? ` ${p.unit}` : '');
      input = h('input', { type: 'range', id, min: p.min, max: p.max, step: p.step,
        oninput: e => { out.textContent = fmt(e.target.value); send(Number(e.target.value)); } });
      set = v => { input.value = v; out.textContent = fmt(v); };
    } else if (p.type === 'boolean') {
      input = h('input', { type: 'checkbox', id, onchange: e => send(e.target.checked) });
      set = v => { input.checked = !!v; };
    } else {
      input = h('select', { id, onchange: e => send(e.target.value) },
        ...p.options.map(o => h('option', { value: o }, enumLabel(key, o))));
      set = v => { input.value = String(v); };
    }
    inputs.set(key, { set });
    return h('div', { class: `cp-row cp-row--${p.type}`, title: p.doc }, h('label', { for: id }, p.label), input, out);
  }

  function enumLabel(key, o) {
    if (key.endsWith('Direction')) return o === 1 ? 'Clockwise' : 'Counter-clockwise';
    return String(o);
  }

  function refresh() {
    for (const [key, { set }] of inputs) set(orb.getParameter(key));
    pauseBtn.textContent = orb.isPaused() ? 'Resume' : 'Pause';
    renderStates();
  }

  // ---- Layout ---------------------------------------------------------------------------------
  container.append(
    h('section', { class: 'cp-block' }, h('h2', {}, 'State'), stateBtns,
      h('label', { class: 'cp-inline' }, h('input', { type: 'checkbox', onchange: e => { applyAll = e.target.checked; } }),
        'Edits apply to all states')),
    h('section', { class: 'cp-block cp-toolbar' }, pauseBtn, resetBtn, fps),
    h('section', { class: 'cp-block' }, h('h2', {}, 'Preview'),
      h('div', { class: 'cp-row' }, h('label', {}, 'Background'), bgSelect),
      h('div', { class: 'cp-row' }, h('label', {}, 'Size'), sizeSelect)),
    h('section', { class: 'cp-block' }, h('h2', {}, 'Symbol'),
      h('div', { class: 'cp-row' }, h('label', {}, 'Active'), symbolSelect),
      h('details', { class: 'cp-sub' }, h('summary', {}, 'Register custom SVG symbol'),
        h('p', { class: 'cp-note' }, 'Shapes in a -60…60 box. Scripts, links and styles are stripped.'),
        customName, customMarkup, registerBtn)),
    h('section', { class: 'cp-block' }, h('h2', {}, 'Audio input'),
      h('div', { class: 'cp-row' }, h('label', {}, 'Level'), audioLevel),
      h('label', { class: 'cp-inline' }, audioSim, 'Simulate speech'),
      h('p', { class: 'cp-note' }, 'Drives setAudioLevel(). Reactivity is set per state (Interface → Audio reactivity).')),
    ...sections,
    h('section', { class: 'cp-block cp-toolbar' }, exportBtn, importBtn, copyBtn, fileInput),
    status,
  );

  orb.on('statechange', refresh);
  // Reflect changes made through the API elsewhere (console, app code), but never
  // overwrite the control the user is dragging right now.
  orb.on('change', d => { if (!sending || applyAll || d.keys?.includes('symbol')) refresh(); });
  orb.on('playback', refresh);
  orb.on('symbolsChanged', renderSymbols);
  renderSymbols();
  refresh();

  return { refresh, destroy: () => { cancelAnimationFrame(simRaf); container.replaceChildren(); } };
}
