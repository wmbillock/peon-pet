const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCanvas } = require('canvas');
const { createSpeciesStore, slugify } = require('../lib/species');
const { createEnvironStore, importEnvironment } = require('../lib/environs');
const { importCharacter } = require('../lib/character-import');
const { keyOutChroma, parseHex, hasTransparency } = require('../lib/chroma');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spenv-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const png = (name, w, h, paint) => {
  const c = createCanvas(w, h); const x = c.getContext('2d'); paint(x, w, h);
  const f = path.join(dir, name); fs.writeFileSync(f, c.toBuffer('image/png')); return f;
};

describe('species store', () => {
  const make = (sheets = ['orc', 'bearded-dragon']) => createSpeciesStore({
    file: path.join(dir, 'species.json'), bundledNames: ['orc', 'bearded-dragon'], hasSheet: (s) => sheets.includes(s),
  });

  test('built-ins get friendly names and facts; edits persist as overrides without touching defaults', () => {
    const st = make();
    expect(st.get('bearded-dragon')).toMatchObject({ display: 'Beardie', builtin: true, ready: true, layout: 'baked', setting: 'desk' });
    st.update('bearded-dragon', { display: 'Spike the Beardie', facts: [{ key: 'Mood', value: 'regal' }], activity: 'basking under a heat lamp', setting: 'free', layout: 'cutout', defaultEnv: 'terrarium', localOnly: true });
    const again = make().get('bearded-dragon');
    expect(again).toMatchObject({ display: 'Spike the Beardie', activity: 'basking under a heat lamp', setting: 'free', layout: 'cutout', defaultEnv: 'terrarium', localOnly: true });
    expect(again.facts).toEqual([{ key: 'Mood', value: 'regal' }]);
    expect(make().get('orc').display).toBe('Orc Peon');
  });

  test('validates input', () => {
    const st = make();
    expect(() => st.update('orc', { display: '  ' })).toThrow(/empty/);
    expect(() => st.update('orc', { setting: 'moon' })).toThrow(/desk or free/);
    expect(() => st.update('orc', { layout: 'weird' })).toThrow(/baked or cutout/);
    expect(() => st.update('../x', { display: 'x' })).toThrow(/Invalid/);
    expect(st.get('../x')).toBeNull();
  });

  test('drafts: created from a name, listed as not ready, removable; built-ins are not', () => {
    const st = make();
    const d = st.createDraft({ display: 'Jazz Trumpet', brief: 'A trumpet' });
    expect(d).toMatchObject({ slug: 'jazz-trumpet', draft: true, ready: false });
    expect(st.createDraft({ display: 'Jazz Trumpet' }).slug).toBe('jazz-trumpet-2');
    st.removeDraft('jazz-trumpet');
    expect(st.get('jazz-trumpet')).toBeNull();
    expect(() => st.removeDraft('orc')).toThrow(/drafts/);
  });

  test('slugify is safe', () => {
    expect(slugify('Terra (FFVI)!')).toBe('terra-ffvi');
    expect(slugify('***')).toBe('pet');
    expect(slugify('__proto__')).toBe('proto');
  });
});

describe('environments', () => {
  const make = () => createEnvironStore({
    file: path.join(dir, 'environs.json'), dir: path.join(dir, 'env'),
    builtins: [{ id: 'dungeon', display: 'Dungeon', description: 'Stone walls', path: '/x/bg.png' }],
  });

  test('imports a non-square image as a cropped square and lists it with metadata', async () => {
    const src = png('wide.png', 1600, 900, (x, w, h) => { x.fillStyle = '#446'; x.fillRect(0, 0, w, h); });
    const store = make();
    const id = store.newId('Jazz Club!');
    const r = await importEnvironment({ source: src, destFile: path.join(dir, 'env', `${id}.png`) });
    expect(r).toMatchObject({ size: 900, cropped: true });
    store.updateMeta(id, { display: 'Jazz Club', description: 'Smoky stage' });
    expect(store.list().map((e) => e.id)).toEqual(['dungeon', 'jazz-club']);
    expect(store.get('jazz-club')).toMatchObject({ display: 'Jazz Club', builtin: false });
    expect(store.has('dungeon')).toBe(true);
    expect(store.has('../etc')).toBe(false);
  });

  test('built-ins cannot be removed; user ones can; ids stay unique', async () => {
    const store = make();
    const src = png('sq.png', 300, 300, (x) => { x.fillStyle = '#464'; x.fillRect(0, 0, 300, 300); });
    await importEnvironment({ source: src, destFile: path.join(dir, 'env', 'meadow.png') });
    expect(store.newId('Meadow')).toBe('meadow-2');
    expect(() => store.remove('dungeon')).toThrow(/Built-in/);
    store.remove('meadow');
    expect(store.has('meadow')).toBe(false);
  });
});

