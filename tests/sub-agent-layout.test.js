const { subAgentSlot } = require('../lib/sub-agent-layout');
const area = { x: 0, y: 25, width: 1920, height: 1055 };

test('mini pets line up on the left of the lead pet, top-aligned, then wrap to another column', () => {
  const pet = { x: 1367, y: 167, width: 200, height: 200 };
  expect(subAgentSlot(pet, area, 0)).toEqual({ x: 1261, y: 167 });
  expect(subAgentSlot(pet, area, 1)).toEqual({ x: 1261, y: 273 });
  const perCol = Math.floor(area.height / 106);
  expect(subAgentSlot(pet, area, perCol).x).toBe(1155);
});

test('a pet against the left edge gets its mini pets on the right; everything stays on screen', () => {
  const pet = { x: 0, y: 900, width: 200, height: 200 };
  const p = subAgentSlot(pet, area, 0);
  expect(p.x).toBe(206);
  for (let n = 0; n < 30; n++) {
    const q = subAgentSlot(pet, area, n);
    expect(q.x).toBeGreaterThanOrEqual(area.x); expect(q.x + 100).toBeLessThanOrEqual(area.x + area.width);
    expect(q.y).toBeGreaterThanOrEqual(area.y); expect(q.y + 100).toBeLessThanOrEqual(area.y + area.height);
  }
});
