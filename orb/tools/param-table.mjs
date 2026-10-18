#!/usr/bin/env node
// Print the parameter reference (Markdown) from the schema: node tools/param-table.mjs
import { PARAMS, GROUPS } from '../src/orb-params.js';
const fmt = v => (typeof v === 'string' ? `\`${v}\`` : `\`${JSON.stringify(v)}\``);
for (const [g, title] of Object.entries(GROUPS)) {
  const rows = Object.entries(PARAMS).filter(([, p]) => p.group === g);
  const scope = rows.some(([, p]) => p.scope === 'global') ? ' *(global — shared by all states)*' : ' *(per state)*';
  console.log(`#### ${title}${scope}\n\n| Parameter | Type | Range | Default | Description |\n| --- | --- | --- | --- | --- |`);
  for (const [k, p] of rows) {
    const range = p.type === 'number' ? `${p.min} – ${p.max}${p.unit ? ` ${p.unit}` : ''}`
      : p.type === 'enum' ? p.options.map(o => `\`${o}\``).join(', ')
      : p.type === 'color' ? '`#rrggbb` / `rgb()`' : p.type === 'boolean' ? 'true / false' : 'registered name';
    console.log(`| \`${k}\` | ${p.type} | ${range} | ${fmt(p.default)} | ${p.doc} |`);
  }
  console.log();
}
