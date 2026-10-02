const { ANIM_CONFIG, ATLAS_COLS, ATLAS_ROWS } = require('./anim-state');
const { SIZE } = require('./pixoo');

// Electron's bitmap is BGRA. Pixel art has hard edges, so without a background we threshold alpha
// rather than blending onto black (avoids dark fringes on the LED matrix). With a background
// (cutout pets on their environment) we alpha-composite onto it.
function bgraToRgb(bgra, bgRgb = null) {
  const out = Buffer.alloc(SIZE * SIZE * 3);
  for (let i = 0, o = 0; i < SIZE * SIZE * 4; i += 4, o += 3) {
    const a = bgra[i + 3];
    if (bgRgb) {
      const t = a / 255;
      out[o] = Math.round(bgra[i + 2] * t + bgRgb[o] * (1 - t));
      out[o + 1] = Math.round(bgra[i + 1] * t + bgRgb[o + 1] * (1 - t));
      out[o + 2] = Math.round(bgra[i] * t + bgRgb[o + 2] * (1 - t));
    } else if (a >= 128) {
      out[o] = bgra[i + 2]; out[o + 1] = bgra[i + 1]; out[o + 2] = bgra[i];
    }
  }
  return out;
}

function loadBackground(nativeImage, bgPath) {
  if (!bgPath) return null;
  const img = nativeImage.createFromPath(bgPath);
  if (img.isEmpty()) return null;
  return bgraToRgb(img.resize({ width: SIZE, height: SIZE, quality: 'best' }).toBitmap());
}

// 64×64 RGB frames for one animation row of the sprite atlas, plus its frame delay in ms.
function buildAnimFrames(nativeImage, atlasPath, anim, { bgPath = null } = {}) {
  const cfg = ANIM_CONFIG[anim] || ANIM_CONFIG.sleeping;
  const img = nativeImage.createFromPath(atlasPath);
  if (img.isEmpty()) throw new Error(`Cannot read sprite atlas ${atlasPath}`);
  const bg = loadBackground(nativeImage, bgPath);
  const { width, height } = img.getSize();
  const fw = Math.floor(width / ATLAS_COLS);
  const fh = Math.floor(height / ATLAS_ROWS);
  const frames = [];
  for (let f = 0; f < cfg.frames; f++) {
    const cell = img.crop({ x: f * fw, y: cfg.row * fh, width: fw, height: fh })
      .resize({ width: SIZE, height: SIZE, quality: 'best' });
    frames.push(bgraToRgb(cell.toBitmap(), bg));
  }
  return { frames, speedMs: Math.round(1000 / cfg.fps) };
}

module.exports = { buildAnimFrames, bgraToRgb };
