const { planArmy, armyPosition, clampToArea, ARMY_SIZE } = require('../lib/army');

test('planArmy opens missing roots, closes departed ones, and caps the count', () => {
  expect(planArmy(['a', 'b', 'c'], ['b', 'x'])).toEqual({ open: ['a', 'c'], close: ['x'] });
  expect(planArmy(['a', 'b', 'c'], ['c'], 2)).toEqual({ open: ['a', 'b'], close: ['c'] });
  expect(planArmy([], [])).toEqual({ open: [], close: [] });
});

test('armyPosition fills the bottom row right to left, then wraps upward', () => {
  const wa = { x: 0, y: 0, width: 640, height: 400 };   // (150+8) → 4 per row
  const p = (i) => armyPosition(i, wa);
  expect(p(0)).toEqual({ x: 640 - ARMY_SIZE.w, y: 400 - ARMY_SIZE.h });
  expect(p(1).x).toBe(p(0).x - ARMY_SIZE.w - 8);
  expect(p(1).y).toBe(p(0).y);
  expect(p(4).x).toBe(p(0).x);
  expect(p(4).y).toBe(p(0).y - ARMY_SIZE.h - 8);
});

test('clampToArea pulls a stale position back on screen', () => {
  const wa = { x: 0, y: 25, width: 800, height: 600 };
  expect(clampToArea({ x: 5000, y: -40 }, wa)).toEqual({ x: 800 - ARMY_SIZE.w, y: 25 });
  expect(clampToArea({ x: 100, y: 200 }, wa)).toEqual({ x: 100, y: 200 });
});
