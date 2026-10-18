# AI Assistant Orb

A modular, fully vector avatar for the assistant: a dark translucent core wrapped in
flowing, twisting light ribbons, with two minimal oval eyes.

| File | Purpose |
| --- | --- |
| `orb.svg` | The design asset. Self-contained, no rasters, no external fonts or images. |
| `preview.html` | Inspection page: dark, checkerboard (transparency) and neutral backgrounds at 512 / 256 / 128 / 64 px, with state, symbol, particle and colour controls. |
| `tools/generate_orb.py` | Optional generator for the ribbon geometry (stdlib Python). Re-running it overwrites `orb.svg`. |

Preview locally (fetch needs HTTP, not `file://`):

```sh
cd orb && python3 -m http.server 8000
# open http://localhost:8000/preview.html
```

## Layer structure

`viewBox="-256 -256 512 512"`, so `(0, 0)` is the orb centre and the sphere radius is 168.
The background is transparent. The layers paint from back to front:

| # | Group id | Contents |
| --- | --- | --- |
| 1 | `orb-glow` | Atmospheric halo (radial gradient only, no filter). |
| 2 | `orb-back-ribbons` | 3 rear ribbons (`back-1..3`), lightly blurred and masked dimmer towards the centre so they read as behind the core. |
| 3 | `orb-core` | Dark central volume with a soft fresnel rim, plus `orb-core-inner-light` pooled behind the symbol. |
| 4 | `orb-inner-ribbons` | 2 faint internal reflections (`inner-1..2`), clipped to the sphere. |
| 5 | `orb-main-ribbons` | 3 main translucent ribbons (`main-1..3`). |
| 6 | `orb-highlights` | Specular sheen (top-left) and violet bounce light (bottom-right). |
| 7 | `orb-interface` | Symbol layer with a glow filter: `orb-eyes` (default) and `orb-symbols` (`code`, `wave`, `neural`, `custom` slot). |
| 8 | `orb-foreground-ribbons` | 2 thin bright sweeps (`front-1..2`) that break the silhouette. |
| 9 | `orb-particles` | Six decorative dots, hidden by default. |

Every ribbon is its own group, so you can transform it independently:

```html
<g id="orb-ribbon-main-1" class="orb-ribbon orb-ribbon--main" data-ribbon="main-1">
  <path class="orb-ribbon__body" …/>   <!-- translucent filled band -->
  <path class="orb-ribbon__edge" …/>   <!-- luminous leading edge -->
</g>
```

Each ribbon has its own body and edge gradients (`orb-grad-<name>`, `orb-grad-<name>-edge`).
To rotate one ribbon, add `transform-origin: 0 0` (or `transform-box: view-box`) and rotate
the group.

Filters: there are three, all with small kernels. `orb-filter-soft` blurs the rear ribbons,
`orb-filter-glow` covers the foreground sweeps, and `orb-filter-symbol-glow` combines
`feGaussianBlur`, `feComposite` and `feBlend` for the symbol layer.

## CSS variables

Global palette. The defaults are declared with `:where(svg.orb)`, which has zero specificity,
so any selector you write wins:

| Variable | Default | Controls |
| --- | --- | --- |
| `--orb-primary` | `#2f7dff` | Main ribbon colour, core rim |
| `--orb-secondary` | `#2ee6ff` | Second ribbon colour, rim light, eye edge |
| `--orb-accent` | `#8b6cff` | Violet accents, rear ribbons, bounce light |
| `--orb-highlight` | `#d9fbff` | Ribbon edges, specular sheen, particles |
| `--orb-glow` | `#3aa8ff` | Outer halo and inner light |
| `--orb-core` | `#040815` | Dark central volume |
| `--orb-symbol-color` | `#e6fdff` | Eyes and interface symbols |
| `--orb-opacity` | `1` | Opacity of the whole orb |
| `--orb-glow-strength` | `1` | Opacity of the outer halo |

Per-ribbon variables. These are not declared by default and fall back to the palette:

| Variable | Set on | Controls |
| --- | --- | --- |
| `--orb-ribbon-<name>-a`, `--orb-ribbon-<name>-b` | `svg.orb` | The ribbon's start and end colours (e.g. `--orb-ribbon-main-1-a`) |
| `--rb-opacity` | a ribbon group (or a layer) | Ribbon opacity |
| `--rb-width` | a ribbon group (or a layer) | Extra thickness: strokes the band with its own gradient (default `0`) |
| `--rb-edge-width` | a ribbon group (or a layer) | Width of the luminous edge (default `1.3`) |

Built-in states via `data-state` on the `<svg>`: `idle` (blue/cyan), `listening` (green),
`processing` (magenta), `memory` (gold). They all use the same geometry and differ only
in variables.

## Changing colours

```css
/* Recolour the default orb */
svg.orb {
  --orb-primary: #6a5cff;
  --orb-secondary: #00e0ff;
  --orb-glow: #5b8cff;
}

/* Tune one ribbon */
svg.orb { --orb-ribbon-front-1-b: #ffffff; }
#orb-ribbon-main-2 { --rb-opacity: 0.6; --rb-width: 4; }
```

```js
const orb = document.querySelector('svg.orb');
orb.dataset.state = 'listening';                 // switch palette
orb.style.setProperty('--orb-primary', '#ff4d6d'); // or set any variable directly
```

Custom properties cascade only into inline SVG (or SVG in an `<object>`/`<iframe>` you style
from inside). An SVG loaded with `<img>` or as a CSS background still renders correctly,
but it always uses the built-in default palette.

## Replacing the eyes with another symbol

The visible symbol is chosen by `data-symbol` on the `<svg>`:

```js
orb.dataset.symbol = 'code';   // 'eyes' | 'code' | 'wave' | 'neural' | 'custom'
```

To use your own icon, draw it in a box of about 90 × 90 centred on `0, 0` and put it in the
`custom` slot:

```js
orb.querySelector('#orb-symbol-custom').innerHTML =
  '<path d="M0 -38L10 -10L38 0L10 10L0 38L-10 10L-38 0L-10 -10Z" fill="var(--orb-symbol-color)"/>';
orb.dataset.symbol = 'custom';
```

To add a permanent symbol, add a `<symbol id="orb-sym-xyz" viewBox="-60 -60 120 120">` to
`<defs>`. Then add a `<use class="orb-symbol" data-symbol="xyz" href="#orb-sym-xyz" …>` inside
`orb-symbols`, and add `xyz` to the visibility selector list in the `<style>` block. The
classes `orb-line` (stroked) and `orb-dot` (filled) give a symbol the shared symbol colour.

The eyes are plain ellipses (`.orb-eye--left`, `.orb-eye--right`). You can animate
`transform: scaleY()` on them for blinking, with `transform-box: fill-box` and
`transform-origin: center`.

## Embedding notes

- Inline the SVG markup for full CSS/JS control. The internal `<style>` uses classes only,
  so host styles can target any layer.
- **One orb per document, or uniquify IDs.** Gradient, mask and filter references are
  document-global, so a second inlined copy would paint with the first copy's gradients.
  `preview.html` shows a small `uniquify()` helper that suffixes every id.
- `data-particles="on"` shows the particle layer.
