// Orb animation engine: drives the layered SVG from a parameter set.
//
//   - State presets + parameter schema live in orb-states.js / orb-params.js.
//   - Every animatable parameter has a tween; state changes and setParameter() retarget
//     tweens from their *current* value, so interrupted transitions redirect smoothly.
//   - Motion (rotation, wobble, pulse, breathing) is integrated per frame, so speed
//     changes never cause jumps.
//   - Each frame only writes attributes/variables whose value actually changed.
//   - Elements are found by class / data attributes, never by id, so instances with
//     uniquified ids (several orbs per page) work.

import { PARAMS, EASINGS, DURATION_FOR_GROUP, defaultValues, flattenParams, groupParams, isGlobal } from './orb-params.js';
import { STATE_PRESETS } from './orb-states.js';
import { SymbolRegistry, buildSymbolGroup } from './orb-symbols.js';
import { normalizeColor, parseColor, rgbToOklab, oklabToRgb, lerpLab, toHex } from './orb-color.js';
import { CONFIG_VERSION } from './orb-config-version.js';

export { CONFIG_VERSION };

const SYMBOL_UNIT = 60;     // symbolX/Y of ±1 moves the symbol ±60 user units
const MAX_DT = 0.25;        // clamp frame delta (s) after tab switches / stalls (≥4 fps keeps real time)

const COLOR_VARS = {
  primary: '--orb-primary', secondary: '--orb-secondary', accent: '--orb-accent',
  highlight: '--orb-highlight', glow: '--orb-glow', core: '--orb-core', symbolColor: '--orb-symbol-color',
};

// Layer toggle parameter -> layer class in the SVG.
const LAYER_CLASSES = {
  layerGlow: 'orb-glow', layerBack: 'orb-back-ribbons', layerCore: 'orb-core', layerInner: 'orb-inner-ribbons',
  layerMain: 'orb-main-ribbons', layerHighlights: 'orb-highlights', layerInterface: 'orb-interface',
  layerFront: 'orb-foreground-ribbons',
};
const RIBBON_LAYERS = { back: 'layerBack', inner: 'layerInner', main: 'layerMain', front: 'layerFront' };

// Per-ribbon variety so ribbons in one layer never move as a rigid block:
// [speed multiplier, wobble frequency (Hz at speed 1), wobble phase]
const RIBBON_VARIETY = {
  'back-1': [1.0, 0.07, 0.0], 'back-2': [0.72, 0.05, 2.1], 'back-3': [1.25, 0.09, 4.0],
  'main-1': [1.0, 0.06, 1.0], 'main-2': [0.8, 0.08, 3.3], 'main-3': [1.3, 0.05, 5.1],
  'inner-1': [1.0, 0.1, 0.5], 'inner-2': [0.75, 0.08, 2.7],
  'front-1': [1.0, 0.06, 1.8], 'front-2': [1.35, 0.07, 4.4],
};

// Ribbon layer -> speech-rhythm band.
const SPEECH_BAND = { layerBack: 0, layerInner: 1, layerMain: 2, layerFront: 3 };

// Reduced-motion multipliers.
const REDUCED = { rotation: 0.15, wobble: 0.3, pulse: 0.25, breath: 0.4, rings: 0.3, highlight: 0.3 };
const FULL = { rotation: 1, wobble: 1, pulse: 1, breath: 1, rings: 1, highlight: 1 };

let instanceCounter = 0;

