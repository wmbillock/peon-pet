const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCanvas } = require('canvas');
const { createPetsService } = require('../lib/pets-service');
const BUNDLED = require('../lib/bundled-characters');

let dir, svc;
const ASSETS = path.join(__dirname, '../renderer/assets');
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-'));
  svc = createPetsService({ userDataDir: dir, assetsDir: ASSETS, bundled: BUNDLED });
  svc.seed('orc');
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const png = (name, w, h, fill) => {
  const c = createCanvas(w, h); const x = c.getContext('2d'); fill(x, w, h);
  const f = path.join(dir, name); fs.writeFileSync(f, c.toBuffer('image/png')); return f;
};

test('first run seeds one lead pet; seeding twice is harmless', () => {
  svc.seed('orc');
  expect(svc.pets()).toHaveLength(1);
  expect(svc.lead()).toMatchObject({ species: 'orc', tint: 'none' });
});

test('createPets makes distinct individuals and auto-tints duplicates of a species', () => {
  const made = svc.createPets({ species: 'orc', count: 3 });
  expect(made).toHaveLength(3);
  expect(new Set(made.map((p) => p.name)).size).toBe(3);
  expect(new Set(made.map((p) => p.id)).size).toBe(3);
  expect(made.every((p) => p.tint !== 'none')).toBe(true);
  const solo = svc.createPets({ species: 'bearded-dragon', name: 'Spike' })[0];
  expect(solo).toMatchObject({ name: 'Spike', tint: 'none' });
  const dup = svc.createPets({ species: 'bearded-dragon', name: 'Spike II' })[0];
  expect(dup.tint).not.toBe('none');
  expect(() => svc.createPets({ species: 'nope' })).toThrow(/Unknown species/);
});

test('resolveAsset: lead species by default, ?char= override, orc fallbacks, border override', () => {
  const lead = svc.resolveAsset('sprite-atlas.png');
  expect(lead).toBe(path.join(ASSETS, 'orc-sprite-atlas.png'));
  expect(svc.resolveAsset('sprite-atlas.png', { char: 'terra-ff6' })).toBe(path.join(ASSETS, 'terra-ff6-sprite-atlas.png'));
  expect(svc.resolveAsset('sprite-atlas.png', { char: '../../etc' })).toBe(lead);   // invalid → lead
  expect(svc.resolveAsset('borders.png', { char: 'lcd-creature' })).toBe(path.join(ASSETS, 'orc-borders.png'));
  expect(svc.resolveAsset('borders.png', { border: 'gold' })).toBe(path.join(ASSETS, 'borders/gold.png'));
  expect(svc.resolveAsset('borders.png', { border: 'default' })).toBe(path.join(ASSETS, 'orc-borders.png'));
  expect(svc.resolveAsset('borders.png', { border: 'bogus' })).toBe(path.join(ASSETS, 'orc-borders.png'));
});

test('assign maps active sessions to individual pets with looks', () => {
  svc.createPets({ species: 'bearded-dragon', name: 'Spike' });
  const sessions = [{ id: 'a', cwd: '/w', agent: 'claude', hot: true, lastActive: 2 }, { id: 'b', cwd: '/w', agent: 'codex', hot: false, lastActive: 1 }];
  const m = svc.assign(sessions);
  expect(m.get('a').petId).not.toBe(m.get('b').petId);
  expect(m.get('a')).toMatchObject({ layout: 'baked', env: null });
  svc.roster.update(m.get('b').petId, { assignment: { type: 'agent', value: 'codex' } });
  svc.refresh();
  expect(svc.assign(sessions).get('b').petId).toBe(m.get('b').petId);
});

test('importSheet with a chroma backdrop turns a species into a cutout that uses an environment', async () => {
  const sp = svc.species.createDraft({ display: 'Jazz Trumpet', brief: 'A trumpet' });
  const sheet = png('s.png', 600, 600, (x, w, h) => { x.fillStyle = '#ff00ff'; x.fillRect(0, 0, w, h); x.fillStyle = '#c90'; x.fillRect(20, 20, 50, 50); });
  const r = await svc.importSheet({ slug: sp.slug, atlas: sheet, chroma: '#ff00ff' });
  expect(r.layout).toBe('cutout');
  expect(svc.species.get(sp.slug)).toMatchObject({ ready: true, layout: 'cutout' });
  // Cutouts resolve bg.png to an environment; default falls back to the built-in dungeon.
  expect(svc.resolveAsset('bg.png', { char: sp.slug })).toBe(path.join(ASSETS, 'bg-pixel.png'));
  const bg = png('club.png', 800, 800, (x, w, h) => { x.fillStyle = '#223'; x.fillRect(0, 0, w, h); });
  const env = await svc.importEnvironFile({ source: bg, display: 'Jazz Club', description: 'smoky' });
  svc.species.update(sp.slug, { defaultEnv: env.id });
  expect(svc.resolveAsset('bg.png', { char: sp.slug })).toBe(path.join(dir, 'environs', `${env.id}.png`));
  // a pet-level env override wins
  const pet = svc.createPets({ species: sp.slug, name: 'Miles' })[0];
  svc.roster.update(pet.id, { env: 'dungeon' });
  svc.refresh();
  expect(svc.lookOf(svc.roster.get(pet.id))).toMatchObject({ layout: 'cutout', env: 'dungeon' });
});

test('baked species ignore environments', () => {
  expect(svc.lookOf(svc.lead())).toMatchObject({ layout: 'baked', env: null });
});

test('prompt: species fields feed the generator, overrides win, environ prompt works', () => {
  svc.species.update('bearded-dragon', { activity: 'basking under a heat lamp', setting: 'free', layout: 'cutout', scene: 'a desert terrarium' });
  const p = svc.prompt({ kind: 'atlas', slug: 'bearded-dragon' });
  expect(p).toContain('basking under a heat lamp');
  expect(p).toContain('#FF00FF');
  expect(p).toContain('a desert terrarium');
  expect(svc.prompt({ kind: 'atlas', slug: 'bearded-dragon', spec: { activity: 'doing a head bob' } })).toContain('doing a head bob');
  expect(svc.prompt({ kind: 'strip', slug: 'bearded-dragon', row: 2 })).toContain('ANIMATION — TYPING');
  expect(svc.prompt({ kind: 'environ', spec: { name: 'Terrarium', description: 'A sandy desert terrarium with a rock and heat lamp.' } })).toMatch(/NO characters/);
});

test('snapshot has everything the UI renders', () => {
  const s = svc.snapshot();
  expect(s.pets[0].look.speciesDisplay).toBe('Orc Peon');
  expect(s.species.find((x) => x.slug === 'orc')).toMatchObject({ display: 'Orc Peon', ready: true });
  expect(s.environs.map((e) => e.id)).toContain('dungeon');
  expect(s.tints.map((t) => t.id)).toContain('red');
  expect(s.borders.map((b) => b.id)).toContain('default');
});
