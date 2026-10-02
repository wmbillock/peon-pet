#!/usr/bin/env node
// Generate a procedural head-bob strip (6 frames) from a species' typing row.
//   node scripts/gen-headbob.js bearded-dragon           → renderer/assets/bearded-dragon-extras.png
// The head region (centre + softness, in a 512px cell) is a per-species setting below.
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');
const { warpRegion, BOB_OFFSETS } = require('../lib/bob');

const ASSETS = path.join(__dirname, '../renderer/assets');
const TYPING_ROW = 2;
// Head + beard centre as a fraction of the cell, and softness as a fraction of cell width.
const HEADS = {
  'bearded-dragon': { cx: 0.50, cy: 0.42, sigma: 0.12 },
};

async function main(slug) {
  const h = HEADS[slug];
  if (!h) throw new Error(`No head region defined for "${slug}". Known: ${Object.keys(HEADS).join(', ')}`);
  const atlas = await loadImage(path.join(ASSETS, `${slug}-sprite-atlas.png`));
  const cell = Math.floor(atlas.width / 6);
  const region = { cx: h.cx * cell, cy: h.cy * cell, sigma: h.sigma * cell };
  const out = createCanvas(cell * 6, cell);
  const octx = out.getContext('2d');
  for (let i = 0; i < 6; i++) {
    const c = createCanvas(cell, cell);
    const x = c.getContext('2d');
    x.drawImage(atlas, i * cell, TYPING_ROW * cell, cell, cell, 0, 0, cell, cell);
    const src = x.getImageData(0, 0, cell, cell);
    const dst = x.createImageData(cell, cell);
    warpRegion(src.data, dst.data, cell, cell, region, BOB_OFFSETS[i] * (cell / 512));
    octx.putImageData(dst, i * cell, 0);
  }
  const file = path.join(ASSETS, `${slug}-extras.png`);
  fs.writeFileSync(file, out.toBuffer('image/png'));
  console.log(`wrote ${path.relative(process.cwd(), file)} (${cell * 6}×${cell}, 1 row: headbob)`);
}

main(process.argv[2] || 'bearded-dragon').catch((e) => { console.error(e.message); process.exit(1); });