/** Suffix every id (and its url(#…)/href="#…" references) so several orbs can share a document. */
export function uniquifySvgIds(text, suffix) {
  const ids = [...text.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  for (const id of ids) {
    text = text
      .split(`id="${id}"`).join(`id="${id}${suffix}"`)
      .split(`url(#${id})`).join(`url(#${id}${suffix})`)
      .split(`href="#${id}"`).join(`href="#${id}${suffix}"`)
      .split(`aria-labelledby="${id}"`).join(`aria-labelledby="${id}${suffix}"`);
  }
  return text;
}

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const f3 = v => (Math.round(v * 1000) / 1000).toString();
const TAU = Math.PI * 2;

export class OrbEngine {
  /**
   * Fetch the SVG asset, inline it into `container` and start an engine on it.
   * options: { src = 'assets/orb.svg', svgText, config, state, autoplay = true, ...engine options }
   */
  static async mount(container, options = {}) {
    let text = options.svgText;
    if (!text) {
      const res = await fetch(options.src || 'assets/orb.svg');
      if (!res.ok) throw new Error(`Could not load orb SVG (${res.status})`);
      text = await res.text();
    }
    text = uniquifySvgIds(text, `--orb${++instanceCounter}`);
    const host = document.createElement('div');
    host.className = 'orb-host';
    host.innerHTML = text;
    const svg = host.querySelector('svg');
    if (!svg) throw new Error('Orb SVG markup contains no <svg>');
    container.appendChild(host);
    return new OrbEngine(svg, options);
  }

  /**
   * @param {SVGSVGElement} svg  An inline orb SVG (assets/orb.svg markup).
   * @param {object} options     { config, state, autoplay = true, registry, pauseWhenHidden = true,
   *                               inactiveFps = null, presets }
   */
  constructor(svg, options = {}) {
    if (!svg || svg.namespaceURI !== 'http://www.w3.org/2000/svg') throw new Error('OrbEngine needs an inline <svg> element');
    this.svg = svg;
    this.options = options;
    this.registry = options.registry || new SymbolRegistry();
    this.listeners = new Map();
    this.global = defaultValues('global');
    this.presets = {};
    for (const [name, preset] of Object.entries({ ...STATE_PRESETS, ...(options.presets || {}) })) {
      this.presets[name] = { ...defaultValues('state'), ...this._validFlat(flattenParams(preset)) };
    }
    this.state = 'idle';

    // Make the SVG fill its host and hand symbol visibility to the engine.
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.classList.add('orb--engine');
    this._collectElements();
    this._mountCustomSymbols();

    // Motion integrators
    this.time = 0;
    this.angles = this.el.ribbons.map(() => 0);
    this.pulsePhase = 0;
    this.breathPhase = 0;
    this.highlightPhase = 0;
    this.ringPhase = 0;
    this.sleepPhase = 0;
    // Speech rhythm: one band per ribbon layer (back, inner, main, front).
    this.speechBands = [0, 1, 2, 3].map(() => ({ level: 0, target: 0, next: 0 }));
    this.speechClock = 0;
    this.phraseEnd = 2;
    this.pauseEnd = 0;
    this.durationScale = 1;
    this.audio = 0;
    this.audioTarget = 0;
    this.audioStamp = 0;
    this.nextBlink = 2500;
    this.blinkStart = -1;
    this.stats = { fps: 0 };

    this.paused = false;
    this.visible = true;
    this.focused = typeof document === 'undefined' || document.hasFocus?.() !== false;
    this._running = false;
    this._raf = 0;
    this._lastFrame = 0;
    this._fpsFrames = 0;
    this._fpsStamp = 0;
    this._cache = new WeakMap();
    this._vars = {};

    if (options.config) this.loadConfig(options.config, { immediate: true, silent: true });
    if (options.state) this.state = this.presets[options.state] ? options.state : this.state;

    this._initTweens();
    this._initSymbols();
    this._setupEnvironment();
    this.svg.dataset.state = this.state;
    this._renderFrame(performance.now(), 0);
    if (options.autoplay === false) this.paused = true;
    this._ensureLoop();
  }

  // ======================================================================
  // Public API
  // ======================================================================

  /** Switch to a state preset ("idle" | "listening" | "processing" | "memory" | registered). */
  setState(name, { immediate = false } = {}) {
    const key = typeof name === 'string' ? name.trim().toLowerCase() : '';
    if (!this.presets[key]) {
      console.warn(`[orb] Unknown state "${name}". Available: ${Object.keys(this.presets).join(', ')}`);
      return false;
    }
    const previous = this.state;
    this.state = key;
    this.svg.dataset.state = key;
    // Entering a state uses its transitionPace; leaving one averages both, so e.g. waking up
    // from sleep is as gentle as falling asleep.
    if (previous !== key) {
      const pace = s => this.presets[s]?.transitionPace ?? 1;
      this.durationScale = (pace(previous) + pace(key)) / 2;
      if (pace(key) > pace(previous)) this.durationScale = pace(key);
    }
    this._retarget(immediate);
    if (previous !== key) this._emit('statechange', { state: key, previous });
    return true;
  }

  getState() { return this.state; }
  listStates() { return Object.keys(this.presets); }

  /**
   * Set one parameter. State-scoped parameters edit the *active state's* preset
   * (pass { all: true } to apply to every state). Global ones apply everywhere.
   * Returns true if accepted.
   */
  setParameter(key, value, opts = {}) {
    const res = this._setOne(key, value, opts);
    if (res) {
      this._retarget(opts.immediate);
      this._emit('change', { keys: [key] });
    }
    return res;
  }

  /** Set several parameters (flat or grouped object). Returns { applied, rejected }. */
  setParameters(params, opts = {}) {
    const applied = [], rejected = [];
    for (const [k, v] of Object.entries(flattenParams(params))) {
      (this._setOne(k, v, opts) ? applied : rejected).push(k);
    }
    if (applied.length) {
      this._retarget(opts.immediate);
      this._emit('change', { keys: applied });
    }
    return { applied, rejected };
  }

  /** Current target value of a parameter (for the active state). */
  getParameter(key) {
    if (!PARAMS[key]) return undefined;
    return isGlobal(key) ? this.global[key] : this.presets[this.state][key];
  }

  /** All parameter targets for the active state plus globals. { grouped: true } groups by section. */
  getParameters({ grouped = false } = {}) {
    const flat = { ...this.presets[this.state], ...this.global };
    return grouped ? groupParams(flat) : flat;
  }

  /** Replace palette colours: { primary, secondary, accent, highlight, glow, core, symbol | symbolColor }. */
  setColors(colors, opts = {}) {
    const flat = {}, unknown = [];
    for (const [k, v] of Object.entries(colors || {})) {
      const key = k === 'symbol' ? 'symbolColor' : k;
      if (PARAMS[key]?.type === 'color') flat[key] = v;
      else unknown.push(k);
    }
    if (unknown.length) console.warn(`[orb] setColors: unknown colour keys ${unknown.join(', ')}`);
    const res = this.setParameters(flat, opts);
    res.rejected.push(...unknown);
    return res;
  }

  /** Select the central symbol for the active state (or all states with { all: true }). */
  setSymbol(name, opts = {}) {
    if (!this.registry.resolve(name)) {
      console.warn(`[orb] Unknown symbol "${name}". Available: ${this.listSymbols().map(s => s.name).join(', ')}`);
      return false;
    }
    return this.setParameter('symbol', name, opts);
  }

  listSymbols() { return this.registry.list(); }

  /**
   * Register a custom SVG symbol. Markup is sanitised (shapes only, no scripts/links/styles).
   * options: { label, viewBox = '-60 -60 120 120', scale, x, y, color, opacity }
   */
  registerSymbol(name, markup, options = {}) {
    let entry;
    try {
      entry = this.registry.register(name, markup, options);
    } catch (err) {
      console.warn(`[orb] registerSymbol("${name}") rejected: ${err.message}`);
      return false;
    }
    this._mountSymbol(entry);
    this._emit('symbolsChanged', { symbols: this.listSymbols() });
    return true;
  }

  unregisterSymbol(name) {
    if (!this.registry.unregister(name)) return false;
    for (const p of Object.values(this.presets)) if (p.symbol === name) p.symbol = 'eyes';
    const el = this.symbolEls.get(name);
    if (el) { el.remove(); this.symbolEls.delete(name); }
    if (this.symbolShown === name) this.symbolShown = null;
    this._retarget();
    this._emit('symbolsChanged', { symbols: this.listSymbols() });
    return true;
  }

  /** Per-symbol presentation: { scale, x, y (-1..1), color (or null), opacity }. */
  configureSymbol(name, options) {
    const s = this.registry.configure(name, options);
    if (!s) return false;
    this._applySymbolOptions(s.name);
    this._ensureLoop();
    return true;
  }

  /** Feed a microphone level 0..1. Smoothed internally; decays to 0 if not updated. */
  setAudioLevel(level) {
    const v = Number(level);
    if (!Number.isFinite(v)) return false;
    this.audioTarget = clamp(v);
    this.audioStamp = performance.now();
    this._ensureLoop();
    return true;
  }

  /** Show/hide a layer: 'glow' | 'back' | 'core' | 'inner' | 'main' | 'highlights' | 'interface' | 'front'. */
  setLayerVisible(layer, visible) {
    const key = layer?.startsWith?.('layer') ? layer : `layer${String(layer).charAt(0).toUpperCase()}${String(layer).slice(1)}`;
    if (!LAYER_CLASSES[key]) { console.warn(`[orb] Unknown layer "${layer}"`); return false; }
    return this.setParameter(key, !!visible);
  }

  /** Restore defaults: every state + globals, or only { state }. */
  resetParameters({ state, immediate = false } = {}) {
    const fresh = name => ({ ...defaultValues('state'), ...this._validFlat(flattenParams(
      { ...STATE_PRESETS, ...(this.options.presets || {}) }[name] || {})) });
    if (state) {
      if (!this.presets[state]) return false;
      this.presets[state] = fresh(state);
    } else {
      for (const name of Object.keys(this.presets)) this.presets[name] = fresh(name);
      this.global = defaultValues('global');
      this._updateReducedMotion();
    }
    this._retarget(immediate);
    this._emit('change', { keys: Object.keys(PARAMS), reset: true });
    return true;
  }

  /** Add or replace a state preset (partial; missing values come from `basedOn`). */
  registerState(name, preset, { basedOn = 'idle' } = {}) {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(name || '')) { console.warn(`[orb] Invalid state name "${name}"`); return false; }
    const base = this.presets[basedOn] || defaultValues('state');
    this.presets[name] = { ...base, ...this._validFlat(flattenParams(preset)) };
    this._emit('statesChanged', { states: this.listStates() });
    return true;
  }

  /** Full configuration snapshot (JSON-serialisable). */
  getConfig() {
    const presets = {};
    for (const [name, p] of Object.entries(this.presets)) presets[name] = groupParams(p);
    const symbols = {};
    for (const s of this.registry.symbols.values()) {
      if (!s.builtin) symbols[s.name] = { markup: s.markup, options: { label: s.label, viewBox: s.viewBox, ...s.options } };
    }
    return { version: CONFIG_VERSION, state: this.state, global: groupParams(this.global), presets, symbols };
  }

  exportConfig() { return JSON.stringify(this.getConfig(), null, 2); }

  /**
   * Load a configuration. Accepts the full shape from getConfig()/exportConfig() (object or
   * JSON string), or a single-state shape { state, colors, motion, lighting, interface, ... }
   * which is applied to that state. Unknown keys are ignored. Returns { applied, rejected }.
   */
  loadConfig(config, { immediate = false, silent = false } = {}) {
    let cfg = config;
    if (typeof cfg === 'string') {
      try { cfg = JSON.parse(cfg); } catch (err) { console.warn('[orb] loadConfig: invalid JSON', err); return { applied: [], rejected: ['<json>'] }; }
    }
    if (!cfg || typeof cfg !== 'object') return { applied: [], rejected: ['<config>'] };
    const applied = [], rejected = [];
    const apply = (target, flat, scopeGlobal, prefix) => {
      for (const [k, v] of Object.entries(flat)) {
        const p = PARAMS[k];
        if (!p || isGlobal(k) !== scopeGlobal) { rejected.push(prefix + k); continue; }
        const r = this._validate(k, v);
        if (r.ok) { target[k] = r.value; applied.push(prefix + k); } else rejected.push(prefix + k);
      }
    };

    for (const [name, s] of Object.entries(cfg.symbols || {})) {
      if (this.registry.get(name)?.builtin) continue;
      if (s && typeof s.markup === 'string' && this.registerSymbol(name, s.markup, s.options || {})) applied.push(`symbols.${name}`);
      else rejected.push(`symbols.${name}`);
    }

    if (cfg.global) apply(this.global, flattenParams(cfg.global), true, 'global.');
    if (cfg.presets && typeof cfg.presets === 'object') {
      for (const [name, preset] of Object.entries(cfg.presets)) {
        if (!/^[a-z][a-z0-9_-]{0,39}$/.test(name)) { rejected.push(`presets.${name}`); continue; }
        this.presets[name] ||= { ...defaultValues('state') };
        apply(this.presets[name], flattenParams(preset), false, `presets.${name}.`);
      }
    } else {
      // Single-state shape: everything except `state`/`version` applies to that state (globals to global).
      const name = this.presets[cfg.state] ? cfg.state : this.state;
      const { state, version, symbols, ...rest } = cfg;
      const flat = flattenParams(rest);
      const g = {}, s = {};
      for (const [k, v] of Object.entries(flat)) (isGlobal(k) ? g : s)[k] = v;
      apply(this.global, g, true, 'global.');
      apply(this.presets[name], s, false, `${name}.`);
    }

    this._updateReducedMotion();
    if (cfg.state && this.presets[cfg.state]) this.state = cfg.state;
    if (this.tweens) {
      this.svg.dataset.state = this.state;
      this._retarget(immediate);
    }
    if (!silent) {
      this._emit('statechange', { state: this.state, previous: null });
      this._emit('change', { keys: applied, loaded: true });
    }
    return { applied, rejected };
  }

  pause() { this.paused = true; this._emit('playback', { paused: true }); }
  resume() { this.paused = false; this._ensureLoop(); this._emit('playback', { paused: false }); }
  isPaused() { return this.paused; }

  /** 'auto' (follow OS) | 'on' | 'off' — or true/false. */
  setReducedMotion(mode) {
    return this.setParameter('reducedMotion', mode === true ? 'on' : mode === false ? 'off' : mode);
  }

  /** Subscribe to 'statechange' | 'change' | 'symbolchange' | 'symbolsChanged' | 'statesChanged' | 'playback'. */
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._running = false;
    this._teardown?.();
    this.listeners.clear();
  }

  // ======================================================================
  // Setup
  // ======================================================================

  _collectElements() {
    const q = sel => this.svg.querySelector(sel);
    const el = {
      root: q('.orb-root'),
      halo: q('.orb-glow-halo'),
      innerLight: q('.orb-core-inner-light'),
      specular: q('.orb-specular'),
      bounce: q('.orb-bounce'),
      stage: q('.orb-symbol-stage'),
      soundwaves: q('.orb-soundwaves'),
      rings: [...this.svg.querySelectorAll('.orb-soundwave')],
      particles: q('.orb-particles'),
      sleepIndicator: q('.orb-sleep-indicator'),
      sleepZs: [...this.svg.querySelectorAll('.orb-sleep-z')].map(z => ({ el: z, base: z.getAttribute('transform') || '' })),
      particleDots: [...this.svg.querySelectorAll('.orb-particles circle')],
      layers: {},
      ribbons: [],
    };
    for (const [key, cls] of Object.entries(LAYER_CLASSES)) el.layers[key] = q(`.${cls}`);
    this.svg.querySelectorAll('.orb-ribbon').forEach((g, i) => {
      const layerName = [...g.classList].find(c => c.startsWith('orb-ribbon--'))?.slice(12) || 'main';
      const name = g.dataset.ribbon || `ribbon-${i}`;
      const v = RIBBON_VARIETY[name] || [0.8 + ((i * 0.37) % 0.5), 0.05 + ((i * 0.013) % 0.05), i * 1.7];
      el.ribbons.push({ g, layer: RIBBON_LAYERS[layerName] || 'layerMain', speed: v[0], wobbleFreq: v[1], phase: v[2] });
    });
    const missing = ['root', 'halo', 'stage'].filter(k => !el[k]);
    if (missing.length) throw new Error(`Orb SVG is missing required layers: ${missing.join(', ')}`);
    this.el = el;

    // Symbols already drawn in the SVG (built-ins and any static custom slot)
    this.symbolEls = new Map();
    el.stage.querySelectorAll(':scope > .orb-symbol[data-symbol]').forEach(g => this.symbolEls.set(g.dataset.symbol, g));
  }

  _mountCustomSymbols() {
    for (const s of this.registry.symbols.values()) if (!s.builtin) this._mountSymbol(s);
  }

  _mountSymbol(entry) {
    const old = this.symbolEls.get(entry.name);
    const g = buildSymbolGroup(entry, this.svg.ownerDocument);
    g.style.display = 'none';
    if (old) old.replaceWith(g); else this.el.stage.appendChild(g);
    this.symbolEls.set(entry.name, g);
    if (this.symbolShown === entry.name) g.style.display = 'inline';
    this._applySymbolOptions(entry.name);
  }

  _initSymbols() {
    for (const g of this.symbolEls.values()) { g.style.display = 'none'; g.style.opacity = '0'; }
    this.symbolShown = this.registry.resolve(this.presets[this.state].symbol) || 'eyes';
    this.symbolTarget = this.symbolShown;
    this.symbolFade = 1;
    const shown = this.symbolEls.get(this.symbolShown);
    if (shown) shown.style.display = 'inline';
    for (const name of this.symbolEls.keys()) this._applySymbolOptions(name);
  }

  _applySymbolOptions(name) {
    const g = this.symbolEls.get(name);
    const s = this.registry.get(name);
    if (!g) return;
    const o = s ? s.options : { scale: 1, x: 0, y: 0, color: null, opacity: 1 };
    const t = (o.x || o.y || o.scale !== 1) ? `translate(${f3(o.x * SYMBOL_UNIT)} ${f3(o.y * SYMBOL_UNIT)}) scale(${f3(o.scale)})` : null;
    if (t) g.setAttribute('transform', t); else g.removeAttribute('transform');
    const c = o.color && normalizeColor(o.color);
    if (c) g.style.setProperty('--orb-symbol-color', c); else g.style.removeProperty('--orb-symbol-color');
  }

  _setupEnvironment() {
    const offs = [];
    const listen = (target, ev, fn) => { target.addEventListener(ev, fn); offs.push(() => target.removeEventListener(ev, fn)); };

    if (this.options.pauseWhenHidden !== false && typeof document !== 'undefined') {
      listen(document, 'visibilitychange', () => { this.visible = !document.hidden && this._inView !== false; this._ensureLoop(); });
      if (typeof IntersectionObserver !== 'undefined') {
        const io = new IntersectionObserver(entries => {
          this._inView = entries[entries.length - 1].isIntersecting;
          this.visible = !document.hidden && this._inView;
          this._ensureLoop();
        });
        io.observe(this.svg);
        offs.push(() => io.disconnect());
      }
    }
    if (typeof window !== 'undefined') {
      listen(window, 'blur', () => { this.focused = false; });
      listen(window, 'focus', () => { this.focused = true; });
      if (window.matchMedia) {
        this._mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        listen(this._mq, 'change', () => this._updateReducedMotion());
      }
    }
    this._updateReducedMotion();
    this._teardown = () => offs.forEach(off => off());
  }

  _updateReducedMotion() {
    const mode = this.global.reducedMotion;
    this.reduced = mode === 'on' || (mode === 'auto' && !!this._mq?.matches);
    this.rm = this.reduced ? REDUCED : FULL;
  }

  // ======================================================================
  // Parameters & tweens
  // ======================================================================

  _validate(key, value) {
    const p = PARAMS[key];
    if (!p) return { ok: false, error: `unknown parameter "${key}"` };
    switch (p.type) {
      case 'color': {
        const c = normalizeColor(value);
        return c ? { ok: true, value: c } : { ok: false, error: `"${value}" is not a colour (#rrggbb or rgb())` };
      }
      case 'number': {
        const n = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
        if (!Number.isFinite(n)) return { ok: false, error: `"${value}" is not a number` };
        return { ok: true, value: clamp(n, p.min, p.max) };
      }
      case 'boolean':
        if (typeof value === 'boolean') return { ok: true, value };
        if (value === 'true' || value === 1 || value === '1') return { ok: true, value: true };
        if (value === 'false' || value === 0 || value === '0') return { ok: true, value: false };
        return { ok: false, error: `"${value}" is not a boolean` };
      case 'enum': {
        const v = typeof p.options[0] === 'number' ? Number(value) : value;
        return p.options.includes(v) ? { ok: true, value: v } : { ok: false, error: `"${value}" is not one of ${p.options.join(', ')}` };
      }
      case 'symbol': {
        const s = this.registry.resolve(value);
        return s ? { ok: true, value: s } : { ok: false, error: `unknown symbol "${value}"` };
      }
    }
    return { ok: false, error: 'unsupported type' };
  }

  _validFlat(flat) {
    const out = {};
    for (const [k, v] of Object.entries(flat)) {
      if (!PARAMS[k] || isGlobal(k)) continue;
      const r = this._validate(k, v);
      if (r.ok) out[k] = r.value;
    }
    return out;
  }

  _setOne(key, value, opts) {
    const r = this._validate(key, value);
    if (!r.ok) { console.warn(`[orb] setParameter: ${r.error}`); return false; }
    if (isGlobal(key)) {
      this.global[key] = r.value;
      if (key === 'reducedMotion') this._updateReducedMotion();
    } else {
      const targets = opts.all ? Object.values(this.presets) : [this.presets[this.state]];
      for (const p of targets) p[key] = r.value;
    }
    return true;
  }

  _initTweens() {
    this.tweens = {};
    for (const [key, p] of Object.entries(PARAMS)) {
      if (p.type === 'symbol' || (isGlobal(key) && p.group !== 'layers')) continue;
      const target = this._targetValue(key);
      const v = this._toInternal(p.type, target);
      this.tweens[key] = { type: p.type, group: p.group, from: v, to: v, value: v, t0: 0, dur: 0, done: true };
    }
    this.v = {};
    for (const key of Object.keys(this.tweens)) this.v[key] = this._fromInternal(this.tweens[key]);
  }

  _targetValue(key) { return isGlobal(key) ? this.global[key] : this.presets[this.state][key]; }

  _toInternal(type, value) {
    if (type === 'color') return rgbToOklab(parseColor(value) || [0, 0, 0]);
    if (type === 'boolean') return value ? 1 : 0;
    return Number(value);
  }

  _fromInternal(tw) {
    return tw.type === 'color' ? toHex(oklabToRgb(tw.value)) : tw.value;
  }

  /** Point every tween at the current target values (from wherever it is now). */
  _retarget(immediate = false) {
    if (!this.tweens) return;
    const now = performance.now();
    for (const [key, tw] of Object.entries(this.tweens)) {
      const to = this._toInternal(tw.type, this._targetValue(key));
      const same = tw.type === 'color' ? to.every((c, i) => Math.abs(c - tw.to[i]) < 1e-6) : to === tw.to;
      if (same && !immediate) continue;
      this._sample(tw, now);
      tw.from = tw.type === 'color' ? [...tw.value] : tw.value;
      tw.to = to;
      tw.t0 = now;
      tw.dur = immediate ? 0 : (this.global[DURATION_FOR_GROUP[tw.group]] ?? 600) * this.durationScale;
      tw.done = false;
      if (immediate) { this._sample(tw, now); this.v[key] = this._fromInternal(tw); }
    }
    const sym = this.registry.resolve(this.presets[this.state].symbol) || 'eyes';
    if (sym !== this.symbolTarget) {
      this.symbolTarget = sym;
      this._emit('symbolchange', { symbol: sym });
    }
    if (immediate) { this.symbolShown = this._swapSymbol(this.symbolShown, sym); this.symbolFade = 1; }
    this._ensureLoop();
    if (!this._running) this._renderFrame(now, 0);
  }

  _sample(tw, now) {
    if (tw.done) return;
    const p = tw.dur <= 0 ? 1 : clamp((now - tw.t0) / tw.dur);
    const e = (EASINGS[this.global.easing] || EASINGS.easeInOutCubic)(p);
    tw.value = tw.type === 'color' ? lerpLab(tw.from, tw.to, e) : tw.from + (tw.to - tw.from) * e;
    if (p >= 1) { tw.value = tw.type === 'color' ? [...tw.to] : tw.to; tw.done = true; }
  }

  _swapSymbol(from, to) {
    if (from === to) return to;
    const a = this.symbolEls.get(from), b = this.symbolEls.get(to);
    if (a) { a.style.display = 'none'; a.style.opacity = '0'; }
    if (b) b.style.display = 'inline';
    return to;
  }

  // ======================================================================
  // Frame loop
  // ======================================================================

  _busy() {
    if (this.symbolShown !== this.symbolTarget || this.symbolFade < 1) return true;
    if (this.audio > 0.001 || this.audioTarget > 0) return true;
    for (const tw of Object.values(this.tweens || {})) if (!tw.done) return true;
    return false;
  }

  _ensureLoop() {
    if (this._running || !this.tweens) return;
    if (!this.visible) return;
    if (this.paused && !this._busy()) return;
    this._running = true;
    this._lastFrame = 0;
    this._raf = requestAnimationFrame(t => this._tick(t));
  }

  _tick(now) {
    if (!this.visible || (this.paused && !this._busy())) { this._running = false; return; }
    this._raf = requestAnimationFrame(t => this._tick(t));
    const fpsCap = (!this.focused && this.options.inactiveFps) || this.global.maxFps;
    if (this._lastFrame && now - this._lastFrame < 1000 / fpsCap - 1.5) return;
    const dt = this._lastFrame ? Math.min(MAX_DT, (now - this._lastFrame) / 1000) : 0;
    this._lastFrame = now;
    this._renderFrame(now, dt);

    this._fpsFrames++;
    if (now - this._fpsStamp >= 1000) {
      this.stats.fps = Math.round((this._fpsFrames * 1000) / (now - this._fpsStamp || 1));
      this._fpsFrames = 0;
      this._fpsStamp = now;
    }
  }

  _renderFrame(now, dt) {
    for (const [key, tw] of Object.entries(this.tweens)) {
      if (!tw.done) { this._sample(tw, now); this.v[key] = this._fromInternal(tw); }
    }
    const v = this.v, rm = this.rm;

    // ---- integrate motion ----------------------------------------------
    const mdt = this.paused ? 0 : dt * v.animationSpeed;
    this.time += mdt;
    this.pulsePhase += TAU * v.pulseFrequency * mdt;
    this.breathPhase += TAU * v.breathingFrequency * mdt;
    this.highlightPhase += v.highlightSpeed * mdt * rm.highlight;
    this.ringPhase += mdt * 1.1 * rm.rings;

    // Audio: fast attack, slower release, decay when the feed stops.
    if (now - this.audioStamp > 600) this.audioTarget = 0;
    const tau = this.audioTarget > this.audio ? 0.05 : 0.25;
    this.audio += (this.audioTarget - this.audio) * (dt > 0 ? 1 - Math.exp(-dt / tau) : 0);
    if (this.audio < 0.001 && this.audioTarget === 0) this.audio = 0;
    const audio = this.audio * v.audioReactivity;

    const speechAmt = v.speechIntensity * (this.reduced ? 0.35 : 1);
    this._updateSpeech(this.paused ? 0 : dt, v.speechRate, speechAmt > 0.001);
    const bands = this.speechBands.map(b => b.level * speechAmt);
    const speech = (bands[0] + bands[1] + bands[2] + bands[3]) / 4;

    const pulseWave = (0.5 - 0.5 * Math.cos(this.pulsePhase)) ** 2;     // soft beat, 0..1
    const pulse = v.pulseIntensity * rm.pulse * pulseWave;
    const breath = v.breathingIntensity * rm.breath * Math.sin(this.breathPhase);

    // ---- palette / global variables --------------------------------------
    for (const [key, cssVar] of Object.entries(COLOR_VARS)) this._setVar(cssVar, v[key]);
    this._setVar('--orb-opacity', f3(v.opacity));
    this._setVar('--rb-width', f3(v.ribbonThickness * 8));
    this._setVar('--orb-edge-opacity', f3(v.highlightIntensity));
    this._setVar('--orb-rim-opacity', f3(clamp(v.outerIllumination * 0.44 * (1 + 0.3 * pulse + 0.4 * speech))));

    // ---- whole orb: breathing ---------------------------------------------
    this._attr(this.el.root, 'transform', `scale(${f3(1 + 0.022 * breath + 0.012 * audio + 0.008 * speech)})`);

    // ---- glow --------------------------------------------------------------
    this._style(this.el.halo, 'opacity', f3(clamp(v.glowIntensity * (1 + 0.15 * breath + 0.45 * pulse + 0.5 * audio + 0.6 * speech))));
    this._attr(this.el.halo, 'transform', `scale(${f3(0.78 + 0.27 * v.glowRadius + 0.02 * breath + 0.03 * pulse)})`);

    // ---- layers --------------------------------------------------------------
    for (const [key, g] of Object.entries(this.el.layers)) {
      if (!g) continue;
      const ribbon = key === 'layerBack' || key === 'layerInner' || key === 'layerMain' || key === 'layerFront';
      const o = clamp(v[key] * (ribbon ? v.ribbonOpacity : 1));
      this._style(g, 'opacity', f3(o));
      this._style(g, 'display', o < 0.002 ? 'none' : '');
    }

    // ---- ribbons: independent rotation + organic wobble ---------------------
    const wobble = v.ribbonAmplitude * rm.wobble;
    const ribbonPulse = 1 + 0.035 * pulse + 0.03 * audio;
    this.el.ribbons.forEach((r, i) => {
      const rp = ribbonPulse + 0.065 * bands[SPEECH_BAND[r.layer] ?? 2];
      const lname = r.layer.slice(5).toLowerCase();               // layerBack -> back
      const vel = v[`${lname}Speed`] * v[`${lname}Direction`];
      this.angles[i] = (this.angles[i] + vel * r.speed * mdt * rm.rotation) % 360;
      const w = TAU * r.wobbleFreq * this.time + r.phase;
      const rot = this.angles[i] + wobble * 10 * Math.sin(w);
      const squash = wobble * 0.05 * Math.sin(0.7 * w + r.phase * 1.3);
      this._attr(r.g, 'transform',
        `rotate(${f3(rot)}) scale(${f3(rp * (1 + squash))} ${f3(rp * (1 - squash))})`);
    });

    // ---- core inner light & highlights ---------------------------------------
    if (this.el.innerLight) {
      this._style(this.el.innerLight, 'opacity', f3(clamp(v.innerIllumination * 2 * (0.75 + 0.5 * pulse + 0.4 * audio + 0.9 * speech + 0.1 * breath))));
      this._attr(this.el.innerLight, 'transform', `scale(${f3(0.85 + 0.3 * v.innerIllumination + 0.08 * pulse)})`);
    }
    const hp = this.highlightPhase;
    if (this.el.specular) {
      this._style(this.el.specular, 'opacity', f3(clamp(v.highlightBrightness * 1.6)));
      this._attr(this.el.specular, 'transform',
        `rotate(${f3(9 * Math.sin(hp))}) translate(${f3(4 * Math.cos(hp * 0.7))} ${f3(3 * Math.sin(hp * 1.3))})`);
    }
    if (this.el.bounce) {
      this._style(this.el.bounce, 'opacity', f3(clamp(v.highlightBrightness * 1.6 * (0.85 + 0.3 * pulse))));
      this._attr(this.el.bounce, 'transform', `rotate(${f3(-7 * Math.sin(hp * 0.8 + 1))})`);
    }

    // ---- interface -------------------------------------------------------------
    this._renderSymbol(now, dt, pulse + 0.9 * speech, audio);

    // ---- sound-wave rings --------------------------------------------------------
    if (this.el.soundwaves) {
      const o = clamp(v.soundwaveVisible);
      this._style(this.el.soundwaves, 'display', o < 0.002 ? 'none' : 'inline');
      if (o >= 0.002) {
        this._style(this.el.soundwaves, 'opacity', f3(o * (0.75 + 0.25 * Math.sin(this.breathPhase))));
        const amp = 3 + 6 * pulse + 18 * audio;
        this.el.rings.forEach((ring, i) => {
          const ph = this.ringPhase * (i ? -0.8 : 1) + i * 1.3;
          this._attr(ring, 'd', waveRingPath(196 + i * 16 + 6 * audio, amp * (1 + i * 0.3), 6 - i, 9 - i, ph));
        });
      }
    }

    // ---- sleep indicator: two tiny z marks drifting up and fading (real time, ~7 s cycle) ----
    if (this.el.sleepIndicator) {
      const o = clamp(v.sleepIndicatorVisible);
      this._style(this.el.sleepIndicator, 'display', o < 0.002 ? 'none' : 'inline');
      if (o >= 0.002) {
        this.sleepPhase += this.paused ? 0 : dt / 7;
        this._style(this.el.sleepIndicator, 'opacity', f3(o));
        this.el.sleepZs.forEach((z, i) => {
          const t = (this.sleepPhase + i * 0.5) % 1;
          const rise = this.reduced ? 0 : -16 * t;
          this._attr(z.el, 'transform', `translate(${f3(3 * t)} ${f3(rise)}) ${z.base}`);
          this._style(z.el, 'opacity', f3(0.55 * Math.sin(Math.PI * t) ** 2));
        });
      }
    }

    // ---- particles ---------------------------------------------------------------
    if (this.el.particles) {
      const o = clamp(v.particlesVisible);
      this._style(this.el.particles, 'display', o < 0.002 ? 'none' : 'inline');
      if (o >= 0.002) {
        this._style(this.el.particles, 'opacity', f3(o));
        this._attr(this.el.particles, 'transform', `rotate(${f3((this.time * 4 * rm.rotation) % 360)})`);
        this.el.particleDots.forEach((c, i) =>
          this._style(c, 'opacity', f3(0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.time * (0.9 + i * 0.23) + i * 2)))));
      }
    }
  }

  _renderSymbol(now, dt, pulse, audio) {
    const v = this.v;
    const half = Math.max(1, (this.global.symbolDuration * this.durationScale) / 2);
    // Sequential cross-fade: fade the shown symbol out, swap, fade the new one in. A new
    // request mid-fade just changes the target, so symbols never overlap or jump.
    if (this.symbolShown !== this.symbolTarget) {
      this.symbolFade -= (dt * 1000) / half;
      if (this.symbolFade <= 0 || !this.symbolEls.get(this.symbolShown)) {
        this.symbolFade = 0;
        this.symbolShown = this._swapSymbol(this.symbolShown, this.symbolTarget);
        if (this.symbolShown === 'eyes') this.nextBlink = now + 1200;
      }
    } else if (this.symbolFade < 1) {
      this.symbolFade = Math.min(1, this.symbolFade + (dt * 1000) / half);
    }

    const g = this.symbolEls.get(this.symbolShown);
    this._attr(this.el.stage, 'transform',
      `translate(${f3(v.symbolX * SYMBOL_UNIT)} ${f3(v.symbolY * SYMBOL_UNIT)}) scale(${f3(v.symbolScale * (1 + 0.03 * pulse + 0.04 * audio))})`);
    if (!g) return;

    const opts = this.registry.get(this.symbolShown)?.options || { opacity: 1 };
    const eyes = this.symbolShown === 'eyes' ? v.eyesVisible : 1;
    const fade = EASINGS.easeInOutSine(this.symbolFade);
    this._style(g, 'opacity', f3(clamp(fade * v.symbolOpacity * opts.opacity * eyes)));

    if (this.symbolShown === 'eyes') this._renderBlink(g, now);
    if (g._bars === undefined) g._bars = [...g.querySelectorAll('.orb-bar')];
    if (g._nodes === undefined) g._nodes = [...g.querySelectorAll('.orb-node')];

    if (g._bars.length && !this.paused) {
      const t = this.time;
      g._bars.forEach((bar, i) => {
        const idle = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * (2.1 + i * 0.37) * this.rm.wobble + i * 1.9));
        const live = 0.25 + 1.05 * audio * (0.6 + 0.4 * Math.abs(Math.sin(t * 6 + i * 2.3)));
        const k = audio > 0.01 ? idle * 0.4 + live * 0.6 : idle;
        this._attr(bar, 'transform', `scale(1 ${f3(clamp(k, 0.15, 1.3))})`);
      });
    }
    if (g._nodes.length) {
      const t = this.time;
      g._nodes.forEach((n, i) =>
        this._style(n, 'opacity', f3(0.5 + 0.5 * Math.max(0, Math.sin(t * 2.2 - i * 0.9)) ** 2 + 0.3 * pulse)));
    }
  }

  /** Synthetic speech rhythm: syllable bursts (fast attack, quick decay) per band, phrase pauses. */
  _updateSpeech(dt, rate, active) {
    if (!active) { for (const b of this.speechBands) { b.level = 0; b.target = 0; } return; }
    if (dt <= 0) return;
    const c = (this.speechClock += dt);
    if (c >= this.phraseEnd) {            // phrases of 1.2–3.2 s, separated by 0.25–0.7 s pauses
      this.pauseEnd = c + 0.25 + Math.random() * 0.45;
      this.phraseEnd = this.pauseEnd + 1.2 + Math.random() * 2;
      for (const b of this.speechBands) b.target = 0;
    }
    const inPause = c < this.pauseEnd;
    for (const b of this.speechBands) {
      if (c >= b.next) {
        b.target = inPause ? 0 : 0.25 + 0.75 * Math.random() ** 0.7;
        b.next = c + (0.6 + Math.random() * 0.8) / rate;
      }
      const tau = b.target > b.level ? 0.035 : 0.11;
      b.level += (b.target - b.level) * (1 - Math.exp(-dt / tau));
      b.target *= Math.exp(-dt / 0.18);  // each syllable decays after its attack
    }
  }

  _renderBlink(g, now) {
    const blinkEl = g._blink === undefined ? (g._blink = g.querySelector('.orb-eyes__blink')) : g._blink;
    if (!blinkEl) return;
    let k = 1;
    if (this.v.blink >= 0.5 && !this.reduced && !this.paused) {
      if (this.blinkStart < 0 && now >= this.nextBlink) this.blinkStart = now;
      if (this.blinkStart >= 0) {
        const p = (now - this.blinkStart) / 170;
        if (p >= 1) {
          this.blinkStart = -1;
          // Occasionally a quick double blink, otherwise 3-7 s apart.
          this.nextBlink = now + (Math.random() < 0.18 ? 140 : 3000 + Math.random() * 4000);
        } else {
          k = 1 - 0.88 * Math.sin(Math.PI * p);
        }
      }
    }
    this._attr(blinkEl, 'transform', k === 1 ? 'scale(1)' : `translate(0 -4) scale(1 ${f3(k)}) translate(0 4)`);
  }

  // ---- write helpers: only touch the DOM when a value changes ----------------
  _setVar(name, value) {
    if (this._vars[name] !== value) { this.svg.style.setProperty(name, value); this._vars[name] = value; }
  }

  _attr(el, name, value) {
    let c = this._cache.get(el);
    if (!c) this._cache.set(el, (c = {}));
    if (c[name] !== value) { el.setAttribute(name, value); c[name] = value; }
  }

  _style(el, prop, value) {
    let c = this._cache.get(el);
    if (!c) this._cache.set(el, (c = {}));
    const k = `s:${prop}`;
    if (c[k] !== value) { el.style[prop] = value; c[k] = value; }
  }

  _emit(event, detail) {
    for (const fn of this.listeners.get(event) || []) {
      try { fn(detail, this); } catch (err) { console.error('[orb] listener error', err); }
    }
  }
}

/** Closed, smoothed wavy ring (must match wave_ring() in tools/generate_orb.py). */
export function waveRingPath(r0, amp, k1, k2, phase, points = 48) {
  const pts = [];
  for (let i = 0; i < points; i++) {
    const a = (TAU * i) / points;
    const r = r0 + amp * (0.6 * Math.sin(k1 * a + phase) + 0.4 * Math.sin(k2 * a - phase * 1.7));
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  const n = pts.length;
  const p = ([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  let d = `M${p(pts[0])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${p(c1)} ${p(c2)} ${p(p2)}`;
  }
  return d + 'Z';
}
