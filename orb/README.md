# AI Assistant Orb

This is a programmable, animated SVG avatar for a personal AI assistant. It is a dark
translucent core wrapped in flowing light ribbons, with minimal eyes or a replaceable symbol
in the centre. A small JavaScript engine animates it and moves it smoothly between states:
**idle**, **listening**, **processing** and **memory**. It is ready to embed in a frameless,
transparent desktop window.

It has no dependencies: plain SVG, CSS and ES modules, with no build step and no external
services.

## Run it locally

ES modules and `fetch()` don't work from `file://`, so serve the folder:

```sh
cd orb
node tools/serve.mjs            # zero-dependency server → http://localhost:8080/
# or: python3 -m http.server 8080
```

| Page | What it is |
| --- | --- |
| `index.html` | **Orb Studio**: the preview and development control panel |
| `avatar.html` | The bare avatar: transparent page, no UI, fills the window (`?state=listening&symbol=code&fps=30&demo=1`) |
| `examples/api-demo.html` | A scripted walkthrough of the public API, with each call and its return value shown |

To run the browser acceptance tests (needs Playwright with Chromium):
`node tests/acceptance.mjs`.

## Project structure

```
orb/
├── assets/orb.svg           Visual layer: geometry, gradients, filters, built-in symbols
├── src/
│   ├── orb-engine.js        Animation engine + public API (OrbEngine)
│   ├── orb-params.js        Parameter schema: types, ranges, defaults, docs
│   ├── orb-states.js        State presets (idle / listening / processing / memory)
│   ├── orb-symbols.js       Symbol registry + SVG sanitiser
│   ├── orb-color.js         Colour parsing + OKLab interpolation
│   ├── orb-config-version.js
│   ├── orb.css              Host styles + CSS-only fallback motion
│   ├── orb-controls.js      Dev control panel (generated from the schema)
│   └── orb-controls.css     Dev page styles (not used by the avatar)
├── config/default-presets.json   Sample config = exported default presets
├── index.html · avatar.html · examples/api-demo.html
├── tests/acceptance.mjs     Browser tests for the acceptance criteria
└── tools/
    ├── serve.mjs            Static server
    ├── generate_orb.py      Regenerates assets/orb.svg (ribbon geometry)
    ├── export-presets.mjs   Regenerates config/default-presets.json
    └── param-table.mjs      Prints the parameter reference below
```

**How the parts are separated:**
- **The SVG** contains only the visuals.
- **The engine** never hard-codes how a state looks. It reads a parameter set (schema plus
  presets) and maps it onto the SVG.
- **The panel** builds its controls from the schema and talks to the orb only through the
  public API.

You can redesign the SVG without touching the engine, as long as it keeps the class hooks
listed in "SVG layers".

## Embedding

```html
<link rel="stylesheet" href="src/orb.css">
<div id="avatar" style="width: 256px"></div>
<script type="module">
  import { OrbEngine } from './src/orb-engine.js';
  const orb = await OrbEngine.mount(document.getElementById('avatar'), { src: 'assets/orb.svg' });
  orb.setState('listening');
</script>
```

`OrbEngine.mount(container, options)` fetches and inlines the SVG. It makes every id unique,
so several orbs can share a page, and returns the engine.

If the SVG is already inline (for example in Electron, loaded with `fs`), use
`new OrbEngine(svgElement, options)`, or pass `svgText` to `mount`.

Options:

| Option | Default | Effect |
| --- | --- | --- |
| `src` / `svgText` | `'assets/orb.svg'` | Where the SVG comes from |
| `state` | `'idle'` | Initial state |
| `config` | none | Configuration to load at start (same shape as `exportConfig()`) |
| `presets` | none | Extra or overriding state presets (partial objects) |
| `autoplay` | `true` | `false` starts paused |
| `pauseWhenHidden` | `true` | Stop rendering while the page is hidden or the orb is scrolled out of view |
| `inactiveFps` | `null` | Frame-rate cap while the window is unfocused (e.g. `30`) |

The SVG has no fixed size and fills its host. Size the host with `width` or `--orb-size`.

## Public API

