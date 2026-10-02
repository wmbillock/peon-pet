const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const { importExtraRow } = require('../lib/extras-import');
const { createPetsService } = require('../lib/pets-service');
const { buildExtraPrompt } = require('../lib/character-gen');
const BUNDLED = require('../lib/bundled-characters');

const ASSETS = path.join(__dirname, '../renderer/assets');
let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extras-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const strip = (name, w, h, color) => {
  const c = createCanvas(w, h); const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h);
  const f = path.join(dir, name); fs.writeFileSync(f, c.toBuffer('image/png')); return f;
};
const pixel = async (file, x, y) => {
  const img = await loadImage(file); const c = createCanvas(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  return [...g.getImageData(x, y, 1, 1).data]; };

describe('importExtraRow', () => {
  test('creates a sheet, appends rows, and replaces a row in place', async () => {
    const root = path.join(dir, 'chars');
    const a = await importExtraRow({ slug: 'x', strip: strip('a.png', 600, 100, '#ff0000'), customRoot: root });
    expect(a).toMatchObject({ row: 0, rows: 1, cell: 100 });
    const b = await importExtraRow({ slug: 'x', strip: strip('b.png', 600, 100, '#00ff00'), customRoot: root });
    expect(b).toMatchObject({ row: 1, rows: 2 });
    const c = await importExtraRow({ slug: 'x', strip: strip('c.png', 600, 100, '#0000ff'), customRoot: root, row: 0 });
    expect(c).toMatchObject({ row: 0, rows: 2 });
    const file = path.join(root, 'x', 'extras.png');
    expect((await pixel(file, 10, 10)).slice(0, 3)).toEqual([0, 0, 255]);      // row 0 replaced
    expect((await pixel(file, 10, 110)).slice(0, 3)).toEqual([0, 255, 0]);     // row 1 survived
  });

  test('extends the bundled sheet instead of discarding it', async () => {
    const bundled = path.join(ASSETS, 'bearded-dragon-extras.png');
    const r = await importExtraRow({ slug: 'bearded-dragon', strip: strip('w.png', 3072, 512, '#ff00ff'), customRoot: path.join(dir, 'chars'), bundledExtras: bundled });
    expect(r).toMatchObject({ row: 1, rows: 2, cell: 512 });
  });

  test('rejects wrong-shaped strips, and keys out a chroma backdrop', async () => {
    await expect(importExtraRow({ slug: 'x', strip: strip('sq.png', 300, 300, '#fff'), customRoot: dir })).rejects.toThrow(/6:1/);
    const r = await importExtraRow({ slug: 'y', strip: strip('m.png', 600, 100, '#ff00ff'), customRoot: path.join(dir, 'c2'), chroma: '#FF00FF' });
    expect((await pixel(path.join(dir, 'c2', 'y', 'extras.png'), 5, 5))[3]).toBe(0);
    expect(r.warnings).toEqual([]);
  });
});

test('buildExtraPrompt describes the action, loops back to the working pose, and validates', () => {
  const p = buildExtraPrompt({ name: 'wave', description: 'A bearded dragon.', action: 'waves one arm in a friendly hello', activity: 'typing on a laptop' });
  expect(p).toContain('ANIMATION — WAVE');
  expect(p).toContain('waves one arm in a friendly hello');
  expect(p).toMatch(/Frame 1 and frame 6 are the character's normal working pose/);
  expect(() => buildExtraPrompt({ name: 'w', description: 'A bearded dragon.', action: '' })).toThrow(/Describe the action/);
});

describe('service', () => {
  test('importExtra registers a wave next to the beardie\'s bundled head bob', async () => {
    const svc = createPetsService({ userDataDir: path.join(dir, 'ud'), assetsDir: ASSETS, bundled: BUNDLED });
    svc.seed('bearded-dragon');
    await svc.importExtra({ slug: 'bearded-dragon', name: 'Wave', strip: strip('wave.png', 3072, 512, '#ff00ff'), triggers: ['SessionStart'], fps: 8 });
    const extras = svc.species.get('bearded-dragon').extras;
    expect(extras.map((e) => e.name)).toEqual(['headbob', 'wave']);
    expect(extras[1]).toMatchObject({ row: 1, fps: 8, triggers: ['SessionStart'] });
    expect(svc.lookOf(svc.lead()).extras).toHaveLength(2);
    // The custom sheet now wins over the bundled one and still has the bob on row 0.
    expect(svc.resolveAsset('extras.png')).toBe(path.join(dir, 'ud', 'characters', 'bearded-dragon', 'extras.png'));
    // Re-importing "wave" replaces its row and keeps the user's trigger settings.
    await svc.importExtra({ slug: 'bearded-dragon', name: 'wave', strip: strip('wave2.png', 3072, 512, '#00ff00') });
    const again = svc.species.get('bearded-dragon').extras.find((e) => e.name === 'wave');
    expect(again).toMatchObject({ row: 1, triggers: ['SessionStart'] });
  });

  test('prompt kind "extra" uses the species fields', () => {
    const svc = createPetsService({ userDataDir: path.join(dir, 'ud'), assetsDir: ASSETS, bundled: BUNDLED });
    svc.seed('orc');
    expect(svc.prompt({ kind: 'extra', slug: 'bearded-dragon', spec: { name: 'wave', action: 'waves hello' } })).toContain('waves hello');
  });
});
