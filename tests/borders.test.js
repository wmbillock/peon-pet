const fs = require('fs');
const path = require('path');
const { BORDERS, byId } = require('../lib/borders');

const ASSETS = path.join(__dirname, '../renderer/assets');

test('every border id is unique and its file exists', () => {
  expect(new Set(BORDERS.map((b) => b.id)).size).toBe(BORDERS.length);
  for (const b of BORDERS) {
    if (b.file) expect({ id: b.id, exists: fs.existsSync(path.join(ASSETS, b.file)) }).toEqual({ id: b.id, exists: true });
  }
});

test('"default" exists and defers to the pet; byId rejects unknown ids', () => {
  expect(byId('default').file).toBeNull();
  expect(byId('nope')).toBeUndefined();
  expect(byId('__proto__')).toBeUndefined();
});

test('generated borders are 200×200 RGBA with a transparent centre', () => {
  const { createCanvas, loadImage } = require('canvas');
  return Promise.all(BORDERS.filter((b) => b.file && b.file.startsWith('borders/')).map(async (b) => {
    const img = await loadImage(path.join(ASSETS, b.file));
    expect([img.width, img.height]).toEqual([200, 200]);
    const c = createCanvas(200, 200); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    expect({ id: b.id, centreAlpha: x.getImageData(100, 100, 1, 1).data[3] }).toEqual({ id: b.id, centreAlpha: 0 });
  }));
});