```js
orb.setState('listening')                 // 'idle' | 'listening' | 'processing' | 'memory' | registered
orb.setParameter('glowIntensity', 0.8)
orb.setParameter('animationSpeed', 1.4)
orb.setParameters({ pulseIntensity: 0.5, lighting: { glowRadius: 0.7 } })  // flat or grouped
orb.setSymbol('brain')                    // eyes | code | soundwave | brain | network | custom
orb.setColors({ primary: '#00AEEF', secondary: '#5B6CFF' })
orb.setAudioLevel(0.65)                   // 0..1, call repeatedly while the mic is live
orb.resetParameters()
orb.getState(); orb.getParameter('glowIntensity'); orb.getParameters({ grouped: true })
```

| Method | Returns | Notes |
| --- | --- | --- |
| `setState(name, { immediate })` | `boolean` | Animated unless `immediate`. Unknown names return `false` with a console warning. |
| `getState()` / `listStates()` | `string` / `string[]` | |
| `setParameter(key, value, { all, immediate })` | `boolean` | See "How parameter changes apply" below. Numbers are clamped to range; invalid values return `false`. |
| `setParameters(obj, opts)` | `{ applied, rejected }` | Takes a flat object or one grouped by section. |
| `getParameter(key)` / `getParameters({ grouped })` | value / object | Target values for the active state plus globals. |
| `setColors(colors, opts)` | `{ applied, rejected }` | Keys: `primary secondary accent highlight glow core symbol`. |
| `setSymbol(name, opts)` | `boolean` | Accepts names and aliases (`wave`, `neural`). Unknown names return `false`. |
| `registerSymbol(name, markup, options)` | `boolean` | See "Custom symbols". |
| `unregisterSymbol(name)` / `configureSymbol(name, opts)` / `listSymbols()` | | |
| `setAudioLevel(level)` | `boolean` | Smoothed with a fast attack and slower release. Falls back to 0 about 0.6 s after the last call. |
| `setLayerVisible(layer, bool)` | `boolean` | `glow back core inner main highlights interface front` |
| `resetParameters({ state, immediate })` | `boolean` | Resets every state and the globals, or only `state`. |
| `registerState(name, preset, { basedOn })` | `boolean` | Adds a new state, e.g. `'speaking'`. |
| `getConfig()` / `exportConfig()` / `loadConfig(cfg, { immediate })` | object / JSON / `{ applied, rejected }` | See "Configuration". |
| `pause()` / `resume()` / `isPaused()` | | Pausing freezes motion. Transitions you start while paused still finish. |
| `setReducedMotion('auto' \| 'on' \| 'off' \| bool)` | `boolean` | |
| `on(event, fn)` | unsubscribe fn | Events: `statechange`, `change`, `symbolchange`, `symbolsChanged`, `statesChanged`, `playback` |
| `destroy()` | | Stops the loop and removes listeners. |
| `orb.stats.fps` | number | Measured frame rate. |

### How parameter changes apply

- **Per-state parameters** (colours, appearance, motion, lighting, interface) edit the
  **active state's preset**. For example, `setParameter('glowIntensity', 0.9)` during
  processing changes how processing looks, now and the next time it is entered.
- Pass `{ all: true }` to change every state.
- **Global parameters** (layers, transitions, system) are shared by all states.
- `resetParameters()` restores the shipped defaults.

## States

| State | Palette | Default symbol | Character |
| --- | --- | --- | --- |
| `idle` | Blue / cyan, violet accents | eyes | Slow rotation, gentle breathing, low-to-moderate glow |
| `listening` | Green | eyes | Sound-wave rings, stronger pulse, reacts to `setAudioLevel()` (also animates without input) |
| `processing` | Magenta / crimson | code `</>` | Faster ribbons (`animationSpeed` 2.2 is the configurable processing speed), stronger inner light and glow |
| `memory` | Gold / amber | brain | Slower ribbons, rhythmic pulse, warm inner light, drifting particles |

The presets live in `src/orb-states.js` and list only what differs from the schema defaults.
That means a new parameter automatically gets a sensible value in every state.

### Transitions

Each animatable parameter has its own tween. A state change or parameter change retargets the
tween **from its current value**, so a new request during a running transition redirects it
smoothly.

| Parameter group | Duration setting |
| --- | --- |
| Colours | `colorDuration` (interpolated in OKLab, so blue → green never passes through grey) |
| Motion | `motionDuration` |
| Lighting | `glowDuration` |
| Everything else | `generalDuration` |

All of them use the `easing` curve.

