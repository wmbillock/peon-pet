'use strict';

// Find frame separators in the transparent gutters of generated art, rather than assuming
// the model placed every pose on an exact 6x6 grid. Source pixels are never stretched.
function findCuts(projection, count = 6) {
  const cuts = [0], cell = projection.length / count;
  for (let k = 1; k < count; k++) {
    const nominal = k * cell;
    let best = Math.round(nominal), score = Infinity;
    for (let at = Math.ceil(nominal - cell * .23); at <= Math.floor(nominal + cell * .23); at++) {
      let ink = 0;
      for (let j = at - 2; j <= at + 2; j++) ink += projection[j] || 0;
      const candidate = ink + Math.abs(at - nominal) * .01;
      if (candidate < score) { score = candidate; best = at; }
    }
    cuts.push(best);
  }
  cuts.push(projection.length);
  return cuts;
}

function cleanPixels(input, width, height) {
  const pixels = new Uint8ClampedArray(input);
  let faint = 0, specks = 0;
  // Nearly transparent matte residue becomes conspicuous under the renderer's alpha test.
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] > 0 && pixels[i + 3] < 32) { pixels.fill(0, i, i + 4); faint++; }
  }
  // Remove only isolated pinpricks. Connected outlines, props, sleep Zs and reaction marks remain.
  const seen = new Uint8Array(width * height), queue = new Int32Array(width * height), components = [];
  for (let at = 0; at < seen.length; at++) {
    if (seen[at] || pixels[at * 4 + 3] === 0) continue;
    let read = 0, size = 1; queue[0] = at; seen[at] = 1;
    while (read < size) {
      const p = queue[read++], x = p % width, y = Math.floor(p / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
        const n = yy * width + xx;
        if (!seen[n] && pixels[n * 4 + 3]) { seen[n] = 1; queue[size++] = n; }
      }
    }
    if (size < 8) for (let i = 0; i < size; i++) { pixels.fill(0, queue[i] * 4, queue[i] * 4 + 4); specks++; }
    else components.push(queue.slice(0, size));
  }
  const xs = new Int32Array(width), ys = new Int32Array(height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3]) { xs[x]++; ys[y]++; }
  }
  const xCuts = findCuts(xs), yCuts = findCuts(ys), frames = [];
  // A moving tail or prop can block a gutter in only one pose. Measure column
  // separators per animation row, then row separators within each column.
  for (let row = 0; row < 6; row++) {
    const projection = new Int32Array(width);
    for (let y = yCuts[row]; y < yCuts[row + 1]; y++) for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3]) projection[x]++;
    }
    const columns = findCuts(projection);
    for (let col = 0; col < 6; col++) {
      const vertical = new Int32Array(height);
      for (let y = 0; y < height; y++) for (let x = columns[col]; x < columns[col + 1]; x++) {
        if (pixels[(y * width + x) * 4 + 3]) vertical[y]++;
      }
      const rows = findCuts(vertical);
      frames.push({ row, col, sx: columns[col], sy: rows[row], sw: columns[col + 1] - columns[col], sh: rows[row + 1] - rows[row] });
    }
  }
  // Assign whole connected shapes to the cell containing most of their pixels.
  // This recovers a tongue or fishing rod that crosses a rectangular gutter without
  // also copying it into its neighbor. Every retained source pixel has exactly one owner.
  const owners = new Uint8Array(width * height);
  const expanded = frames.map(f => ({ ...f }));
  let recoveredComponents = 0;
  for (const component of components) {
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (const p of component) { const x = p % width, y = Math.floor(p / width); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const overlap = new Int32Array(frames.length);
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (maxX < f.sx || minX >= f.sx + f.sw || maxY < f.sy || minY >= f.sy + f.sh) continue;
      for (const p of component) { const x = p % width, y = Math.floor(p / width); if (x >= f.sx && x < f.sx + f.sw && y >= f.sy && y < f.sy + f.sh) overlap[i]++; }
    }
    const owner = overlap.indexOf(Math.max(...overlap)), f = expanded[owner];
    if (overlap[owner] === 0) throw new Error('Source shape has no frame');
    if (maxX - minX > width / 6 * 1.7 || maxY - minY > height / 6 * 1.7) {
      // Some original chroma cutouts join neighboring poses through a thin effect.
      // Keep these on their measured sides rather than moving two characters together.
      for (const p of component) {
        const x = p % width, y = Math.floor(p / width);
        const index = frames.findIndex(f => x >= f.sx && x < f.sx + f.sw && y >= f.sy && y < f.sy + f.sh);
        if (index >= 0) owners[p] = index + 1;
      }
      continue;
    }
    if (overlap[owner] < component.length) recoveredComponents++;
    for (const p of component) owners[p] = owner + 1;
    const right = Math.max(f.sx + f.sw, maxX + 1), bottom = Math.max(f.sy + f.sh, maxY + 1);
    f.sx = Math.min(f.sx, minX); f.sy = Math.min(f.sy, minY); f.sw = right - f.sx; f.sh = bottom - f.sy;
  }
  return { pixels, xCuts, yCuts, frames: expanded, owners, recoveredComponents, removed: { faint, specks } };
}

// A rectangular split can leave a small piece of a touching neighboring pose at
// the crop edge. Drop those fragments, preserving the main body and interior effects.
function clearEdgeFragments(pixels, width, height) {
  const seen = new Uint8Array(width * height), q = new Int32Array(seen.length), parts = [];
  for (let at = 0; at < seen.length; at++) {
    if (seen[at] || !pixels[at * 4 + 3]) continue;
    let n = 1, r = 0, edge = false; q[0] = at; seen[at] = 1;
    while (r < n) {
      const p = q[r++], x = p % width, y = Math.floor(p / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edge = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const next = yy * width + xx;
        if (!seen[next] && pixels[next * 4 + 3]) { seen[next] = 1; q[n++] = next; }
      }
    }
    parts.push({ pixels: q.slice(0, n), edge });
  }
  const largest = Math.max(0, ...parts.map(p => p.pixels.length));
  let cleared = 0;
  for (const part of parts) if (part.edge && part.pixels.length < largest * .1) {
    for (const p of part.pixels) { pixels.fill(0, p * 4, p * 4 + 4); cleared++; }
  }
  return cleared;
}

module.exports = { findCuts, cleanPixels, clearEdgeFragments };
