// Colour parsing and perceptual (OKLab) interpolation for palette transitions.

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+[\d.]+%?)?\s*\)$/i;

/** Parse "#rgb", "#rrggbb" (alpha ignored) or "rgb(r, g, b)" into [r, g, b] 0..255, or null. */
export function parseColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  let m = HEX.exec(v);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map(c => c + c).join('');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }
  m = RGB.exec(v);
  if (m) {
    const c = m.slice(1, 4).map(Number);
    if (c.every(x => x >= 0 && x <= 255)) return c;
  }
  return null;
}

/** Normalise any accepted colour string to lowercase "#rrggbb", or null. */
export function normalizeColor(value) {
  const rgb = parseColor(value);
  return rgb ? toHex(rgb) : null;
}

export function toHex(rgb) {
  return '#' + rgb.map(c => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, '0')).join('');
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const toLinear = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklab([r, g, b]) {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

export function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ].map(c => clamp(c, 0, 255));
}

export function lerpLab(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
