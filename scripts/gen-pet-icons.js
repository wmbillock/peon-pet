// Generates <name>-dock-icon.png (256×256) for bundled pets from the first typing frame of their atlas.
//   node scripts/gen-pet-icons.js retro-robot terra-ff6 ...
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '../renderer/assets');
const TYPING_ROW = 2;
const SIZE = 256;

(async () => {
  for (const name of process.argv.slice(2)) {
    const img = await loadImage(path.join(ASSETS, `${name}-sprite-atlas.png`));
    const cell = img.width / 6;
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, TYPING_ROW * cell, cell, cell, 0, 0, SIZE, SIZE);
    fs.writeFileSync(path.join(ASSETS, `${name}-dock-icon.png`), canvas.toBuffer('image/png'));
    console.log(`wrote ${name}-dock-icon.png`);
  }
})();
