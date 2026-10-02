const { computeCornerBounds } = require('../lib/corner-window');

const WA = { x: 0, y: 25, width: 1440, height: 875 };   // a laptop work area under the menu bar
const bounds = (x, y, width = 200, height = 200) => ({ x, y, width, height });

test('parked bottom-left: grows up and to the right, bottom-left corner fixed', () => {
  const b = bounds(20, 675);                              // bottom edge at 875
  expect(computeCornerBounds(b, WA, 344, 500)).toEqual({ x: 20, y: 375, width: 344, height: 500 });
});

test('parked bottom-right: grows up and to the left', () => {
  const b = bounds(1220, 675);
  expect(computeCornerBounds(b, WA, 344, 500)).toEqual({ x: 1076, y: 375, width: 344, height: 500 });
});

test('parked top-left grows down and right; top-right grows down and left', () => {
  expect(computeCornerBounds(bounds(20, 40), WA, 300, 400)).toMatchObject({ x: 20, y: 40, width: 300, height: 400 });
  expect(computeCornerBounds(bounds(1220, 40), WA, 300, 400)).toMatchObject({ x: 1120, y: 40, width: 300, height: 400 });
});

test('shrinking back to the pet size returns to the same corner position', () => {
  const grown = computeCornerBounds(bounds(20, 675), WA, 344, 500);
  expect(computeCornerBounds(grown, WA, 200, 200)).toEqual(bounds(20, 675));
});

test('clamps to min/max and to the work area, never leaving the screen', () => {
  expect(computeCornerBounds(bounds(20, 675), WA, 10, 10)).toMatchObject({ width: 200, height: 200 });
  expect(computeCornerBounds(bounds(20, 675), WA, 5000, 5000)).toMatchObject({ width: 560, height: 700 });
  const small = { x: 0, y: 0, width: 400, height: 300 };
  expect(computeCornerBounds(bounds(0, 0), small, 560, 700)).toMatchObject({ width: 400, height: 300, x: 0, y: 0 });
  const b = computeCornerBounds(bounds(1400, 860), WA, 300, 300);     // nudged off the edge by the resize
  expect(b.x + b.width).toBeLessThanOrEqual(WA.x + WA.width);
  expect(b.y + b.height).toBeLessThanOrEqual(WA.y + WA.height);
});

test('garbage sizes fall back to the minimum', () => {
  expect(computeCornerBounds(bounds(20, 675), WA, NaN, undefined)).toMatchObject({ width: 200, height: 200 });
});
