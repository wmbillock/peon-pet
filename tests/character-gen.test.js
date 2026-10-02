const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCanvas } = require('canvas');
const { buildAtlasPrompt, buildStripPrompt, ROWS } = require('../lib/character-gen');
const { importCharacter } = require('../lib/character-import');
const { ANIM_CONFIG } = require('../lib/anim-state');

const spec = { name: 'wizard-cat', description: 'A fluffy grey tabby cat in a wizard hat.' };

test('ROWS follow the renderer animation order', () => {
  expect(ROWS.map((r) => r.anim)).toEqual(Object.keys(ANIM_CONFIG));
});

test('atlas prompt states exact grid + size and covers all six rows', () => {
  const p = buildAtlasPrompt({ ...spec, cell: 256 });
  expect(p).toMatch(/EXACTLY 6 columns × 6 rows/);
  expect(p).toMatch(/1536×1536/);
  expect(p).toContain(spec.description);
  for (const r of ROWS) expect(p).toContain(r.anim.toUpperCase());
});

test('strip prompt targets one row; bad input is rejected', () => {
  const p = buildStripPrompt({ ...spec, row: 3 });
  expect(p).toMatch(/ALARMED/);
  expect(p).not.toMatch(/SLEEPING/);
  expect(() => buildStripPrompt({ ...spec, row: 9 })).toThrow(/row must be/);
  expect(() => buildAtlasPrompt({ name: 'bad name', description: 'long enough description' })).toThrow(/name/);
  expect(() => buildAtlasPrompt({ name: 'x', description: 'short' })).toThrow(/short/);
});

describe('importCharacter', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'import-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  const png = (name, w, h) => {
    const c = createCanvas(w, h);
    const x = c.getContext('2d');
    x.fillStyle = '#336699'; x.fillRect(0, 0, w, h);
    const f = path.join(tmp, name);
    fs.writeFileSync(f, c.toBuffer('image/png'));
    return f;
  };

  test('imports a full atlas, capping size at a multiple of 6 and writing an icon', async () => {
    const r = await importCharacter({ name: 'cat', atlas: png('a.png', 3072, 3072), destRoot: path.join(tmp, 'out') });
    expect(r.size).toBe(1536);
    expect(r.cell).toBe(256);
    expect(fs.existsSync(path.join(tmp, 'out/cat/sprite-atlas.png'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'out/cat/dock-icon.png'))).toBe(true);
  });

  test('stacks six strips into one atlas', async () => {
    const strips = [0, 1, 2, 3, 4, 5].map((i) => png(`s${i}.png`, 600, 100));
    const r = await importCharacter({ name: 'cat', strips, destRoot: path.join(tmp, 'out') });
    expect(r.size).toBe(600);
    expect(r.cell).toBe(100);
  });

  test('rejects a wrong-shaped atlas (e.g. 8 columns), bad names, and wrong strip counts', async () => {
    await expect(importCharacter({ name: 'cat', atlas: png('wide.png', 4096, 3072), destRoot: tmp })).rejects.toThrow(/grid wrong/);
    await expect(importCharacter({ name: '../x', atlas: png('b.png', 600, 600), destRoot: tmp })).rejects.toThrow(/name/);
    await expect(importCharacter({ name: 'cat', strips: [png('c.png', 600, 100)], destRoot: tmp })).rejects.toThrow(/Need 6/);
  });
});
