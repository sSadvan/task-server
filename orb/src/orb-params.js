// Parameter schema: the single source of truth for every tunable value.
//
// Each entry: { group, type, default, min?, max?, step?, options?, scope?, label, doc }
//   type   'color' | 'number' | 'boolean' | 'enum' | 'symbol'
//   scope  'state'  (default) — stored per state preset, so each state can differ
//          'global' — stored once and shared by all states (layers, transitions, system)
//
// The dev panel and the docs are generated from this table, so adding a parameter
// here is enough for it to be validated, transitioned, exported and shown in the panel.
// The engine still has to *use* it (see OrbEngine#applyFrame).

export const GROUPS = {
  colors: 'Colors',
  appearance: 'Appearance',
  motion: 'Motion',
  lighting: 'Lighting',
  interface: 'Interface',
  layers: 'Layers',
  transitions: 'Transitions',
  system: 'System',
};

export const EASINGS = {
  linear: t => t,
  easeInOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  easeInOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  easeInOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  easeOutCubic: t => 1 - (1 - t) ** 3,
  easeOutQuart: t => 1 - (1 - t) ** 4,
};

const color = (def, label, doc) => ({ group: 'colors', type: 'color', default: def, label, doc });
const num = (group, def, min, max, step, label, doc, extra = {}) =>
  ({ group, type: 'number', default: def, min, max, step, label, doc, ...extra });
const bool = (group, def, label, doc, extra = {}) => ({ group, type: 'boolean', default: def, label, doc, ...extra });
const dir = (def, label) => ({
  group: 'motion', type: 'enum', default: def, options: [-1, 1], label,
  doc: 'Rotation direction: 1 = clockwise, -1 = counter-clockwise. Changes pass smoothly through zero.',
});
const layer = (label, doc) => bool('layers', true, label, doc, { scope: 'global' });
const ms = (def, label, doc) => num('transitions', def, 0, 5000, 50, label, doc, { scope: 'global', unit: 'ms' });

