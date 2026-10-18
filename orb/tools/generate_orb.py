#!/usr/bin/env python3
"""Generate ../orb.svg.

The ribbon paths are computed by projecting twisting 3D bands that wrap a
sphere, then smoothing the sampled edges into cubic Beziers. Everything else
(palette, gradients, filters, symbols) is emitted as plain SVG/CSS.

orb.svg is the design asset and can be hand-edited; re-running this script
overwrites it. Tweak the RIBBONS table below to reshape the ribbons.

Usage: python3 orb/tools/generate_orb.py
"""

import math
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "orb.svg"

R = 168  # sphere radius in user units (viewBox is -256..256)

# name, layer, tilt (deg, about X), roll (deg, about Z), depth side,
# arc span (deg), arc offset (deg), radius scale, half-width, twist turns,
# twist phase (deg), wobble, colour roles (a, b), body opacity, edge opacity
RIBBONS = [
    # Rear structures: dimmer, violet-leaning, softened by a light blur.
    dict(name="back-1", layer="back", tilt=42, roll=-40, side="back", span=240, offset=10,
         rs=1.06, w=0.30, twist=1.1, phase=0, wob=0.05, a="accent", b="primary", body=0.55, edge=0.6),
    dict(name="back-2", layer="back", tilt=46, roll=40, side="back", span=220, offset=-20,
         rs=1.04, w=0.24, twist=0.7, phase=60, wob=0.06, a="primary", b="secondary", body=0.5, edge=0.55),
    dict(name="back-3", layer="back", tilt=30, roll=96, side="back", span=210, offset=0,
         rs=1.08, w=0.18, twist=1.3, phase=30, wob=0.05, a="secondary", b="accent", body=0.45, edge=0.5),

    # Main translucent shell: wide twisting bands sweeping across the face.
    dict(name="main-1", layer="main", tilt=54, roll=-16, side="front", span=220, offset=-6,
         rs=1.05, w=0.26, twist=1.5, phase=35, wob=0.06, a="primary", b="secondary", body=0.40, edge=0.95),
    dict(name="main-2", layer="main", tilt=52, roll=152, side="front", span=210, offset=10,
         rs=1.05, w=0.25, twist=0.85, phase=-50, wob=0.06, a="secondary", b="accent", body=0.34, edge=0.85),
    dict(name="main-3", layer="main", tilt=40, roll=78, side="front", span=200, offset=-10,
         rs=1.03, w=0.22, twist=1.4, phase=80, wob=0.05, a="accent", b="primary", body=0.30, edge=0.75),

    # Secondary flowing ribbons / internal reflections (smaller radius, faint).
    dict(name="inner-1", layer="inner", tilt=55, roll=-62, side="front", span=180, offset=0,
         rs=0.84, w=0.14, twist=0.9, phase=0, wob=0.06, a="secondary", b="primary", body=0.22, edge=0.5),
    dict(name="inner-2", layer="inner", tilt=60, roll=120, side="front", span=170, offset=10,
         rs=0.80, w=0.12, twist=0.6, phase=45, wob=0.06, a="primary", b="accent", body=0.2, edge=0.45),

    # Foreground sweeps: thin, bright, partly breaking the silhouette.
    dict(name="front-1", layer="front", tilt=60, roll=-24, side="front", span=150, offset=-20,
         rs=1.12, w=0.09, twist=0.6, phase=0, wob=0.04, a="secondary", b="highlight", body=0.6, edge=1.0),
    dict(name="front-2", layer="front", tilt=62, roll=165, side="front", span=120, offset=20,
         rs=1.10, w=0.07, twist=0.5, phase=90, wob=0.04, a="accent", b="secondary", body=0.5, edge=0.9),
]

ROLE_VAR = {
    "primary": "--orb-primary",
    "secondary": "--orb-secondary",
    "accent": "--orb-accent",
    "highlight": "--orb-highlight",
}

SAMPLES = 22


# ---------------------------------------------------------------- geometry

def rot_x(p, a):
    x, y, z = p
    c, s = math.cos(a), math.sin(a)
    return (x, y * c - z * s, y * s + z * c)


