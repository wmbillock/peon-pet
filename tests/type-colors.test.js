const { hueOfType, typeColors, CATEGORY_HUE } = require('../lib/type-colors');

test('a kind\'s own hue wins; otherwise its role\'s colour, nudged by name so kinds of one role differ', () => {
  expect(hueOfType({ slug: 'x', category: 'worker', hue: 90 })).toBe(90);
  expect(hueOfType({ slug: 'x', category: 'worker', hue: 725 })).toBe(5);
  const a = hueOfType({ slug: 'smith', category: 'worker' }), b = hueOfType({ slug: 'tinker', category: 'worker' });
  expect(Math.abs(a - CATEGORY_HUE.worker)).toBeLessThanOrEqual(20);
  expect(Math.abs(b - CATEGORY_HUE.worker)).toBeLessThanOrEqual(20);
  expect(hueOfType('inspector')).toBe(CATEGORY_HUE.inspector);
  expect(hueOfType(null)).toBe(200);
});

test('colours follow the hue', () => {
  expect(typeColors(120)).toMatchObject({ hue: 120, ring: 'hsl(120 75% 58%)', plate: 'hsl(120 42% 27%)' });
});
