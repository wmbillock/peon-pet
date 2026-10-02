// Procedural "head bob": displace a soft Gaussian region of a frame vertically. Because the field
// falls off smoothly there are no holes or ghost copies to patch — the head moves as a unit and
// the surroundings stretch slightly.
//   src/dst: RGBA Uint8ClampedArray of size w*h*4.  region: { cx, cy, sigma }.  dy: pixels (negative = up).
function warpRegion(src, dst, w, h, { cx, cy, sigma }, dy) {
  const twoSigma2 = 2 * sigma * sigma;
  const reach = Math.ceil(sigma * 3);
  dst.set(src);
  const x0 = Math.max(0, Math.floor(cx - reach)), x1 = Math.min(w - 1, Math.ceil(cx + reach));
  const y0 = Math.max(0, Math.floor(cy - reach - Math.abs(dy))), y1 = Math.min(h - 1, Math.ceil(cy + reach + Math.abs(dy)));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const gx = x - cx, gy = y - cy;
      const wgt = Math.exp(-(gx * gx + gy * gy) / twoSigma2);
      // Inverse mapping: the pixel now at (x, y) came from (x, y - dy*wgt).
      const sy = y - dy * wgt;
      const sy0 = Math.floor(sy), t = sy - sy0;
      const ya = Math.min(h - 1, Math.max(0, sy0)), yb = Math.min(h - 1, Math.max(0, sy0 + 1));
      const o = (y * w + x) * 4, a = (ya * w + x) * 4, b = (yb * w + x) * 4;
      for (let c = 0; c < 4; c++) dst[o + c] = src[a + c] * (1 - t) + src[b + c] * t;
    }
  }
  return dst;
}

// One bob cycle: quick double nod, returns to rest on the last frame.
const BOB_OFFSETS = [-3, -15, -5, -17, -5, 0];

// Like warpRegion but the region moves in both axes: (dx, dy) in pixels. Used for the arm wave, where a soft patch
// around the hand is lifted and carried in a small circle.
function warpRegionXY(src, dst, w, h, { cx, cy, sigma }, dx, dy) {
  const twoSigma2 = 2 * sigma * sigma;
  const reach = Math.ceil(sigma * 3);
  dst.set(src);
  const x0 = Math.max(0, Math.floor(cx - reach - Math.abs(dx))), x1 = Math.min(w - 1, Math.ceil(cx + reach + Math.abs(dx)));
  const y0 = Math.max(0, Math.floor(cy - reach - Math.abs(dy))), y1 = Math.min(h - 1, Math.ceil(cy + reach + Math.abs(dy)));
  const at = (x, y, c) => src[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4 + c];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const gx = x - cx, gy = y - cy;
      const wgt = Math.exp(-(gx * gx + gy * gy) / twoSigma2);
      // The field is evaluated at the destination, which is smooth enough for a small displacement.
      const sx = x - dx * wgt, sy = y - dy * wgt;
      const ix = Math.floor(sx), iy = Math.floor(sy), tx = sx - ix, ty = sy - iy;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = at(ix, iy, c) * (1 - tx) + at(ix + 1, iy, c) * tx;
        const bot = at(ix, iy + 1, c) * (1 - tx) + at(ix + 1, iy + 1, c) * tx;
        dst[o + c] = top * (1 - ty) + bot * ty;
      }
    }
  }
  return dst;
}

// One wave cycle for a 512px cell: the hand lifts, circles, and settles back on the last frame.
const WAVE_OFFSETS = [[4, -12], [16, -24], [8, -32], [-8, -26], [2, -14], [0, 0]];

module.exports = { warpRegion, warpRegionXY, BOB_OFFSETS, WAVE_OFFSETS };
