// Symbol registry: built-in symbols (drawn in assets/orb.svg) plus custom SVG symbols
// registered at runtime. Custom markup is sanitised by rebuilding it from an allowlist,
// so scripts, event handlers, links and external references never reach the document.

const SVG_NS = 'http://www.w3.org/2000/svg';

export const DEFAULT_SYMBOL_OPTIONS = { scale: 1, x: 0, y: 0, color: null, opacity: 1 };

// Built-ins live in the SVG asset as `.orb-symbol[data-symbol="<name>"]` groups.
export const BUILTIN_SYMBOLS = {
  eyes: { label: 'Eyes' },
  code: { label: 'Code </>' },
  soundwave: { label: 'Sound wave' },
  brain: { label: 'Brain' },
  network: { label: 'Neural network' },
};

export const SYMBOL_ALIASES = { wave: 'soundwave', neural: 'network', 'neural-network': 'network' };

const ALLOWED_ELEMENTS = new Set(['g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);
const ALLOWED_ATTRS = new Set([
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2', 'points',
  'transform', 'fill', 'fill-rule', 'clip-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit',
  'opacity', 'vector-effect', 'class',
]);
// Classes that hook into orb styling/animation: stroked line, filled dot, equaliser bar, pulsing node.
const ALLOWED_CLASSES = new Set(['orb-line', 'orb-dot', 'orb-bar', 'orb-node']);
const UNSAFE_VALUE = /url\s*\(|javascript:|data:|expression\s*\(|[<>]/i;
const NAME = /^[a-z][a-z0-9_-]{0,39}$/i;
const VIEWBOX = /^\s*-?[\d.]+(\s*[ ,]\s*-?[\d.]+){3}\s*$/;
const MAX_NODES = 400;

/**
 * Parse SVG markup (a full <svg> or bare shapes) and rebuild it from the allowlist.
 * Returns { viewBox, nodes: Element[] } with freshly created elements, or throws.
 */
export function sanitizeSvgMarkup(markup, doc = document) {
  if (typeof markup !== 'string' || !markup.trim()) throw new Error('Symbol markup must be a non-empty string');
  const src = /^\s*<svg[\s>]/i.test(markup) ? markup : `<svg xmlns="${SVG_NS}">${markup}</svg>`;
  const parsed = new DOMParser().parseFromString(
    src.replace(/^\s*<svg(?![^>]*\sxmlns=)/i, `<svg xmlns="${SVG_NS}"`), 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.nodeName === 'parsererror' || parsed.getElementsByTagName('parsererror').length) {
    throw new Error('Symbol markup is not well-formed SVG');
  }

  let count = 0;
  const copy = (src) => {
    const tag = src.localName;
    if (src.namespaceURI !== SVG_NS || !ALLOWED_ELEMENTS.has(tag)) return null; // drops script, foreignObject, use, image, a, style…
    if (++count > MAX_NODES) throw new Error(`Symbol has more than ${MAX_NODES} elements`);
    const el = doc.createElementNS(SVG_NS, tag);
    for (const { name, value } of [...src.attributes]) {
      const n = name.toLowerCase();
      if (!ALLOWED_ATTRS.has(n) || UNSAFE_VALUE.test(value)) continue; // drops on*, href, style, id…
      if (n === 'class') {
        const cls = value.split(/\s+/).filter(c => ALLOWED_CLASSES.has(c)).join(' ');
        if (cls) el.setAttribute('class', cls);
      } else {
        el.setAttribute(n, value);
      }
    }
    for (const child of src.children) {
      const c = copy(child);
      if (c) el.appendChild(c);
    }
    return el;
  };

  const nodes = [...root.children].map(copy).filter(Boolean);
  if (!nodes.length) throw new Error('Symbol markup contains no supported shapes');
  const vb = root.getAttribute('viewBox');
  return { viewBox: vb && VIEWBOX.test(vb) ? vb.trim() : null, nodes };
}

export class SymbolRegistry {
  constructor() {
    this.symbols = new Map();
    for (const [name, meta] of Object.entries(BUILTIN_SYMBOLS)) {
      this.symbols.set(name, { name, builtin: true, label: meta.label, options: { ...DEFAULT_SYMBOL_OPTIONS } });
    }
  }

  /** Canonical name for a symbol name or alias, or null if unknown. */
  resolve(name) {
    if (typeof name !== 'string') return null;
    const n = SYMBOL_ALIASES[name] || name;
    return this.symbols.has(n) ? n : null;
  }

  get(name) { return this.symbols.get(this.resolve(name)); }

  list() {
    return [...this.symbols.values()].map(s => ({ name: s.name, label: s.label, builtin: s.builtin }));
  }

  /**
   * Register (or replace) a custom symbol.
   * options: { label, viewBox = '-60 -60 120 120', scale, x, y, color, opacity }
   * Draw in the viewBox; it is fitted into the same ~92 x 92 box as the built-ins.
   */
  register(name, markup, options = {}) {
    if (!NAME.test(name || '')) throw new Error(`Invalid symbol name "${name}" (letters, digits, - and _, max 40)`);
    if (this.symbols.get(name)?.builtin) throw new Error(`"${name}" is a built-in symbol and cannot be replaced`);
    const { viewBox, nodes } = sanitizeSvgMarkup(markup);
    const vb = options.viewBox && VIEWBOX.test(options.viewBox) ? options.viewBox : viewBox || '-60 -60 120 120';
    const entry = {
      name, builtin: false, label: options.label || name, viewBox: vb, nodes, markup,
      options: { ...DEFAULT_SYMBOL_OPTIONS, ...pickOptions(options) },
    };
    this.symbols.set(name, entry);
    return entry;
  }

  unregister(name) {
    const s = this.symbols.get(name);
    if (!s || s.builtin) return false;
    return this.symbols.delete(name);
  }

  configure(name, options) {
    const s = this.get(name);
    if (!s) return null;
    Object.assign(s.options, pickOptions(options));
    return s;
  }
}

function pickOptions(o = {}) {
  const out = {};
  const num = (k, lo, hi) => { if (Number.isFinite(o[k])) out[k] = Math.min(hi, Math.max(lo, o[k])); };
  num('scale', 0.1, 4); num('x', -1, 1); num('y', -1, 1); num('opacity', 0, 1);
  if (o.color === null || typeof o.color === 'string') out.color = o.color;
  return out;
}

/** Build the DOM group for a registered custom symbol. */
export function buildSymbolGroup(entry, doc = document) {
  const g = doc.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'orb-symbol orb-symbol--custom');
  g.setAttribute('data-symbol', entry.name);
  const art = doc.createElementNS(SVG_NS, 'g');
  art.setAttribute('class', 'orb-symbol__art');
  const svg = doc.createElementNS(SVG_NS, 'svg');
  // fill="currentColor": unstyled shapes take the symbol colour instead of black.
  for (const [k, v] of Object.entries({ x: -46, y: -46, width: 92, height: 92, viewBox: entry.viewBox, overflow: 'visible', fill: 'currentColor' })) {
    svg.setAttribute(k, v);
  }
  // Fresh copies each time so the registry entry can be mounted into several orbs.
  for (const n of entry.nodes) svg.appendChild(n.cloneNode(true));
  art.appendChild(svg);
  g.appendChild(art);
  return g;
}
