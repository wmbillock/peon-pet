#!/usr/bin/env node
'use strict';
// node scripts/clean-pet-art.js <sources.json> <output-dir>
// Sources: [{slug, source: absolute original PNG path}]. Always writes a staging bundle.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { createCanvas, loadImage } = require('canvas');
const { cleanPixels, clearEdgeFragments } = require('../lib/sprite-cleanup');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
async function cleanArt(sourcesFile, outputDir) {
  const sources = JSON.parse(fs.readFileSync(sourcesFile));
  if (!Array.isArray(sources) || !sources.length) throw new Error('No source sheets');
  const assets = path.join(outputDir, 'renderer/assets'); fs.mkdirSync(assets, { recursive: true });
  const report = [];
  for (const { slug, source } of sources) {
    if (!/^[a-z0-9-]+$/.test(slug) || !source || !fs.existsSync(source)) throw new Error(`Missing source: ${slug}`);
    const img = await loadImage(source);
    const src = createCanvas(img.width, img.height), g = src.getContext('2d'); g.drawImage(img, 0, 0);
    const original = g.getImageData(0, 0, img.width, img.height);
    const cleaned = cleanPixels(original.data, img.width, img.height);
    original.data.set(cleaned.pixels); g.putImageData(original, 0, 0);
    const { xCuts, yCuts } = cleaned;
    const current = path.join(__dirname, '../renderer/assets', `${slug}-sprite-atlas.png`);
    const currentImage = await loadImage(current);
    const size = currentImage.width, cell = size / 6, inset = size >= 3072 ? 64 : 2;
    const maxW = Math.max(...cleaned.frames.map(f => f.sw));
    const maxH = Math.max(...cleaned.frames.map(f => f.sh));
    const scale = (cell - inset * 2) / Math.max(maxW, maxH);
    const atlas = createCanvas(size, size), a = atlas.getContext('2d'); a.imageSmoothingEnabled = false;
    let populated = 0, separatorInk = 0, edgeFragments = 0;
    for (const [index, { row, col, sx, sy, sw, sh }] of cleaned.frames.entries()) {
      const isolated = createCanvas(sw, sh), fg = isolated.getContext('2d'), framePixels = fg.createImageData(sw, sh);
      let visible = 0;
      for (let y = sy; y < sy + sh; y++) for (let x = sx; x < sx + sw; x++) {
        if (cleaned.owners[y * img.width + x] === index + 1) {
          visible++;
          const sourceAt = (y * img.width + x) * 4, destAt = ((y - sy) * sw + x - sx) * 4;
          framePixels.data.set(cleaned.pixels.subarray(sourceAt, sourceAt + 4), destAt);
          if ((col > 0 && x === sx) || (row > 0 && y === sy)) separatorInk++;
        }
      }
      if (visible < 100) throw new Error(`Empty frame: ${slug} ${row},${col}`);
      populated++;
      edgeFragments += clearEdgeFragments(framePixels.data, sw, sh);
      fg.putImageData(framePixels, 0, 0);
      const dw = Math.round(sw * scale), dh = Math.round(sh * scale);
      a.drawImage(isolated, 0, 0, sw, sh, col * cell + Math.round((cell - dw) / 2), row * cell + Math.round((cell - dh) / 2), dw, dh);
    }
    const pixels = a.getImageData(0, 0, size, size).data;
    let paddingInk = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if ((x % cell < inset || x % cell >= cell - inset || y % cell < inset || y % cell >= cell - inset) && pixels[(y * size + x) * 4 + 3]) paddingInk++;
    }
    if (paddingInk) throw new Error(`Unsafe padding: ${slug}`);
    const atlasBytes = atlas.toBuffer('image/png');
    fs.writeFileSync(path.join(assets, `${slug}-sprite-atlas.png`), atlasBytes);
    const icon = createCanvas(256, 256), ic = icon.getContext('2d'); ic.imageSmoothingEnabled = false;
    ic.drawImage(atlas, 0, cell * 2, cell, cell, 0, 0, 256, 256);
    fs.writeFileSync(path.join(assets, `${slug}-dock-icon.png`), icon.toBuffer('image/png'));
    report.push({ slug, source, sourceSHA256: sha(fs.readFileSync(source)), beforeSHA256: sha(fs.readFileSync(current)), sha256: sha(atlasBytes), size, xCuts, yCuts, frames: cleaned.frames, scale, populated, separatorInk, paddingInk, recoveredComponents: cleaned.recoveredComponents, removed: { ...cleaned.removed, edgeFragments } });
    console.log(`${slug}: 36 frames; separator ink ${separatorInk}; padding ${paddingInk}`);
  }
  fs.writeFileSync(path.join(outputDir, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (require.main === module) {
  const [sources, out] = process.argv.slice(2);
  if (!sources || !out) throw new Error('usage: clean-pet-art.js sources.json output-dir');
  cleanArt(sources, out).catch(e => { console.error(e); process.exitCode = 1; });
}
module.exports = { cleanArt };