def rot_z(p, a):
    x, y, z = p
    c, s = math.cos(a), math.sin(a)
    return (x * c - y * s, x * s + y * c, z)


def frame(tilt, roll):
    """Orthonormal basis (u, v, n) of the great circle."""
    def tf(p):
        return rot_z(rot_x(p, math.radians(tilt)), math.radians(roll))
    return tf((1, 0, 0)), tf((0, 0, 1)), tf((0, 1, 0))


def ribbon_points(rb):
    u, v, n = frame(rb["tilt"], rb["roll"])

    def centre(t):
        return tuple(u[i] * math.cos(t) + v[i] * math.sin(t) for i in range(3))

    # Arc centred on the point of max (front) or min (back) depth.
    # z(t) = u.z cos t + v.z sin t  ->  extremum at atan2(v.z, u.z)
    t_front = math.atan2(v[2], u[2])
    t_mid = t_front if rb["side"] == "front" else t_front + math.pi
    t_mid += math.radians(rb["offset"])
    half = math.radians(rb["span"]) / 2

    plus, minus, mid = [], [], []
    for i in range(SAMPLES + 1):
        s = i / SAMPLES
        t = t_mid - half + 2 * half * s
        c = centre(t)
        rad = R * rb["rs"] * (1 + rb["wob"] * math.sin(2 * t + math.radians(rb["phase"])))
        env = math.sin(math.pi * s) ** 0.85
        h = R * rb["w"] * env
        # Twist the band between the sphere tangent plane (n) and radial
        # direction, so its projected width breathes along the arc.
        phi = math.pi * rb["twist"] * s + math.radians(rb["phase"])
        d = tuple(math.cos(phi) * n[k] + 0.55 * math.sin(phi) * c[k] for k in range(3))
        p0 = tuple(c[k] * rad for k in range(3))
        plus.append((p0[0] + h * d[0], p0[1] + h * d[1]))
        minus.append((p0[0] - h * d[0], p0[1] - h * d[1]))
        mid.append(p0)
    return plus, minus, mid


def fmt(v):
    s = f"{v:.1f}"
    return "0" if s in ("0.0", "-0.0") else s.rstrip("0").rstrip(".") if "." in s else s


def pt(p):
    return f"{fmt(p[0])} {fmt(p[1])}"


def bezier_segments(pts):
    """Catmull-Rom through pts -> list of (c1, c2, p) cubic segments."""
    segs = []
    n = len(pts)
    for i in range(n - 1):
        p0 = pts[max(i - 1, 0)]
        p1 = pts[i]
        p2 = pts[i + 1]
        p3 = pts[min(i + 2, n - 1)]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        segs.append((c1, c2, p2))
    return segs


def open_path(pts):
    d = [f"M{pt(pts[0])}"]
    d += [f"C{pt(a)} {pt(b)} {pt(c)}" for a, b, c in bezier_segments(pts)]
    return "".join(d)


def band_path(plus, minus):
    d = [f"M{pt(plus[0])}"]
    d += [f"C{pt(a)} {pt(b)} {pt(c)}" for a, b, c in bezier_segments(plus)]
    back = list(reversed(minus))
    d += [f"C{pt(a)} {pt(b)} {pt(c)}" for a, b, c in bezier_segments(back)]
    d.append("Z")
    return "".join(d)


# ---------------------------------------------------------------- markup

def stop(offset, var, fallback_role=None, opacity=None):
    colour = f"var({var}, var({ROLE_VAR[fallback_role]}))" if fallback_role else f"var({var})"
    op = f' stop-opacity="{opacity}"' if opacity is not None else ""
    return f'<stop offset="{offset}" style="stop-color:{colour}"{op}/>'