describe('chroma key + cutout import', () => {
  test('keys out the backdrop, keeps the subject, fades the edge', () => {
    const data = new Uint8ClampedArray([255, 0, 255, 255,  10, 200, 30, 255,  250, 20, 250, 255,  255, 80, 200, 255]);
    const cleared = keyOutChroma(data, { color: parseHex('#ff00ff') });
    expect(cleared).toBe(2);
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(255);
    expect(data[11]).toBe(0);
    expect(data[15]).toBeGreaterThan(0);   // near-magenta edge: partial alpha
    expect(data[15]).toBeLessThan(255);
    expect(() => parseHex('purple')).toThrow(/hex/);
  });

  test('importing a magenta-backdrop sheet yields a transparent cutout atlas', async () => {
    const sheet = png('cut.png', 600, 600, (x, w, h) => {
      x.fillStyle = '#ff00ff'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#22aa22'; x.fillRect(30, 30, 40, 40);
    });
    const r = await importCharacter({ name: 'cutie', atlas: sheet, destRoot: path.join(dir, 'chars'), chroma: '#ff00ff' });
    expect(r.layout).toBe('cutout');
    const { loadImage } = require('canvas');
    const img = await loadImage(path.join(r.dir, 'sprite-atlas.png'));
    const c = createCanvas(img.width, img.height); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    expect(hasTransparency(x.getImageData(0, 0, img.width, img.height).data, 4)).toBe(true);
    expect(x.getImageData(2, 2, 1, 1).data[3]).toBe(0);
  });

  test('an opaque sheet imports as baked', async () => {
    const sheet = png('baked.png', 600, 600, (x, w, h) => { x.fillStyle = '#334'; x.fillRect(0, 0, w, h); });
    expect((await importCharacter({ name: 'bk', atlas: sheet, destRoot: path.join(dir, 'chars') })).layout).toBe('baked');
  });
});

describe('extra animations', () => {
  const { cleanExtras } = require('../lib/species');
  const make = () => createSpeciesStore({ file: path.join(dir, 'species.json'), bundledNames: ['bearded-dragon'], hasSheet: () => true });

  test('the beardie ships a head bob and a wave', () => {
    expect(make().get('bearded-dragon').extras).toEqual([
      { name: 'headbob', row: 0, fps: 10, loops: 2, triggers: ['SubagentStart', 'flourish'] },
      { name: 'wave', row: 1, fps: 8, loops: 2, triggers: ['SessionStart'] }]);
  });

  test('cleanExtras normalises and validates', () => {
    expect(cleanExtras([{ name: ' Wave ', row: 1, fps: 99, loops: 0, triggers: ['SessionStart', 'bogus', 'SessionStart'] }]))
      .toEqual([{ name: 'wave', row: 1, fps: 30, loops: 1, triggers: ['SessionStart'] }]);
    expect(cleanExtras([{ name: 'x', row: 0 }])[0]).toMatchObject({ fps: 10, loops: 1, triggers: [] });
    expect(() => cleanExtras([{ name: 'Bad Name!', row: 0 }])).toThrow(/Invalid extra/);
    expect(() => cleanExtras([{ name: 'a', row: 0 }, { name: 'a', row: 1 }])).toThrow(/Duplicate/);
    expect(() => cleanExtras([{ name: 'a', row: 99 }])).toThrow(/0-15/);
    expect(() => cleanExtras('nope')).toThrow(/list/);
  });

  test('update persists extras, overriding the defaults', () => {
    const st = make();
    st.update('bearded-dragon', { extras: [{ name: 'wave', row: 1, fps: 8, loops: 1, triggers: ['SessionStart'] }] });
    expect(make().get('bearded-dragon').extras.map((e) => e.name)).toEqual(['wave']);
  });
});