**Symbol swaps** are sequential: the old symbol fades out, then the new one fades in, over
`symbolDuration` in total. Two symbols are never visible at once.

**Rotation speeds and directions** are integrated over time, so a speed change never makes a
ribbon jump. A direction flip slows the ribbon through zero and accelerates it the other way.

## Parameters

All values are validated. Numbers are clamped to their range, and invalid input is rejected
with a console warning. Most values are normalised to 0–1.

#### Colors *(per state)*

| Parameter | Type | Range | Default | Description |
| --- | --- | --- | --- | --- |
| `primary` | color | `#rrggbb` / `rgb()` | `#2f7dff` | Main ribbon colour and core rim. |
| `secondary` | color | `#rrggbb` / `rgb()` | `#2ee6ff` | Second ribbon colour, rim light, sound-wave rings. |
| `accent` | color | `#rrggbb` / `rgb()` | `#8b6cff` | Subtle accent (violet by default): rear ribbons, bounce light. |
| `highlight` | color | `#rrggbb` / `rgb()` | `#d9fbff` | Luminous ribbon edges, specular sheen, particles. |
| `glow` | color | `#rrggbb` / `rgb()` | `#3aa8ff` | Outer halo and inner light. |
| `core` | color | `#rrggbb` / `rgb()` | `#040815` | Dark central volume. |

#### Appearance *(per state)*

| Parameter | Type | Range | Default | Description |
| --- | --- | --- | --- | --- |
| `opacity` | number | 0 – 1 | `1` | Opacity of the whole orb. |
| `ribbonOpacity` | number | 0 – 1 | `1` | Multiplier for all ribbon layers. |
| `ribbonThickness` | number | 0 – 1 | `0` | Extra ribbon thickness. 0 = designed width, 1 = +8 user units. |
| `highlightIntensity` | number | 0 – 1 | `1` | Brightness of the luminous ribbon edges. |

#### Motion *(per state)*

| Parameter | Type | Range | Default | Description |
| --- | --- | --- | --- | --- |
| `animationSpeed` | number | 0 – 3 | `1` | Global time scale for all motion (rotation, wobble, pulse, breathing). 0 freezes motion. |
| `backSpeed` | number | 0 – 60 °/s | `5` | Rotation speed of rear ribbons, degrees/second. |
| `backDirection` | enum | `-1`, `1` | `-1` | Rotation direction: 1 = clockwise, -1 = counter-clockwise. Changes pass smoothly through zero. |
| `innerSpeed` | number | 0 – 60 °/s | `8` | Rotation speed of inner reflections, degrees/second. |
| `innerDirection` | enum | `-1`, `1` | `1` | Rotation direction: 1 = clockwise, -1 = counter-clockwise. Changes pass smoothly through zero. |
| `mainSpeed` | number | 0 – 60 °/s | `6` | Rotation speed of main ribbons, degrees/second. |
| `mainDirection` | enum | `-1`, `1` | `1` | Rotation direction: 1 = clockwise, -1 = counter-clockwise. Changes pass smoothly through zero. |
| `frontSpeed` | number | 0 – 60 °/s | `9` | Rotation speed of foreground sweeps, degrees/second. |
| `frontDirection` | enum | `-1`, `1` | `-1` | Rotation direction: 1 = clockwise, -1 = counter-clockwise. Changes pass smoothly through zero. |
| `ribbonAmplitude` | number | 0 – 1 | `0.35` | Organic wobble on top of rotation: angle sway (up to ±10°) and squash/stretch (up to ±5%). |
| `breathingIntensity` | number | 0 – 1 | `0.45` | Slow whole-orb scale and glow swell. |
| `breathingFrequency` | number | 0.02 – 1 Hz | `0.16` | Breaths per second. |
| `pulseIntensity` | number | 0 – 1 | `0.05` | Rhythmic pulse in ribbon scale, inner light and glow. |
| `pulseFrequency` | number | 0.1 – 4 Hz | `0.5` | Pulses per second. |
| `highlightSpeed` | number | 0 – 2 | `0.3` | Speed of the specular highlight drift. |

#### Lighting *(per state)*

