const { warpRegion, BOB_OFFSETS } = require('../lib/bob');

const W = 64, H = 64;
// Vertical gradient image: pixel value encodes its row, so displacement is directly measurable.
const gradient = () => {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; d[o] = y * 3; d[o + 3] = 255; }
  return d;
};

test('moves the centre of the region by dy and leaves far pixels untouched', () => {
  const src = gradient(), dst = new Uint8ClampedArray(src.length);
  warpRegion(src, dst, W, H, { cx: 32, cy: 32, sigma: 6 }, -6);
  const at = (buf, x, y) => buf[(y * W + x) * 4];
  expect(at(dst, 32, 32)).toBeCloseTo(at(src, 32, 38), 0);   // content from 6px below now sits at the centre (moved up)
  expect(at(dst, 2, 2)).toBe(at(src, 2, 2));                   // far corner unchanged
  expect(at(dst, 60, 60)).toBe(at(src, 60, 60));
});

test('zero offset is the identity; input is not mutated', () => {
  const src = gradient(), copy = Uint8ClampedArray.from(src), dst = new Uint8ClampedArray(src.length);
  warpRegion(src, dst, W, H, { cx: 20, cy: 20, sigma: 8 }, 0);
  expect(Buffer.from(dst).equals(Buffer.from(src))).toBe(true);
  expect(Buffer.from(src).equals(Buffer.from(copy))).toBe(true);
});

test('stays in bounds near edges', () => {
  const src = gradient(), dst = new Uint8ClampedArray(src.length);
  expect(() => warpRegion(src, dst, W, H, { cx: 1, cy: 1, sigma: 10 }, -12)).not.toThrow();
  expect(() => warpRegion(src, dst, W, H, { cx: 63, cy: 63, sigma: 10 }, 12)).not.toThrow();
});

test('the bob cycle starts near rest and returns to rest', () => {
  expect(BOB_OFFSETS).toHaveLength(6);
  expect(Math.abs(BOB_OFFSETS[0])).toBeLessThan(5);
  expect(BOB_OFFSETS[5]).toBe(0);
  expect(Math.min(...BOB_OFFSETS)).toBeLessThan(-10);
});
