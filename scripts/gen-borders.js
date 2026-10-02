// Generates the pixel-art border overlays in renderer/assets/borders/ (200×200 RGBA, transparent centre).
//   node scripts/gen-borders.js
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const SIZE = 200;
const OUT = path.join(__dirname, '../renderer/assets/borders');

// Seeded PRNG so regenerating gives identical files.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function make(draw) {
  const c = createCanvas(SIZE, SIZE);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  return c;
}

// Concentric rectangular rings, outermost first: [[color, thickness], ...]. Returns total thickness.
function rings(ctx, bands) {
  let inset = 0;
  for (const [color, t] of bands) {
    ctx.fillStyle = color;
    ctx.fillRect(inset, inset, SIZE - 2 * inset, t);
    ctx.fillRect(inset, SIZE - inset - t, SIZE - 2 * inset, t);
    ctx.fillRect(inset, inset + t, t, SIZE - 2 * inset - 2 * t);
    ctx.fillRect(SIZE - inset - t, inset + t, t, SIZE - 2 * inset - 2 * t);
    inset += t;
  }
  return inset;
}

// Clear the outside of each corner so the frame has rounded (stepped) corners.
function roundCorners(ctx, r) {
  for (let y = 0; y < r; y++) {
    for (let x = 0; x < r; x++) {
      if ((r - x - 0.5) ** 2 + (r - y - 0.5) ** 2 > r * r) {
        for (const [px, py] of [[x, y], [SIZE - 1 - x, y], [x, SIZE - 1 - y], [SIZE - 1 - x, SIZE - 1 - y]]) ctx.clearRect(px, py, 1, 1);
      }
    }
  }
}

const styles = {
  none: () => make(() => {}),

  thin: () => make((ctx) => {
    rings(ctx, [['#0a0a10', 2], ['#6a6a8c', 1], ['#2a2a3c', 1]]);
    roundCorners(ctx, 6);
  }),

  gold: () => make((ctx) => {
    rings(ctx, [['#2a1a05', 2], ['#7a5412', 2], ['#d9a521', 2], ['#ffe27a', 1], ['#a06c10', 1], ['#3a2606', 2]]);
    for (const [x, y] of [[0, 0], [SIZE - 14, 0], [0, SIZE - 14], [SIZE - 14, SIZE - 14]]) {
      ctx.fillStyle = '#2a1a05'; ctx.fillRect(x, y, 14, 14);
      ctx.fillStyle = '#d9a521'; ctx.fillRect(x + 2, y + 2, 10, 10);
      ctx.fillStyle = '#ffe27a'; ctx.fillRect(x + 3, y + 3, 4, 4);
    }
  }),

  'neon-cyan': () => neon('0,240,255', '#00f0ff', '#e8ffff'),
  'neon-pink': () => neon('255,43,214', '#ff2bd6', '#ffe3fa'),

  stone: () => make((ctx) => {
    const r = rng(7);
    const greys = ['#5b5b66', '#6c6c78', '#4a4a54', '#7b7b86', '#55555f'];
    const T = 12;
    for (let y = 0; y < SIZE; y += 4) {
      for (let x = 0; x < SIZE; x += 4) {
        if (x >= T && x < SIZE - T && y >= T && y < SIZE - T) continue;
        ctx.fillStyle = greys[Math.floor(r() * greys.length)];
        ctx.fillRect(x, y, 4, 4);
      }
    }
    ctx.fillStyle = '#25252c';  // mortar lines every 12px
    for (let i = 0; i < SIZE; i += 12) {
      ctx.fillRect(i, 5, 12, 1); ctx.fillRect(i, SIZE - 6, 12, 1);
      ctx.fillRect(5, i, 1, 12); ctx.fillRect(SIZE - 6, i, 1, 12);
    }
    rings(ctx, [['#15151a', 2]]);
    ctx.fillStyle = '#15151a';
    ctx.fillRect(T - 1, T - 1, SIZE - 2 * T + 2, 1); ctx.fillRect(T - 1, SIZE - T, SIZE - 2 * T + 2, 1);
    ctx.fillRect(T - 1, T - 1, 1, SIZE - 2 * T + 2); ctx.fillRect(SIZE - T, T - 1, 1, SIZE - 2 * T + 2);
  }),

  pastel: () => make((ctx) => {
    rings(ctx, [['#e58ab0', 1], ['#ffc7dd', 6], ['#fff0f6', 1]]);
    ctx.fillStyle = '#ffffff';
    for (let i = 10; i < SIZE - 10; i += 10) {
      ctx.fillRect(i, 3, 3, 3); ctx.fillRect(i, SIZE - 6, 3, 3);
      ctx.fillRect(3, i, 3, 3); ctx.fillRect(SIZE - 6, i, 3, 3);
    }
    roundCorners(ctx, 10);
  }),

  crt: () => make((ctx) => {
    rings(ctx, [['#0a0a0e', 2], ['#2b2b36', 8], ['#3c3c4a', 1], ['#000000', 3]]);
    ctx.fillStyle = '#3cff6a'; ctx.fillRect(SIZE - 14, SIZE - 8, 3, 3);
    ctx.fillStyle = '#1a1a22'; ctx.fillRect(SIZE - 24, SIZE - 8, 6, 3);
    roundCorners(ctx, 12);
  }),
};

function neon(rgb, color, hot) {
  return make((ctx) => {
    rings(ctx, [[`rgba(${rgb},0.10)`, 2], [`rgba(${rgb},0.28)`, 2], [color, 2], [hot, 1], [`rgba(0,10,20,0.65)`, 2]]);
    roundCorners(ctx, 8);
  });
}

fs.mkdirSync(OUT, { recursive: true });
for (const [id, build] of Object.entries(styles)) {
  fs.writeFileSync(path.join(OUT, `${id}.png`), build().toBuffer('image/png'));
  console.log(`wrote borders/${id}.png`);
}
