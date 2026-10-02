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

module.exports = { warpRegion, BOB_OFFSETS };