| Parameter | Type | Range | Default | Description |
| --- | --- | --- | --- | --- |
| `glowIntensity` | number | 0 – 1 | `0.55` | Opacity of the outer halo. |
| `glowRadius` | number | 0 – 1 | `0.5` | Size of the outer halo (0 = tight, 1 = wide). |
| `innerIllumination` | number | 0 – 1 | `0.45` | Light pooled inside the core behind the symbol. |
| `outerIllumination` | number | 0 – 1 | `0.5` | Fresnel-style light on the sphere edge. |
| `highlightBrightness` | number | 0 – 1 | `0.6` | Brightness of the specular sheen and bounce light. |

#### Interface *(per state)*

| Parameter | Type | Range | Default | Description |
| --- | --- | --- | --- | --- |
| `symbol` | symbol | registered name | `eyes` | Active central symbol: any registered name (eyes, code, soundwave, brain, network, or custom). |
| `symbolColor` | color | `#rrggbb` / `rgb()` | `#e6fdff` | Colour of eyes and symbols. |
| `symbolScale` | number | 0.3 – 2 | `1` | Size multiplier for the central symbol. |
| `symbolX` | number | -1 – 1 | `0` | Horizontal offset, -1..1 (±60 user units). |
| `symbolY` | number | -1 – 1 | `0` | Vertical offset, -1..1 (±60 user units). |
| `symbolOpacity` | number | 0 – 1 | `1` | Opacity of the central symbol. |
| `eyesVisible` | boolean | true / false | `true` | When false the eyes symbol is hidden even while selected. |
| `blink` | boolean | true / false | `true` | Occasional eye blink (disabled under reduced motion). |
| `soundwaveVisible` | boolean | true / false | `false` | Liquid sound-wave rings around the orb. |
| `particlesVisible` | boolean | true / false | `false` | Small drifting particles. |
| `audioReactivity` | number | 0 – 1 | `0` | How strongly setAudioLevel() drives the rings, pulse and sound-wave symbol. |

#### Layers *(global — shared by all states)*

| Parameter | Type | Range | Default | Description |
| --- | --- | --- | --- | --- |
| `layerGlow` | boolean | true / false | `true` | Outer atmospheric halo. |
| `layerBack` | boolean | true / false | `true` | Ribbons behind the core. |
| `layerCore` | boolean | true / false | `true` | Dark central volume and inner light. |
| `layerInner` | boolean | true / false | `true` | Internal reflections. |
| `layerMain` | boolean | true / false | `true` | Main translucent ribbons. |
| `layerHighlights` | boolean | true / false | `true` | Specular sheen and bounce light. |
| `layerInterface` | boolean | true / false | `true` | Central symbol layer. |
| `layerFront` | boolean | true / false | `true` | Foreground sweeps. |

#### Transitions *(global — shared by all states)*

| Parameter | Type | Range | Default | Description |
| --- | --- | --- | --- | --- |
| `colorDuration` | number | 0 – 5000 ms | `900` | Duration of palette changes. |
| `symbolDuration` | number | 0 – 5000 ms | `500` | Total symbol swap time (fade out, then fade in). |
| `motionDuration` | number | 0 – 5000 ms | `1200` | Duration of speed/amplitude/pulse changes. |
| `glowDuration` | number | 0 – 5000 ms | `800` | Duration of lighting changes. |
| `generalDuration` | number | 0 – 5000 ms | `600` | Duration of everything else (appearance, interface, layers). |
| `easing` | enum | `linear`, `easeInOutSine`, `easeInOutQuad`, `easeInOutCubic`, `easeOutCubic`, `easeOutQuart` | `easeInOutCubic` | Easing curve used by all transitions. |

#### System *(global — shared by all states)*

| Parameter | Type | Range | Default | Description |
| --- | --- | --- | --- | --- |
| `reducedMotion` | enum | `auto`, `on`, `off` | `auto` | 'auto' follows the OS prefers-reduced-motion setting. |
| `maxFps` | number | 10 – 120 | `60` | Frame-rate cap. Lower it (e.g. 30) to save power on a desktop avatar. |

### Per-ribbon variation

Within a layer, each ribbon turns at its own speed multiplier, with its own wobble frequency
and phase (`RIBBON_VARIETY` in `orb-engine.js`). Layers never move as one rigid object. The
rear and front layers counter-rotate against the inner and main layers by default.

## Symbols

