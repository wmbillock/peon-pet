const { cleanPixels, findCuts, clearEdgeFragments } = require('../lib/sprite-cleanup');
const { frameUVs } = require('../lib/frame-uv');

test('recovers a character whose feet cross the assumed row boundary', () => {
  const w = 120, p = new Uint8ClampedArray(w * w * 4);
  // First row ends below nominal y=20; the second row begins at y=28.
  for (let y = 8; y <= 23; y++) for (let x = 4; x <= 15; x++) p[(y * w + x) * 4 + 3] = 255;
  for (let y = 28; y <= 38; y++) for (let x = 4; x <= 15; x++) p[(y * w + x) * 4 + 3] = 255;
  const r = cleanPixels(p, w, w);
  expect(r.yCuts[1]).toBeGreaterThan(23);
  expect(r.yCuts[1]).toBeLessThan(28);
  expect(r.pixels[(23 * w + 10) * 4 + 3]).toBe(255);
});

test('removes faint matte and isolated specks while preserving connected detail and sleep marks', () => {
  const w = 120, p = new Uint8ClampedArray(w * w * 4);
  for (let y = 8; y < 15; y++) for (let x = 5; x < 10; x++) p[(y * w + x) * 4 + 3] = 255;
  for (let y = 2; y < 5; y++) for (let x = 12; x < 15; x++) p[(y * w + x) * 4 + 3] = 255;
  p[(10 * w + 10) * 4 + 3] = 255; // single connected outline pixel
  p[(30 * w + 30) * 4 + 3] = 255;
  p[(31 * w + 31) * 4 + 3] = 1;
  const r = cleanPixels(p, w, w);
  expect(r.pixels[(10 * w + 10) * 4 + 3]).toBe(255);
  expect(r.pixels[(2 * w + 12) * 4 + 3]).toBe(255);
  expect(r.removed).toEqual({ faint: 1, specks: 1 });
});

test('equal transparent gutters retain the nominal grid', () => {
  expect(findCuts(new Int32Array(120))).toEqual([0, 20, 40, 60, 80, 100, 120]);
});

test('drops a neighboring fragment at the edge and keeps a small interior effect', () => {
  const w = 20, p = new Uint8ClampedArray(w * w * 4);
  for (let y = 6; y < 16; y++) for (let x = 6; x < 16; x++) p[(y * w + x) * 4 + 3] = 255;
  for (let x = 0; x < 4; x++) p[x * 4 + 3] = 255;
  p[(2 * w + 12) * 4 + 3] = 255;
  expect(clearEdgeFragments(p, w, w)).toBe(4);
  expect(p[(2 * w + 12) * 4 + 3]).toBe(255);
  expect(p[(8 * w + 8) * 4 + 3]).toBe(255);
});

test.each([1254, 1536, 3072])('all 36 UVs stay inside their own source texels at %ipx', size => {
  const cell = size / 6;
  for (let row = 0; row < 6; row++) for (let col = 0; col < 6; col++) {
    const uv = frameUVs(col, row, 6, 6, size, size);
    expect(uv.u0 * size).toBeCloseTo(col * cell + .5);
    expect(uv.u1 * size).toBeCloseTo((col + 1) * cell - .5);
    expect((1 - uv.v1) * size).toBeCloseTo(row * cell + .5);
    expect((1 - uv.v0) * size).toBeCloseTo((row + 1) * cell - .5);
  }
});

test('single-row extras use their actual sheet height', () => {
  expect(frameUVs(5, 0, 6, 1, 1254, 209)).toEqual({ u0: 5 / 6 + .5 / 1254, u1: 1 - .5 / 1254, v0: .5 / 209, v1: 1 - .5 / 209 });
});
