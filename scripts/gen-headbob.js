#!/usr/bin/env node
// Generate a procedural head-bob strip (6 frames) from a species' typing row.
//
//   node scripts/gen-headbob.js bearded-dragon                  # bundled art → renderer/assets/<slug>-extras.png
//   node scripts/gen-headbob.js bearded-dragon --custom         # ACTIVE art (your custom sheet if any) →
//                                                               #   <userData>/characters/<slug>/extras.png, row 0
//   options: --region cx,cy,sigma   head centre + softness as fractions of the cell (default per species)
//            --root <dir>           characters folder (default ~/Library/Application Support/Peon Pet/characters)
//
// Re-run with --custom after replacing a species' sheet so the bob matches the new art.
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { warpRegion, BOB_OFFSETS } = require('../lib/bob');
const { importExtraRow } = require('../lib/extras-import');
const BUNDLED = require('../lib/bundled-characters');

const ASSETS = path.join(__dirname, '../renderer/assets');
const TYPING_ROW = 2;
const DEFAULT_REGION = { cx: 0.50, cy: 0.42, sigma: 0.12 };
const HEADS = { 'bearded-dragon': DEFAULT_REGION };

function arg(flag) { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : undefined; }

async function makeStrip(atlasFile, region) {
  const atlas = await loadImage(atlasFile);
  const cell = Math.floor(atlas.width / 6);
  const r = { cx: region.cx * cell, cy: region.cy * cell, sigma: region.sigma * cell };
  const out = createCanvas(cell * 6, cell);
  const octx = out.getContext('2d');
  for (let i = 0; i < 6; i++) {
    const c = createCanvas(cell, cell);
    const x = c.getContext('2d');
    x.drawImage(atlas, i * cell, TYPING_ROW * cell, cell, cell, 0, 0, cell, cell);
    const src = x.getImageData(0, 0, cell, cell);
    const dst = x.createImageData(cell, cell);
    warpRegion(src.data, dst.data, cell, cell, r, BOB_OFFSETS[i] * (cell / 512));
    octx.putImageData(dst, i * cell, 0);
  }
  return { canvas: out, cell };
}

async function main() {
  const slug = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'bearded-dragon';
  const custom = process.argv.includes('--custom');
  const regionArg = arg('--region');
  let region = HEADS[slug] || DEFAULT_REGION;
  if (regionArg) {
    const [cx, cy, sigma] = regionArg.split(',').map(Number);
    if (![cx, cy, sigma].every(Number.isFinite)) throw new Error('--region must be cx,cy,sigma (fractions of the cell)');
    region = { cx, cy, sigma };
  }
  const root = arg('--root') || path.join(os.homedir(), 'Library', 'Application Support', 'Peon Pet', 'characters');

  const customAtlas = path.join(root, slug, 'sprite-atlas.png');
  const bundledMap = Object.hasOwn(BUNDLED, slug) ? BUNDLED[slug] : null;
  const atlasFile = custom && fs.existsSync(customAtlas) ? customAtlas
    : bundledMap ? path.join(ASSETS, bundledMap['sprite-atlas.png']) : null;
  if (!atlasFile) throw new Error(`No sprite sheet found for "${slug}"`);

  const { canvas, cell } = await makeStrip(atlasFile, region);
  if (!custom) {
    const file = path.join(ASSETS, `${slug}-extras.png`);
    fs.writeFileSync(file, canvas.toBuffer('image/png'));
    console.log(`wrote ${path.relative(process.cwd(), file)} from ${path.basename(atlasFile)}`);
    return;
  }
  const tmp = path.join(os.tmpdir(), `headbob-${slug}-${process.pid}.png`);
  fs.writeFileSync(tmp, canvas.toBuffer('image/png'));
  const bundledExtras = bundledMap && bundledMap['extras.png'] ? path.join(ASSETS, bundledMap['extras.png']) : null;
  const r = await importExtraRow({ slug, strip: tmp, customRoot: root, bundledExtras, row: 0 });
  fs.rmSync(tmp, { force: true });
  console.log(`wrote ${path.join(root, slug, 'extras.png')} row ${r.row + 1} (headbob) from ${path.basename(atlasFile)}, cell ${cell}px`);
  console.log('Make sure the species lists a "headbob" extra on row 1 (Species & art → Extra animations).');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