| Name | Visual | Animated detail |
| --- | --- | --- |
| `eyes` | Two vertical glowing ovals | Occasional blink, sometimes a double blink (off under reduced motion) |
| `code` | `</>` | none |
| `soundwave` | Six equaliser bars (alias `wave`) | Bars move gently, and follow the audio level when `audioReactivity` > 0 |
| `brain` | Two hemispheres with folds | Folds glow in sequence |
| `network` | Seven nodes and their links (alias `neural`) | Nodes light up in sequence |

The global `symbolScale`, `symbolX`, `symbolY`, `symbolOpacity` and `symbolColor` parameters
apply to whichever symbol is active. Per-symbol overrides stack on top:

```js
orb.configureSymbol('code', { scale: 1.2, y: -0.1, color: '#ffffff', opacity: 0.9 });
```

### Custom symbols

```js
orb.registerSymbol('heart',
  '<path d="M0 30C-40 4 -36 -30 -14 -30C-4 -30 0 -20 0 -16C0 -20 4 -30 14 -30C36 -30 40 4 0 30Z"/>',
  { label: 'Heart', scale: 1, viewBox: '-60 -60 120 120' });
orb.setSymbol('heart');
```

**How to draw a custom symbol:**
- Pass bare shapes or a whole `<svg>` (its `viewBox` is respected).
- The default drawing box is `-60…60`, centred on `0, 0`, matching the built-ins. The symbol
  is fitted into the same ~92 × 92 area.
- Unstyled shapes fill with the symbol colour (`currentColor`).
- Optional classes:

| Class | Effect |
| --- | --- |
| `orb-line` | Stroked in the symbol colour |
| `orb-dot` | Filled in the symbol colour |
| `orb-bar` | Animated like the equaliser bars |
| `orb-node` | Animated like the network nodes (sequential glow) |

**What the sanitiser does.** It never inserts the markup itself. It rebuilds a fresh tree from
an allowlist:
- **Elements kept:** `g path circle ellipse rect line polyline polygon`
- **Attributes kept:** geometry, fill, stroke, opacity, `transform`, and `class` (the four
  classes above only)
- **Everything else is dropped:** `<script>`, `<foreignObject>`, `<use>`, `<image>`, `<a>`,
  `<style>`, `on*` handlers, `href`, `style`, `id`, and any value containing `url(`,
  `javascript:` or `data:`
- **Rejected outright:** malformed markup, markup with no supported shapes, more than 400
  elements, and built-in names

Custom symbols are included in `exportConfig()`, so an import restores them too.

To add a permanent built-in, add a
`<g class="orb-symbol" data-symbol="name">…</g>` inside `.orb-symbol-stage` in `assets/orb.svg`
(or in `tools/generate_orb.py`). Then add an entry to `BUILTIN_SYMBOLS` in `orb-symbols.js`.

## Configuration

`orb.exportConfig()` produces JSON in this shape, and `orb.loadConfig()` accepts it.
`config/default-presets.json` contains the shipped defaults (regenerate it with
`node tools/export-presets.mjs`):

```json
{
  "version": 1,
  "state": "idle",
  "global":  { "layers": {...}, "transitions": {...}, "system": {...} },
  "presets": {
    "idle":       { "colors": {...}, "appearance": {...}, "motion": {...}, "lighting": {...}, "interface": {...} },
    "listening":  { ... }, "processing": { ... }, "memory": { ... }
  },
  "symbols": { "heart": { "markup": "<path …/>", "options": { ... } } }
}
```

**What `loadConfig()` accepts:**
- **The full shape** above. Presets for unknown state names create new states.
- **A single-state shape**, applied to that state:
  `{ "state": "idle", "colors": {...}, "motion": {...}, "lighting": {...}, "interface": {...} }`.
- **Missing keys** keep their current values.
- **Unknown keys** are ignored and listed in `rejected`.

This keeps old presets working as new parameters are added. Bump `CONFIG_VERSION` only for
incompatible changes.

The studio has **Export JSON**, **Import JSON** and **Copy** buttons.

## SVG layers

`viewBox="-256 -256 512 512"`: `(0, 0)` is the orb centre and the sphere radius is 168.
The engine finds elements by these classes, never by id:

