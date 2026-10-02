#!/usr/bin/env node
'use strict';
// Install generated cutout sheets (from scripts/gen-art-codex.js) as the bundled art for their species.
//   node scripts/install-art-cutouts.js <stage-dir> [slug ...]
// Keys out the magenta backdrop, writes renderer/assets/<slug>-sprite-atlas.png and <slug>-dock-icon.png (replacing the
// baked sheet; git keeps the old one), and records each species' new defaults in scripts/art-cutouts.json:
// layout cutout, setting free, and the environment generated for it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { importCharacter } = require('../lib/character-import');

const ROOT = path.join(__dirname, '..');
const [stage, ...only] = process.argv.slice(2);
if (!stage) { console.error('usage: install-art-cutouts.js <stage-dir> [slug ...]'); process.exit(2); }
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'art-plan.json'), 'utf8'));
const envId = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 31);
const manifestFile = path.join(__dirname, 'art-cutouts.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { version: 1, species: {} };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutouts-'));
  for (const sp of plan.species) {
    const src = path.join(stage, `${sp.slug}-cutout.png`);
    if ((only.length && !only.includes(sp.slug)) || !fs.existsSync(src)) continue;
    const r = await importCharacter({ name: sp.slug, atlas: src, destRoot: tmp, maxPx: 3072, chroma: '#FF00FF' });
    fs.copyFileSync(path.join(r.dir, 'sprite-atlas.png'), path.join(ROOT, 'renderer', 'assets', `${sp.slug}-sprite-atlas.png`));
    fs.copyFileSync(path.join(r.dir, 'dock-icon.png'), path.join(ROOT, 'renderer', 'assets', `${sp.slug}-dock-icon.png`));
    manifest.species[sp.slug] = { layout: r.layout, setting: 'free', defaultEnv: sp.env ? envId(sp.env.name) : null, activity: sp.activity || '' };
    console.log(`${sp.slug}: ${r.layout}, cell ${r.cell}px${r.warnings.length ? `  ⚠ ${r.warnings.join('; ')}` : ''}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
})().catch((e) => { console.error(e.message); process.exit(1); });
