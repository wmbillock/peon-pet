// Chroma-key a flat backdrop colour out of RGBA pixel data (in place). Image models can't output
// real transparency, so cutout sheets are generated on solid magenta and keyed here.
const KEY_DEFAULT = [255, 0, 255];

function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) throw new Error('Chroma colour must be a hex colour like #ff00ff');
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Pixels within `tolerance` (RGB distance) of the key become transparent; the next `soft` band
// fades out and is de-spilled so edges don't keep a magenta halo.
function keyOutChroma(data, { color = KEY_DEFAULT, tolerance = 70, soft = 60 } = {}) {
  const [kr, kg, kb] = color;
  let cleared = 0;
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - kr, dg = data[i + 1] - kg, db = data[i + 2] - kb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist <= tolerance) { data[i + 3] = 0; cleared++; continue; }
    if (dist < tolerance + soft) {
      const a = (dist - tolerance) / soft;
      data[i + 3] = Math.round(data[i + 3] * a);
      // Spill: pull the key channels back toward the non-key channel(s).
      const g = data[i + 1];
      if (kr > 200 && kb > 200 && kg < 80) { data[i] = Math.min(data[i], g + 40); data[i + 2] = Math.min(data[i + 2], g + 40); }
    }
  }
  return cleared;
}

function hasTransparency(data, sampleStep = 4 * 17) {
  for (let i = 3; i < data.length; i += sampleStep) if (data[i] < 250) return true;
  return false;
}

module.exports = { keyOutChroma, parseHex, hasTransparency, KEY_DEFAULT };