| Order | Class | Animated by the engine |
| --- | --- | --- |
| 1 | `.orb-glow` › `.orb-glow-halo` | Opacity (glow intensity, breathing, pulse, audio), scale (glow radius) |
| 2 | `.orb-back-ribbons` › `.orb-ribbon--back` | Rotation, wobble, squash; layer opacity |
| 3 | `.orb-core` › `.orb-core-inner-light` | Inner illumination, pulse; rim through `--orb-rim-opacity` |
| 4 | `.orb-inner-ribbons` › `.orb-ribbon--inner` | As rear ribbons |
| 5 | `.orb-main-ribbons` › `.orb-ribbon--main` | As rear ribbons |
| 6 | `.orb-highlights` › `.orb-specular`, `.orb-bounce` | Drift and brightness |
| 7 | `.orb-interface` › `.orb-symbol-stage` › `.orb-symbol[data-symbol]` | Position, scale, cross-fade, blink, bars, nodes |
| 8 | `.orb-foreground-ribbons` › `.orb-ribbon--front` | As rear ribbons |
| 9 | `.orb-soundwaves` › `.orb-soundwave` | Live wave shape (only while visible) |
| 10 | `.orb-particles` | Slow orbit and twinkle (only while visible) |

**Colours.** The palette reaches the gradients through CSS custom properties on the `<svg>`:
`--orb-primary`, `--orb-secondary`, `--orb-accent`, `--orb-highlight`, `--orb-glow`,
`--orb-core`, `--orb-symbol-color` and `--orb-opacity`, plus `--rb-width`,
`--orb-edge-opacity` and `--orb-rim-opacity`.

**Without the engine,** the SVG still works on its own:
- `data-state`, `data-symbol`, `data-particles` and `data-soundwaves` attributes switch it
  statically.
- `src/orb.css` adds a CSS-only drift and blink.
- Loaded through `<img>`, it shows the default idle look.

To change the ribbon geometry, edit `RIBBONS` in `tools/generate_orb.py` and run
`python3 tools/generate_orb.py`.

## Performance

- **One `requestAnimationFrame` loop.** Each frame writes only attributes and variables whose
  value changed: about 15 transforms plus a few opacities. The SVG is never rebuilt. The
  engine's JavaScript costs about 0.07 ms per frame (measured by the tests).
- **Three small filters, all static.** The atmospheric glow is a gradient, not a blur.
- **Optional layers cost nothing when off.** The sound-wave rings are recomputed only while
  visible, and particles (six dots) are hidden by default. Hidden layers get `display: none`.
- **The loop stops on its own** when the page is hidden, the orb is scrolled out of view, or
  the orb is paused with no transition running.
- **Frame rate:** use `maxFps` (e.g. 30) and/or `inactiveFps` to cut power use on a desktop.
- **Reduced motion** follows the OS by default (`reducedMotion: 'auto'`). It slows rotation to
  15 %, softens wobble, pulse and breathing, and disables blinking. Colour and symbol
  transitions still run.

## Desktop (Electron) readiness

`avatar.html` is the page to load. It has a transparent background, no UI, and fills the
window at any size. A minimal main process:

```js
const win = new BrowserWindow({
  width: 220, height: 220, x: 40, y: 40,
  transparent: true, frame: false, hasShadow: false, resizable: false,
  alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#00000000',
});
win.loadFile('orb/avatar.html');            // or serve the folder and loadURL
win.setIgnoreMouseEvents(true, { forward: true });   // optional click-through
// Drive it from the main process:
win.webContents.executeJavaScript(`orb.setState('listening')`);
```

**Notes for the desktop app:**
- The avatar exposes `window.orb`. Add `class="drag"` to `<body>` for a draggable frameless
  window.
- Open `index.html` in a separate window when you need the controls. The panel is never part
  of the avatar.
- If `fetch()` of a `file://` URL is blocked in your setup, read `assets/orb.svg` yourself and
  pass `svgText` to `OrbEngine.mount`.
- Microphone access is **not** implemented. Feed levels from your own audio pipeline with
  `orb.setAudioLevel(rms)`.

## Acceptance tests

`node tests/acceptance.mjs` starts `tools/serve.mjs`, opens the pages in headless Chromium and
checks:
- transparency
- all four states through the API
- smooth colour changes with untouched geometry
- independent layer motion
- runtime speed, glow and pulse changes
- symbol swaps (never two at once)
- custom symbol registration and sanitisation
- all 12 state-to-state transitions, plus mid-transition redirects
- control panel wiring
- config round-trips
- legibility at 128 px and 512 px
- reduced motion, pause and per-frame cost
- no external requests

Screenshots are written to `tests/output/`.
