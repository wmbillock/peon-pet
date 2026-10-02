const fs = require('fs');
const path = require('path');

const GRID = 6;
const MAX_ATLAS_PX = 1536;   // 256px cells: plenty for a 200px window, light on GPU memory
const ICON_PX = 256;

function checkAspect(w, h, expectW, expectH, label) {
  const off = Math.abs(w / h - expectW / expectH) / (expectW / expectH);
  if (off > 0.15) throw new Error(`${label} is ${w}×${h}; expected about ${expectW}:${expectH}. The model likely got the grid wrong — try the per-row prompts.`);
  return off > 0.03 ? [`${label} aspect is ${(off * 100).toFixed(0)}% off; frames will be slightly stretched`] : [];
}

// Build a sprite-atlas.png (+ dock-icon.png) for `name` under destRoot/<name>/.
// Provide either `atlas` (one 6×6 image) or `strips` (6 images, one 6×1 row each, in row order).
async function importCharacter({ name, atlas, strips, destRoot, maxPx = MAX_ATLAS_PX }) {
  const { createCanvas, loadImage } = require('canvas');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name || '')) throw new Error('name must be letters, digits, - or _');
  if (!!atlas === !!strips) throw new Error('Provide exactly one of atlas or strips');
  if (strips && strips.length !== GRID) throw new Error(`Need ${GRID} strips (one per animation row), got ${strips.length}`);

  const warnings = [];
  const first = await loadImage(atlas || strips[0]);
  const srcCell = atlas ? first.width / GRID : first.width / GRID;
  if (srcCell < 64) throw new Error(`Image is too small (${first.width}px wide); cells would be under 64px`);

  const cell = Math.floor(Math.min(maxPx, first.width) / GRID);
  const size = cell * GRID;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (atlas) {
    warnings.push(...checkAspect(first.width, first.height, 1, 1, 'Atlas'));
    ctx.drawImage(first, 0, 0, size, size);
  } else {
    for (let i = 0; i < GRID; i++) {
      const img = i === 0 ? first : await loadImage(strips[i]);
      warnings.push(...checkAspect(img.width, img.height, GRID, 1, `Strip ${i + 1}`));
      ctx.drawImage(img, 0, i * cell, size, cell);
    }
  }

  // Dock/menu-bar icon: first frame of the typing row.
  const icon = createCanvas(ICON_PX, ICON_PX);
  const ictx = icon.getContext('2d');
  ictx.imageSmoothingQuality = 'high';
  ictx.drawImage(canvas, 0, 2 * cell, cell, cell, 0, 0, ICON_PX, ICON_PX);

  const dir = path.join(destRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sprite-atlas.png'), canvas.toBuffer('image/png'));
  fs.writeFileSync(path.join(dir, 'dock-icon.png'), icon.toBuffer('image/png'));
  return { dir, size, cell, warnings };
}

module.exports = { importCharacter, MAX_ATLAS_PX };