def ribbon_defs(rb, mid):
    name = rb["name"]
    (x1, y1), (x2, y2) = mid[0][:2], mid[-1][:2]
    if math.hypot(x2 - x1, y2 - y1) < R * 0.6:
        # Arc nearly closes on itself: run the gradient start -> apex instead.
        x2, y2 = mid[len(mid) // 2][:2]
    coords = f'x1="{fmt(x1)}" y1="{fmt(y1)}" x2="{fmt(x2)}" y2="{fmt(y2)}"'
    va, vb = f"--orb-ribbon-{name}-a", f"--orb-ribbon-{name}-b"
    body = (
        f'<linearGradient id="orb-grad-{name}" gradientUnits="userSpaceOnUse" {coords}>'
        + stop(0, va, rb["a"], 0)
        + stop(0.22, va, rb["a"], 0.85)
        + stop(0.55, vb, rb["b"], 1)
        + stop(0.82, vb, rb["b"], 0.7)
        + stop(1, vb, rb["b"], 0)
        + "</linearGradient>"
    )
    edge = (
        f'<linearGradient id="orb-grad-{name}-edge" gradientUnits="userSpaceOnUse" {coords}>'
        + stop(0, va, rb["a"], 0)
        + stop(0.35, "--orb-highlight", None, 1)
        + stop(0.7, vb, rb["b"], 0.9)
        + stop(1, vb, rb["b"], 0)
        + "</linearGradient>"
    )
    return body, edge


def ribbon_group(rb, plus, minus, indent):
    name = rb["name"]
    return (
        f'{indent}<g id="orb-ribbon-{name}" class="orb-ribbon orb-ribbon--{rb["layer"]}" data-ribbon="{name}">\n'
        f'{indent}  <path class="orb-ribbon__body" fill="url(#orb-grad-{name})" stroke="url(#orb-grad-{name})" '
        f'fill-opacity="{rb["body"]}" d="{band_path(plus, minus)}"/>\n'
        f'{indent}  <path class="orb-ribbon__edge" stroke="url(#orb-grad-{name}-edge)" '
        f'stroke-opacity="{rb["edge"]}" d="{open_path(plus)}"/>\n'
        f'{indent}</g>'
    )


STYLE = """
    /* ---- Palette (zero specificity: any host selector overrides it) ---- */
    :where(svg.orb) {
      --orb-primary: #2f7dff;
      --orb-secondary: #2ee6ff;
      --orb-accent: #8b6cff;
      --orb-highlight: #d9fbff;
      --orb-glow: #3aa8ff;
      --orb-core: #040815;
      --orb-symbol-color: #e6fdff;
      --orb-opacity: 1;
      --orb-glow-strength: 1;
    }
    :where(svg.orb[data-state="listening"]) {
      --orb-primary: #13c26b;
      --orb-secondary: #5dffb0;
      --orb-accent: #1ed0c4;
      --orb-highlight: #e4ffef;
      --orb-glow: #2ee88a;
      --orb-core: #03100a;
      --orb-symbol-color: #eafff3;
    }
    :where(svg.orb[data-state="processing"]) {
      --orb-primary: #ff2f7a;
      --orb-secondary: #ff6bd5;
      --orb-accent: #a14bff;
      --orb-highlight: #ffe3f3;
      --orb-glow: #ff3d8b;
      --orb-core: #12030b;
      --orb-symbol-color: #fff0f8;
    }
    :where(svg.orb[data-state="memory"]) {
      --orb-primary: #ffb21e;
      --orb-secondary: #ffe066;
      --orb-accent: #ff7a3d;
      --orb-highlight: #fff6d6;
      --orb-glow: #ffc23a;
      --orb-core: #110b02;
      --orb-symbol-color: #fff9e6;
    }

    .orb-root { opacity: var(--orb-opacity); }
    .orb-glow-halo { opacity: var(--orb-glow-strength); }

    /* ---- Ribbons: per-ribbon knobs are inherited custom properties ---- */
    .orb-ribbon { opacity: var(--rb-opacity, 1); }
    .orb-ribbon__body {
      stroke-width: var(--rb-width, 0);
      stroke-linejoin: round;
    }
    .orb-ribbon__edge {
      fill: none;
      stroke-width: var(--rb-edge-width, 1.3);
      stroke-linecap: round;
    }
    .orb-ribbon--back { --rb-edge-width: 1; }
    .orb-ribbon--front { --rb-edge-width: 1.6; }

    /* ---- Interface layer: exactly one symbol visible, chosen by data-symbol ---- */
    .orb-symbol { display: none; }
    svg.orb:not([data-symbol]) .orb-symbol[data-symbol="eyes"],
    svg.orb[data-symbol="eyes"] .orb-symbol[data-symbol="eyes"],
    svg.orb[data-symbol="code"] .orb-symbol[data-symbol="code"],
    svg.orb[data-symbol="wave"] .orb-symbol[data-symbol="wave"],
    svg.orb[data-symbol="neural"] .orb-symbol[data-symbol="neural"],
    svg.orb[data-symbol="custom"] .orb-symbol[data-symbol="custom"] { display: inline; }

    .orb-eye { fill: url(#orb-grad-eye); }
    .orb-line {
      fill: none;
      stroke: var(--orb-symbol-color);
      stroke-width: 7;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .orb-dot { fill: var(--orb-symbol-color); }

    /* ---- Particles: off by default ---- */
    .orb-particles { display: none; }
    svg.orb[data-particles="on"] .orb-particles { display: inline; }
    .orb-particles circle { fill: var(--orb-highlight); }
"""


def build():
    geo = {rb["name"]: ribbon_points(rb) for rb in RIBBONS}

    grads = []
    for rb in RIBBONS:
        body, edge = ribbon_defs(rb, geo[rb["name"]][2])
        grads.append("      " + body)
        grads.append("      " + edge)

    def layer(name):
        return "\n".join(
            ribbon_group(rb, geo[rb["name"]][0], geo[rb["name"]][1], "      ")
            for rb in RIBBONS if rb["layer"] == name
        )

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     class="orb" viewBox="-256 -256 512 512" width="512" height="512"
     data-state="idle" data-symbol="eyes" data-particles="off"
     role="img" aria-labelledby="orb-title">
  <title id="orb-title">AI assistant orb</title>
  <!-- Generated by orb/tools/generate_orb.py — safe to hand-edit. Origin (0,0) is the orb centre. -->
  <style>{STYLE}  </style>

  <defs>
    <!-- ===== Atmosphere, core and lighting ===== -->
    <radialGradient id="orb-grad-halo" cx="0" cy="0" r="256" gradientUnits="userSpaceOnUse">
      <stop offset="0.45" style="stop-color:var(--orb-glow)" stop-opacity="0.42"/>
      <stop offset="0.62" style="stop-color:var(--orb-glow)" stop-opacity="0.22"/>
      <stop offset="0.80" style="stop-color:var(--orb-accent)" stop-opacity="0.07"/>
      <stop offset="1" style="stop-color:var(--orb-glow)" stop-opacity="0"/>
    </radialGradient>

    <radialGradient id="orb-grad-core" cx="0" cy="0" r="{R}" gradientUnits="userSpaceOnUse">
      <stop offset="0" style="stop-color:var(--orb-core)" stop-opacity="0.97"/>
      <stop offset="0.45" style="stop-color:var(--orb-core)" stop-opacity="0.9"/>
      <stop offset="0.80" style="stop-color:var(--orb-core)" stop-opacity="0.55"/>
      <stop offset="0.96" style="stop-color:var(--orb-primary)" stop-opacity="0.22"/>
      <stop offset="1" style="stop-color:var(--orb-secondary)" stop-opacity="0"/>
    </radialGradient>

    <!-- Soft light pooled behind the interface symbol -->
    <radialGradient id="orb-grad-inner-light" cx="0" cy="-6" r="96" gradientUnits="userSpaceOnUse">
      <stop offset="0" style="stop-color:var(--orb-glow)" stop-opacity="0.30"/>
      <stop offset="0.6" style="stop-color:var(--orb-primary)" stop-opacity="0.10"/>
      <stop offset="1" style="stop-color:var(--orb-primary)" stop-opacity="0"/>
    </radialGradient>

    <linearGradient id="orb-grad-specular" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:var(--orb-highlight)" stop-opacity="0.55"/>
      <stop offset="1" style="stop-color:var(--orb-highlight)" stop-opacity="0"/>
    </linearGradient>

    <radialGradient id="orb-grad-bounce" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" style="stop-color:var(--orb-accent)" stop-opacity="0.45"/>
      <stop offset="1" style="stop-color:var(--orb-accent)" stop-opacity="0"/>
    </radialGradient>

    <radialGradient id="orb-grad-eye" cx="0.5" cy="0.42" r="0.6">
      <stop offset="0" style="stop-color:#fff"/>
      <stop offset="0.45" style="stop-color:var(--orb-symbol-color)"/>
      <stop offset="1" style="stop-color:var(--orb-secondary)"/>
    </radialGradient>

    <!-- ===== Ribbon gradients (one body + one edge gradient per ribbon) ===== -->
{chr(10).join(grads)}

    <!-- ===== Clipping and masks ===== -->
    <clipPath id="orb-clip-sphere">
      <circle r="{R + 2}"/>
    </clipPath>

    <!-- Fades rear ribbons where the dark core sits in front of them -->
    <mask id="orb-mask-behind-core" maskUnits="userSpaceOnUse" x="-256" y="-256" width="512" height="512">
      <rect x="-256" y="-256" width="512" height="512" fill="url(#orb-grad-mask-behind)"/>
    </mask>
    <radialGradient id="orb-grad-mask-behind" cx="0" cy="0" r="{R + 10}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff" stop-opacity="0.25"/>
      <stop offset="0.7" stop-color="#fff" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#fff" stop-opacity="1"/>
    </radialGradient>

    <!-- ===== Filters (kept to three, all small kernels) ===== -->
    <filter id="orb-filter-soft" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="1.6"/>
    </filter>

    <filter id="orb-filter-glow" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="blur"/>
      <feBlend in="SourceGraphic" in2="blur" mode="screen"/>
    </filter>

    <filter id="orb-filter-symbol-glow" x="-80%" y="-80%" width="260%" height="260%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="wide"/>
      <feComposite in="wide" in2="wide" operator="arithmetic" k1="0" k2="1.5" k3="0" k4="0" result="wideBoost"/>
      <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="tight"/>
      <feBlend in="tight" in2="wideBoost" mode="screen" result="halo"/>
      <feComposite in="SourceGraphic" in2="halo" operator="over"/>
    </filter>

    <!-- ===== Replaceable interface symbols (drawn in a 120 x 120 box centred on 0,0) ===== -->
    <symbol id="orb-sym-code" viewBox="-60 -60 120 120" overflow="visible">
      <path class="orb-line" d="M-26 -24L-48 0L-26 24M26 -24L48 0L26 24M9 -32L-9 32"/>
    </symbol>

    <symbol id="orb-sym-wave" viewBox="-60 -60 120 120" overflow="visible">
      <path class="orb-line" d="M-44 -8V8M-26 -22V22M-8 -34V34M10 -18V18M28 -28V28M46 -10V10"/>
    </symbol>

    <symbol id="orb-sym-neural" viewBox="-60 -60 120 120" overflow="visible">
      <path class="orb-line" style="stroke-width:3.5;opacity:.75"
            d="M-36 -22L0 -34L36 -22M-36 -22L0 0L36 -22M-36 22L0 0L36 22M-36 22L0 34L36 22M-36 -22V22M36 -22V22M0 -34V34"/>
      <circle class="orb-dot" cx="-36" cy="-22" r="7"/>
      <circle class="orb-dot" cx="36" cy="-22" r="7"/>
      <circle class="orb-dot" cx="-36" cy="22" r="7"/>
      <circle class="orb-dot" cx="36" cy="22" r="7"/>
      <circle class="orb-dot" cx="0" cy="-34" r="6"/>
      <circle class="orb-dot" cx="0" cy="34" r="6"/>
      <circle class="orb-dot" cx="0" cy="0" r="9"/>
    </symbol>
  </defs>

  <g id="orb-root" class="orb-root">
    <!-- 1. Outer atmospheric glow (gradient only — no filter cost) -->
    <g id="orb-glow" class="orb-glow">
      <circle class="orb-glow-halo" r="256" fill="url(#orb-grad-halo)"/>
    </g>

    <!-- 2. Rear ribbons: behind the core, softened and faded towards the centre -->
    <g id="orb-back-ribbons" class="orb-layer orb-back-ribbons" filter="url(#orb-filter-soft)" mask="url(#orb-mask-behind-core)">
{layer("back")}
    </g>

    <!-- 3. Dark central volume with fresnel-style rim -->
    <g id="orb-core" class="orb-layer orb-core">
      <circle class="orb-core-volume" r="{R}" fill="url(#orb-grad-core)"/>
      <circle class="orb-core-inner-light" r="96" cy="-6" fill="url(#orb-grad-inner-light)"/>
    </g>

    <!-- 4. Secondary flowing ribbons / internal reflections -->
    <g id="orb-inner-ribbons" class="orb-layer orb-inner-ribbons" clip-path="url(#orb-clip-sphere)">
{layer("inner")}
    </g>

    <!-- 5. Main translucent ribbon shell -->
    <g id="orb-main-ribbons" class="orb-layer orb-main-ribbons">
{layer("main")}
    </g>

    <!-- 6. Highlights: specular sheen and violet bounce light -->
    <g id="orb-highlights" class="orb-layer orb-highlights" clip-path="url(#orb-clip-sphere)">
      <path class="orb-specular" fill="url(#orb-grad-specular)"
            d="M-118 -96C-92 -140 -40 -160 14 -158C-34 -146 -78 -122 -104 -84C-110 -76 -122 -84 -118 -96Z"/>
      <ellipse class="orb-bounce" cx="70" cy="122" rx="80" ry="34" transform="rotate(-28 70 122)" fill="url(#orb-grad-bounce)"/>
    </g>

    <!-- 7. Interface layer: eyes by default, alternative symbols switch via data-symbol -->
    <g id="orb-interface" class="orb-layer orb-interface" filter="url(#orb-filter-symbol-glow)">
      <g id="orb-eyes" class="orb-symbol orb-eyes" data-symbol="eyes">
        <ellipse class="orb-eye orb-eye--left" cx="-27" cy="-4" rx="10.5" ry="21"/>
        <ellipse class="orb-eye orb-eye--right" cx="27" cy="-4" rx="10.5" ry="21"/>
      </g>
      <g id="orb-symbols" class="orb-symbols">
        <use class="orb-symbol" data-symbol="code" href="#orb-sym-code" xlink:href="#orb-sym-code" x="-46" y="-46" width="92" height="92"/>
        <use class="orb-symbol" data-symbol="wave" href="#orb-sym-wave" xlink:href="#orb-sym-wave" x="-46" y="-46" width="92" height="92"/>
        <use class="orb-symbol" data-symbol="neural" href="#orb-sym-neural" xlink:href="#orb-sym-neural" x="-46" y="-46" width="92" height="92"/>
        <!-- Slot for custom icons injected at runtime (draw in a ~90 x 90 box centred on 0,0) -->
        <g id="orb-symbol-custom" class="orb-symbol" data-symbol="custom"></g>
      </g>
    </g>

    <!-- 8. Foreground ribbons: thin bright sweeps over everything -->
    <g id="orb-foreground-ribbons" class="orb-layer orb-foreground-ribbons" filter="url(#orb-filter-glow)">
{layer("front")}
    </g>

    <!-- 9. Optional particles (hidden unless data-particles="on") -->
    <g id="orb-particles" class="orb-layer orb-particles">
      <circle cx="-150" cy="-118" r="2.2" opacity="0.8"/>
      <circle cx="176" cy="-40" r="1.6" opacity="0.6"/>
      <circle cx="132" cy="140" r="2" opacity="0.7"/>
      <circle cx="-182" cy="70" r="1.4" opacity="0.5"/>
      <circle cx="40" cy="-196" r="1.8" opacity="0.6"/>
      <circle cx="-60" cy="190" r="1.5" opacity="0.5"/>
    </g>
  </g>
</svg>
'''
    OUT.write_text(svg, encoding="utf-8")
    print(f"wrote {OUT} ({len(svg)} bytes)")


if __name__ == "__main__":
    build()
