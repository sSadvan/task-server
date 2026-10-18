// State presets. Each preset only lists what differs from the schema defaults
// (orb-params.js), so new parameters automatically get a sensible value in every state.
// config/default-presets.json is the exported form of these (node tools/export-presets.mjs).

export const STATE_PRESETS = {
  // Available and waiting: calm, attentive, minimal motion.
  idle: {
    colors: {
      primary: '#2f7dff', secondary: '#2ee6ff', accent: '#8b6cff',
      highlight: '#d9fbff', glow: '#3aa8ff', core: '#040815',
    },
    interface: { symbol: 'eyes', symbolColor: '#e6fdff' },
  },

  // Actively listening: green, livelier pulse, sound-wave rings that follow the mic level.
  listening: {
    colors: {
      primary: '#13c26b', secondary: '#5dffb0', accent: '#1ed0c4',
      highlight: '#e4ffef', glow: '#2ee88a', core: '#03100a',
    },
    motion: {
      animationSpeed: 1.2, breathingIntensity: 0.3, pulseIntensity: 0.3, pulseFrequency: 1.1,
      ribbonAmplitude: 0.45,
    },
    lighting: { glowIntensity: 0.65, innerIllumination: 0.55, outerIllumination: 0.6 },
    interface: { symbol: 'eyes', symbolColor: '#eafff3', soundwaveVisible: true, audioReactivity: 1 },
  },

  // Thinking / executing: magenta, faster ribbons, stronger (but controlled) light.
  // animationSpeed here is the configurable processing speed.
  processing: {
    colors: {
      primary: '#ff2f7a', secondary: '#ff6bd5', accent: '#a14bff',
      highlight: '#ffe3f3', glow: '#ff3d8b', core: '#12030b',
    },
    motion: {
      animationSpeed: 2.2, ribbonAmplitude: 0.5, breathingIntensity: 0.2,
      pulseIntensity: 0.35, pulseFrequency: 1.6, highlightSpeed: 1,
      mainSpeed: 9, frontSpeed: 13,
    },
    lighting: { glowIntensity: 0.75, glowRadius: 0.6, innerIllumination: 0.75, outerIllumination: 0.65, highlightBrightness: 0.7 },
    interface: { symbol: 'code', symbolColor: '#fff0f8' },
  },

  // Recall / saving: warm gold, slower ribbons, gentle rhythmic pulses.
  memory: {
    colors: {
      primary: '#ffb21e', secondary: '#ffe066', accent: '#ff7a3d',
      highlight: '#fff6d6', glow: '#ffc23a', core: '#110b02',
    },
    motion: {
      animationSpeed: 0.8, breathingIntensity: 0.35, pulseIntensity: 0.4, pulseFrequency: 0.7,
      ribbonAmplitude: 0.3,
    },
    lighting: { glowIntensity: 0.6, innerIllumination: 0.65, outerIllumination: 0.55 },
    interface: { symbol: 'brain', symbolColor: '#fff9e6', particlesVisible: true },
  },
};
