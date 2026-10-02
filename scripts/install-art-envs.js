#!/usr/bin/env node
'use strict';
// Install generated environments (from scripts/gen-art-codex.js) as built-in backgrounds.
//   node scripts/install-art-envs.js <stage-dir>
// Resizes each env-<slug>.png to 1024×1024 into renderer/assets/ and lists it in scripts/art-cutout-envs.json
// (id, name and description come from scripts/art-plan.json). Re-running updates in place.
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const stage = process.argv[2];
if (!stage) { console.error('usage: install-art-envs.js <stage-dir>'); process.exit(2); }
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'art-plan.json'), 'utf8'));
const idOf = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 31);

(async () => {
  const manifestFile = path.join(__dirname, 'art-cutout-envs.json');
  const manifest = { version: 1, environments: [] };
  for (const sp of plan.species) {
    const src = path.join(stage, `env-${sp.slug}.png`);
    if (!sp.env || !fs.existsSync(src)) continue;
    const id = idOf(sp.env.name);
    const img = await loadImage(src);
    const c = createCanvas(1024, 1024), x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    x.drawImage(img, 0, 0, img.width, img.height, 0, 0, 1024, 1024);
    const file = `env-${id}.png`;
    fs.writeFileSync(path.join(ROOT, 'renderer', 'assets', file), c.toBuffer('image/png'));
    manifest.environments.push({ id, display: sp.env.name, category: 'species', description: sp.env.description, path: `renderer/assets/${file}`, for: sp.slug, localOnly: !!sp.localOnly });
    console.log(`${id}  ←  ${path.basename(src)} (${img.width}px)`);
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
})();
