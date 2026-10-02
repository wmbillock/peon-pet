#!/usr/bin/env node
// Print a paste-ready image-generation prompt for a new pet.
//   node scripts/character-prompt.js --brief wizard-cat
//   node scripts/character-prompt.js --name robot --desc "A tiny robot ..." [--scene "..."] [--cell 512]
//   node scripts/character-prompt.js --brief wizard-cat --row 3        # single-row strip fallback (1-6)
//   node scripts/character-prompt.js --list
const path = require('path');
const { buildAtlasPrompt, buildStripPrompt } = require('../lib/character-gen');
const briefs = require('./character-briefs.json');

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

if (process.argv.includes('--list')) {
  for (const [k, v] of Object.entries(briefs)) console.log(`${k.padEnd(18)} ${v.slice(0, 80)}…`);
  process.exit(0);
}

const brief = arg('--brief');
if (brief && !briefs[brief]) {
  console.error(`Unknown brief "${brief}". Try --list.`);
  process.exit(1);
}
const spec = {
  name: arg('--name') || brief,
  description: arg('--desc') || briefs[brief],
  scene: arg('--scene') || undefined,
  cell: Number(arg('--cell')) || 512,
};
const row = arg('--row');
try {
  console.log(row ? buildStripPrompt({ ...spec, row: Number(row) - 1 }) : buildAtlasPrompt(spec));
} catch (e) {
  console.error(`${e.message}\nUsage: node ${path.relative(process.cwd(), __filename)} --brief <name> | --name <n> --desc "<text>" [--row 1-6] [--list]`);
  process.exit(1);
}
