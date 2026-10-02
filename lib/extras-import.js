const fs = require('fs');
const path = require('path');
const { keyOutChroma, parseHex } = require('./chroma');

const GRID = 6;
const MAX_WIDTH = 1536;

/**
 * Add or replace one 6-frame row in a species' extras sheet (<customRoot>/<slug>/extras.png).
 * An existing sheet (custom, else the bundled one) is kept and extended, so earlier extras survive.
 *   strip: path to a 6×1 image.  row: replace this row index, or omit to append.
 */
async function importExtraRow({ slug, strip, customRoot, bundledExtras = null, row = null, chroma = null }) {
  const { createCanvas, loadImage } = require('canvas');
  const src = await loadImage(strip);
  const aspect = src.width / src.height;
  // Either six frames in one row (6:1) or a 3×2 grid read left-to-right, top row first (3:2 landscape,
  // which is what chat image tools can actually produce).
  const isStrip = aspect >= GRID * 0.85 && aspect <= GRID * 1.15;
  const isGrid = aspect >= 1.5 * 0.85 && aspect <= 1.5 * 1.15;
  if (!isStrip && !isGrid) {
    throw new Error(`The image is ${src.width}×${src.height}; expected six frames in one row (about 6:1) or a 3×2 grid of frames (about 3:2).`);
  }

  const dir = path.join(customRoot, slug);
  const customFile = path.join(dir, 'extras.png');
  const existingFile = fs.existsSync(customFile) ? customFile : (bundledExtras && fs.existsSync(bundledExtras) ? bundledExtras : null);
  const existing = existingFile ? await loadImage(existingFile) : null;

  const srcCellW = isStrip ? src.width / GRID : src.width / 3;
  const cell = existing ? Math.floor(existing.width / GRID) : Math.floor(Math.min(MAX_WIDTH / GRID, srcCellW));
  const width = cell * GRID;
  const oldRows = existing ? Math.max(1, Math.round(existing.height / (existing.width / GRID))) : 0;
  const target = row === null || row === undefined ? oldRows : row;
  if (!Number.isInteger(target) || target < 0 || target > oldRows || target > 15) throw new Error(`Cannot place a row at index ${target}`);
  const rows = Math.max(oldRows, target + 1);

  const canvas = createCanvas(width, cell * rows);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (existing) ctx.drawImage(existing, 0, 0, existing.width, existing.height, 0, 0, width, cell * oldRows);

  // Draw the new strip into its row (replacing whatever was there), keying the backdrop if asked.
  const rowCanvas = createCanvas(width, cell);
  const rctx = rowCanvas.getContext('2d');
  rctx.imageSmoothingQuality = 'high';
  if (isStrip) {
    rctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, width, cell);
  } else {
    const fw = src.width / 3, fh = src.height / 2;
    for (let i = 0; i < GRID; i++) rctx.drawImage(src, (i % 3) * fw, Math.floor(i / 3) * fh, fw, fh, i * cell, 0, cell, cell);
  }
  const warnings = [];
  if (chroma) {
    const img = rctx.getImageData(0, 0, width, cell);
    const cleared = keyOutChroma(img.data, { color: parseHex(chroma) });
    if (cleared < width * cell * 0.05) warnings.push(`Only ${(100 * cleared / (width * cell)).toFixed(1)}% of pixels matched ${chroma}.`);
    rctx.putImageData(img, 0, 0);
  }
  ctx.clearRect(0, target * cell, width, cell);
  ctx.drawImage(rowCanvas, 0, target * cell);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(customFile, canvas.toBuffer('image/png'));
  return { row: target, rows, cell, warnings };
}

module.exports = { importExtraRow };
