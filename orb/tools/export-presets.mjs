#!/usr/bin/env node
// Regenerate config/default-presets.json from src/orb-params.js + src/orb-states.js.
// The output has the same shape as orb.exportConfig(), so it can be passed to orb.loadConfig().
import { writeFile, mkdir } from 'node:fs/promises';
import { defaultValues, flattenParams, groupParams } from '../src/orb-params.js';
import { STATE_PRESETS } from '../src/orb-states.js';
import { CONFIG_VERSION } from '../src/orb-config-version.js';

const presets = {};
for (const [name, preset] of Object.entries(STATE_PRESETS)) {
  presets[name] = groupParams({ ...defaultValues('state'), ...flattenParams(preset) });
}
const config = { version: CONFIG_VERSION, state: 'idle', global: groupParams(defaultValues('global')), presets, symbols: {} };
const out = new URL('../config/default-presets.json', import.meta.url);
await mkdir(new URL('.', out), { recursive: true });
await writeFile(out, JSON.stringify(config, null, 2) + '\n');
console.log(`wrote ${out.pathname}`);