export const PARAMS = {
  // ---- Colors ------------------------------------------------------------
  primary: color('#2f7dff', 'Primary', 'Main ribbon colour and core rim.'),
  secondary: color('#2ee6ff', 'Secondary', 'Second ribbon colour, rim light, sound-wave rings.'),
  accent: color('#8b6cff', 'Accent', 'Subtle accent (violet by default): rear ribbons, bounce light.'),
  highlight: color('#d9fbff', 'Highlight', 'Luminous ribbon edges, specular sheen, particles.'),
  glow: color('#3aa8ff', 'Glow', 'Outer halo and inner light.'),
  core: color('#040815', 'Core', 'Dark central volume.'),

  // ---- Appearance --------------------------------------------------------
  opacity: num('appearance', 1, 0, 1, 0.01, 'Overall opacity', 'Opacity of the whole orb.'),
  ribbonOpacity: num('appearance', 1, 0, 1, 0.01, 'Ribbon opacity', 'Multiplier for all ribbon layers.'),
  ribbonThickness: num('appearance', 0, 0, 1, 0.01, 'Ribbon thickness',
    'Extra ribbon thickness. 0 = designed width, 1 = +8 user units.'),
  highlightIntensity: num('appearance', 1, 0, 1, 0.01, 'Edge highlight',
    'Brightness of the luminous ribbon edges.'),

  // ---- Motion ------------------------------------------------------------
  animationSpeed: num('motion', 1, 0, 3, 0.05, 'Animation speed',
    'Global time scale for all motion (rotation, wobble, pulse, breathing). 0 freezes motion.'),
  backSpeed: num('motion', 5, 0, 60, 0.5, 'Rear ribbons speed', 'Rotation speed of rear ribbons, degrees/second.', { unit: '°/s' }),
  backDirection: dir(-1, 'Rear ribbons direction'),
  innerSpeed: num('motion', 8, 0, 60, 0.5, 'Inner ribbons speed', 'Rotation speed of inner reflections, degrees/second.', { unit: '°/s' }),
  innerDirection: dir(1, 'Inner ribbons direction'),
  mainSpeed: num('motion', 6, 0, 60, 0.5, 'Main ribbons speed', 'Rotation speed of main ribbons, degrees/second.', { unit: '°/s' }),
  mainDirection: dir(1, 'Main ribbons direction'),
  frontSpeed: num('motion', 9, 0, 60, 0.5, 'Front ribbons speed', 'Rotation speed of foreground sweeps, degrees/second.', { unit: '°/s' }),
  frontDirection: dir(-1, 'Front ribbons direction'),
  ribbonAmplitude: num('motion', 0.35, 0, 1, 0.01, 'Ribbon amplitude',
    'Organic wobble on top of rotation: angle sway (up to ±10°) and squash/stretch (up to ±5%).'),
  breathingIntensity: num('motion', 0.45, 0, 1, 0.01, 'Breathing', 'Slow whole-orb scale and glow swell.'),
  breathingFrequency: num('motion', 0.16, 0.02, 1, 0.01, 'Breathing rate', 'Breaths per second.', { unit: 'Hz' }),
  pulseIntensity: num('motion', 0.05, 0, 1, 0.01, 'Pulse', 'Rhythmic pulse in ribbon scale, inner light and glow.'),
  pulseFrequency: num('motion', 0.5, 0.1, 4, 0.05, 'Pulse rate', 'Pulses per second.', { unit: 'Hz' }),
  highlightSpeed: num('motion', 0.3, 0, 2, 0.01, 'Highlight drift', 'Speed of the specular highlight drift.'),
  transitionPace: num('motion', 1, 0.25, 4, 0.05, 'Transition pace',
    'Multiplier on all transition durations when entering this state (leaving it uses the average of both states), e.g. 2.5 makes falling asleep and waking up slow and gentle.'),

  // ---- Lighting ----------------------------------------------------------
  glowIntensity: num('lighting', 0.55, 0, 1, 0.01, 'Glow intensity', 'Opacity of the outer halo.'),
  glowRadius: num('lighting', 0.5, 0, 1, 0.01, 'Glow radius', 'Size of the outer halo (0 = tight, 1 = wide).'),
  innerIllumination: num('lighting', 0.45, 0, 1, 0.01, 'Inner light', 'Light pooled inside the core behind the symbol.'),
  outerIllumination: num('lighting', 0.5, 0, 1, 0.01, 'Rim light', 'Fresnel-style light on the sphere edge.'),
  highlightBrightness: num('lighting', 0.6, 0, 1, 0.01, 'Specular', 'Brightness of the specular sheen and bounce light.'),

  // ---- Interface ---------------------------------------------------------
  symbol: { group: 'interface', type: 'symbol', default: 'eyes', label: 'Symbol',
    doc: 'Active central symbol: any registered name (eyes, code, soundwave, brain, network, or custom).' },
  symbolColor: { group: 'interface', type: 'color', default: '#e6fdff', label: 'Symbol colour', doc: 'Colour of eyes and symbols.' },
  symbolScale: num('interface', 1, 0.3, 2, 0.01, 'Symbol scale', 'Size multiplier for the central symbol.'),
  symbolX: num('interface', 0, -1, 1, 0.01, 'Symbol X', 'Horizontal offset, -1..1 (±60 user units).'),
  symbolY: num('interface', 0, -1, 1, 0.01, 'Symbol Y', 'Vertical offset, -1..1 (±60 user units).'),
  symbolOpacity: num('interface', 1, 0, 1, 0.01, 'Symbol opacity', 'Opacity of the central symbol.'),
  eyesVisible: bool('interface', true, 'Eyes visible', 'When false the eyes symbol is hidden even while selected.'),
  blink: bool('interface', true, 'Blink', 'Occasional eye blink (disabled under reduced motion).'),
  soundwaveVisible: bool('interface', false, 'Sound-wave rings', 'Liquid sound-wave rings around the orb.'),
  particlesVisible: bool('interface', false, 'Particles', 'Small drifting particles.'),
  sleepIndicatorVisible: bool('interface', false, 'Sleep indicator', 'Two tiny "z" marks that float up and fade, very slowly.'),
  audioReactivity: num('interface', 0, 0, 1, 0.01, 'Audio reactivity',
    'How strongly setAudioLevel() drives the rings, pulse and sound-wave symbol.'),

  // ---- Layers (global) -----------------------------------------------------
  layerGlow: layer('Glow', 'Outer atmospheric halo.'),
  layerBack: layer('Rear ribbons', 'Ribbons behind the core.'),
  layerCore: layer('Core', 'Dark central volume and inner light.'),
  layerInner: layer('Inner ribbons', 'Internal reflections.'),
  layerMain: layer('Main ribbons', 'Main translucent ribbons.'),
  layerHighlights: layer('Highlights', 'Specular sheen and bounce light.'),
  layerInterface: layer('Interface', 'Central symbol layer.'),
  layerFront: layer('Front ribbons', 'Foreground sweeps.'),

  // ---- Transitions (global) -----------------------------------------------
  colorDuration: ms(900, 'Colour transition', 'Duration of palette changes.'),
  symbolDuration: ms(500, 'Symbol transition', 'Total symbol swap time (fade out, then fade in).'),
  motionDuration: ms(1200, 'Motion transition', 'Duration of speed/amplitude/pulse changes.'),
  glowDuration: ms(800, 'Glow transition', 'Duration of lighting changes.'),
  generalDuration: ms(600, 'General transition', 'Duration of everything else (appearance, interface, layers).'),
  easing: { group: 'transitions', type: 'enum', default: 'easeInOutCubic', options: Object.keys(EASINGS),
    scope: 'global', label: 'Easing', doc: 'Easing curve used by all transitions.' },

  // ---- System (global) -----------------------------------------------------
  reducedMotion: { group: 'system', type: 'enum', default: 'auto', options: ['auto', 'on', 'off'], scope: 'global',
    label: 'Reduced motion', doc: "'auto' follows the OS prefers-reduced-motion setting." },
  maxFps: num('system', 60, 10, 120, 1, 'Max FPS', 'Frame-rate cap. Lower it (e.g. 30) to save power on a desktop avatar.',
    { scope: 'global' }),
};

/** Which transition-duration parameter governs each group. */
export const DURATION_FOR_GROUP = {
  colors: 'colorDuration',
  appearance: 'generalDuration',
  motion: 'motionDuration',
  lighting: 'glowDuration',
  interface: 'generalDuration',
  layers: 'generalDuration',
};

export const isGlobal = key => PARAMS[key]?.scope === 'global';

export function defaultValues(scope) {
  const out = {};
  for (const [key, p] of Object.entries(PARAMS)) {
    if ((p.scope === 'global') === (scope === 'global')) out[key] = p.default;
  }
  return out;
}

/** Flatten { colors: { primary }, motion: {...} } or a flat object into { primary, ... }. */
export function flattenParams(obj) {
  const flat = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && GROUPS[k]) Object.assign(flat, v);
    else flat[k] = v;
  }
  return flat;
}

/** Group a flat object by schema group: { primary, glowIntensity } -> { colors: {...}, lighting: {...} }. */
export function groupParams(flat) {
  const out = {};
  for (const [k, v] of Object.entries(flat)) {
    const g = PARAMS[k]?.group;
    if (!g) continue;
    (out[g] ||= {})[k] = v;
  }
  return out;
}
