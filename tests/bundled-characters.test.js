const fs = require('fs');
const path = require('path');
const BUNDLED = require('../lib/bundled-characters');

const ASSETS = path.join(__dirname, '../renderer/assets');

test('every bundled character maps to files that exist', () => {
  for (const [name, map] of Object.entries(BUNDLED)) {
    expect(map['sprite-atlas.png']).toBeTruthy();
    for (const [canonical, file] of Object.entries(map)) {
      expect({ name, canonical, exists: fs.existsSync(path.join(ASSETS, file)) }).toEqual({ name, canonical, exists: true });
    }
  }
});

test('orc defines every asset others may fall back to', () => {
  expect(Object.keys(BUNDLED.orc).sort()).toEqual(['bg.png', 'borders.png', 'dock-icon.png', 'sprite-atlas.png']);
});

// The renderer addresses frames by UV fraction, so sides needn't divide evenly by 6 (the orc is 4096).
test('bundled atlases are square and big enough for a 6×6 grid of 64px+ cells', () => {
  for (const [name, map] of Object.entries(BUNDLED)) {
    const buf = fs.readFileSync(path.join(ASSETS, map['sprite-atlas.png']));
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    expect({ name, square: w === h, bigEnough: w >= 6 * 64 }).toEqual({ name, square: true, bigEnough: true });
  }
});
