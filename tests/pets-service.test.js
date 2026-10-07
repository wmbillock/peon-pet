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
  for (const t of svc.agentTypes.list()) svc.agentTypes.remove(t.slug);   // existing tests are about roles and tints, not seeded types
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
  expect(svc.resolveAsset('sprite-atlas.png', { char: 'weeping-willow' })).toBe(path.join(ASSETS, 'weeping-willow-sprite-atlas.png'));
  // terra-ff6 is local-only art: it resolves to its own atlas where present and falls back to the lead in a distribution
  const terra = path.join(ASSETS, 'terra-ff6-sprite-atlas.png');
  expect(svc.resolveAsset('sprite-atlas.png', { char: 'terra-ff6' })).toBe(require('fs').existsSync(terra) ? terra : lead);
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
  expect(m.get('a')).toMatchObject({ layout: 'cutout', env: 'orc-forge' });   // bundled art is cutouts on per-species environments
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
  svc.species.update(svc.lead().species, { layout: 'baked' });   // a sheet that paints its own scene
  svc.refresh();
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

describe('assign: roots, children and instance tints', () => {
  const agent = (id, extra = {}) => ({ id, rootId: id, isRoot: true, cwd: '/w', agent: 'claude', hot: true, lastActive: 1, rank: 0, order: 0, ...extra });

  test('an agent\'s sub-agents keep its pet and name, but not its colour wash', () => {
    svc.createPets({ species: 'bearded-dragon', name: 'Spike' });
    const spike = svc.roster.list().find((p) => p.name === 'Spike');
    svc.roster.update(spike.id, { tint: 'violet', assignment: { type: 'session', value: 'lead' } });
    svc.refresh();
    const m = svc.assign([agent('lead', { order: 0 }), agent('w1', { isRoot: false, rootId: 'lead', order: 1 }), agent('w2', { isRoot: false, rootId: 'lead', order: 2 })]);
    expect(m.get('lead')).toMatchObject({ name: 'Spike', tint: 'violet' });
    expect(m.get('w1')).toMatchObject({ name: 'Spike', species: 'bearded-dragon', sub: true, tint: 'none', tintAlpha: 0 });
    expect(m.get('w2').petId).toBe(m.get('lead').petId);
    expect(m.get('lead').sub).toBeUndefined();
  });

  test('more root agents than pets: extra instances are numbered copies, stable across reorders', () => {
    const roots = ['a', 'b', 'c', 'd'].map((id, i) => agent(id, { order: i }));
    const m1 = svc.assign(roots);                    // roster has one pet
    const looks = roots.map((r) => m1.get(r.id));
    expect(looks[0].virtual).toBeUndefined();
    expect(looks.slice(1).every((l) => l.virtual && l.tint === 'none')).toBe(true);
    expect(looks.map((l) => l.name)).toEqual([looks[0].name, `${looks[0].name} 2`, `${looks[0].name} 3`, `${looks[0].name} 4`]);
    expect(looks[1].petId).toBe(`${looks[0].petId}~2`);
    const m2 = svc.assign([...roots].reverse());
    for (const r of roots) expect(m2.get(r.id)).toEqual(m1.get(r.id));
  });

  test('rows without graph fields still work as roots (backwards compatible)', () => {
    const m = svc.assign([{ id: 'x', cwd: '/w', agent: 'claude', hot: true, lastActive: 1 }]);
    expect(m.get('x')).toBeTruthy();
  });

  test('role → species: sub-agents of a role wear that species but keep their root\'s name', () => {
    svc.setRoleSpecies({ worker: 'retro-robot' });
    const m = svc.assign([
      agent('lead', { firmRole: 'lead', order: 0 }),
      agent('w', { isRoot: false, rootId: 'lead', firmRole: 'worker', order: 1 }),
      agent('i', { isRoot: false, rootId: 'lead', firmRole: 'inspector', order: 2 }),
    ]);
    expect(m.get('w')).toMatchObject({ species: 'retro-robot', speciesDisplay: 'Retro Robot', sub: true, name: m.get('lead').name, tint: 'none' });
    expect(m.get('i').species).toBe(m.get('lead').species);              // no mapping for inspectors: inherits
    expect(m.get('w').petId).toBe(m.get('lead').petId);
  });

  test('setRoleSpecies validates roles and species, and drops blanks', () => {
    expect(svc.setRoleSpecies({ worker: 'retro-robot', plan: '', scout: null })).toEqual({ worker: 'retro-robot' });
    expect(() => svc.setRoleSpecies({ wizard: 'orc' })).toThrow(/Unknown Firm role/);
    expect(() => svc.setRoleSpecies({ worker: 'nope' })).toThrow(/Unknown species/);
    expect(svc.roleSpeciesMap()).toEqual({ worker: 'retro-robot' });       // a failed update leaves the old map
  });
});

describe('role filters (agent type → full-image filter)', () => {
  const agent = (id, extra = {}) => ({ id, rootId: id, isRoot: true, cwd: '/w', agent: 'claude', hot: true, lastActive: 1, rank: 0, order: 0, ...extra });

  test('every agent of a role wears that role\'s filter; a pet\'s own filter wins; validation works', () => {
    svc.setRoleTint({ inspector: 'cyan' });
    const m = svc.assign([
      agent('lead', { firmRole: 'lead', order: 0 }),
      agent('i1', { isRoot: false, rootId: 'lead', firmRole: 'inspector', order: 1 }),
      agent('i2', { isRoot: false, rootId: 'lead', firmRole: 'inspector', order: 2 }),
      agent('w', { isRoot: false, rootId: 'lead', firmRole: 'worker', order: 3 }),
    ]);
    expect(m.get('i1')).toMatchObject({ tint: 'cyan' });
    expect(m.get('i1').tintAlpha).toBeGreaterThan(0);
    expect(m.get('i2').tint).toBe('cyan');
    expect(m.get('w').tint).toBe('none');
    expect(m.get('lead').tint).toBe('none');

    // a pet you tinted yourself keeps its filter
    svc.roster.update(svc.lead().id, { tint: 'red' });
    svc.refresh();
    svc.setRoleTint({ lead: 'cyan' });
    expect(svc.assign([agent('lead2', { firmRole: 'lead' })]).get('lead2').tint).toBe('red');

    expect(() => svc.setRoleTint({ wizard: 'red' })).toThrow(/Unknown Firm role/);
    expect(() => svc.setRoleTint({ worker: 'chartreuse' })).toThrow(/Unknown tint/);
    expect(svc.setRoleTint({ worker: 'none', plan: '' })).toEqual({});
  });
});

describe('agent type supplied by The Firm', () => {
  const agent = (id, extra = {}) => ({ id, rootId: id, isRoot: true, cwd: '/w', agent: 'claude', hot: true, lastActive: 1, rank: 0, order: 0, ...extra });

  test('decides the art outright, above the role → species mapping; unknown types are ignored', () => {
    svc.setRoleSpecies({ worker: 'retro-robot' });
    const m = svc.assign([
      agent('lead', { firmRole: 'lead', firm: { agentType: 'bearded-dragon' }, order: 0 }),
      agent('w1', { isRoot: false, rootId: 'lead', firmRole: 'worker', firm: { agentType: 'eighth-note' }, order: 1 }),
      agent('w2', { isRoot: false, rootId: 'lead', firmRole: 'worker', firm: { agentType: null }, order: 2 }),
      agent('w3', { isRoot: false, rootId: 'lead', firmRole: 'worker', firm: { agentType: 'not-a-species' }, order: 3 }),
    ]);
    expect(m.get('lead').species).toBe('bearded-dragon');
    expect(m.get('lead').name).toBeTruthy();                       // still has a pet name
    expect(m.get('w1')).toMatchObject({ species: 'eighth-note', sub: true });
    expect(m.get('w2').species).toBe('retro-robot');               // no type: the role mapping applies
    expect(m.get('w3').species).toBe('retro-robot');               // unknown type: ignored, not a crash
  });
});

describe('agent types', () => {
  const root = (id, extra = {}) => ({ id, isRoot: true, rootId: id, cwd: '/w/app', agent: 'claude', hot: true, lastActive: 1, order: 0, ...extra });
  const kid = (id, rootId, role, extra = {}) => ({ id, isRoot: false, rootId, firmRole: role, cwd: '/w/app', agent: 'claude', hot: true, lastActive: 1, order: 1, ...extra });
  const addTypes = () => {
    svc.agentTypes.put({ slug: 'robo', name: 'Robo', category: 'worker', species: 'retro-robot', traits: ['backend'], personality: 'careful' }, svc.typeChecks);
    svc.agentTypes.put({ slug: 'grunt', name: 'Grunt', category: 'worker', species: 'capybara', traits: ['frontend'], personality: 'calm' }, svc.typeChecks);
  };

  test('sub-agents are matched to a type by traits: the pet changes, the root name stays, and the type rides on the look', () => {
    addTypes();
    const m = svc.assign([root('r'), kid('k1', 'r', 'worker', { title: 'Backend handler' }), kid('k2', 'r', 'worker', { title: 'Frontend page' })]);
    expect(m.get('k1')).toMatchObject({ species: 'retro-robot', name: m.get('r').name, type: { slug: 'robo', personality: 'careful' } });
    expect(m.get('k2')).toMatchObject({ species: 'capybara', type: { slug: 'grunt' } });
    expect(m.get('r').type).toBeUndefined();   // roots only auto-pick when you turn that on
  });

  test('a session pin beats the automatic pick; a Firm agent_type beats a pin; a role→species setting beats auto-pick', () => {
    addTypes();
    const agents = [root('r'), kid('k1', 'r', 'worker', { title: 'Backend handler' })];
    svc.agentTypes.pin('session', 'k1', 'grunt');
    expect(svc.assign(agents).get('k1').type.slug).toBe('grunt');
    const firm = [root('r'), kid('k1', 'r', 'worker', { firm: { agentType: 'robo' } })];
    expect(svc.assign(firm).get('k1').type.slug).toBe('robo');
    svc.agentTypes.pin('session', 'k1', null);
    svc.setRoleSpecies({ worker: 'weeping-willow' });
    const m = svc.assign(agents);
    expect(m.get('k1')).toMatchObject({ species: 'weeping-willow' });
    expect(m.get('k1').type).toBeUndefined();
  });

  test('duplicates spread across the types in their category', () => {
    addTypes();
    const m = svc.assign([root('r'), kid('a', 'r', 'worker', { order: 1 }), kid('b', 'r', 'worker', { order: 2 })]);
    expect(new Set([m.get('a').type.slug, m.get('b').type.slug]).size).toBe(2);
  });

  test('autoRoots lets roots wear a type too', () => {
    addTypes();
    svc.agentTypes.put({ slug: 'boss', name: 'Boss', category: 'lead', species: 'capybara', traits: [], personality: '' }, svc.typeChecks);
    svc.agentTypes.setAutoRoots(true);
    expect(svc.assign([root('r')]).get('r').type.slug).toBe('boss');
  });

  test('spread: fifteen auto-picked workers in one project do not all wear the same pet; the first of a kind keeps its own', () => {
    addTypes();
    const kids = Array.from({ length: 15 }, (_, i) => kid(`k${i}`, 'r', 'worker', { order: i + 1, title: 'Backend handler' }));
    const m = svc.assign([root('r'), ...kids]);
    const sp = kids.map((k) => m.get(k.id).species);
    expect(m.get('k0').species).toBe('retro-robot');           // robo's own pet goes to the first match
    expect(new Set(sp).size).toBeGreaterThanOrEqual(5);         // the rest spread over the pool (preference-weighted, not uniform)
    const counts = sp.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(Math.ceil(0.25 * 15));   // the variety cap: no species dominates
    expect(m.get('k3').type.slug).toBeTruthy();                 // the kind (and its personality) is kept
  });

  test('spread keeps each agent\'s look between refreshes, even as other agents come and go', () => {
    addTypes();
    const kids = Array.from({ length: 8 }, (_, i) => kid(`k${i}`, 'r', 'worker', { order: i + 1 }));
    const first = svc.assign([root('r'), ...kids]);
    const again = svc.assign([root('r'), ...kids.slice(0, 5)]);   // three left
    for (const k of kids.slice(0, 5)) expect(again.get(k.id).species).toBe(first.get(k.id).species);
  });

  test('spread off, or a pinned kind, wears exactly the kind\'s own pet', () => {
    addTypes();
    const kids = Array.from({ length: 6 }, (_, i) => kid(`k${i}`, 'r', 'worker', { order: i + 1, title: 'Backend handler' }));
    svc.agentTypes.setSpread(false);
    const off = svc.assign([root('r'), ...kids]);
    for (const k of kids) expect(off.get(k.id).species).toBe('retro-robot');
    svc.agentTypes.setSpread(true);
    svc.agentTypes.pin('session', 'k4', 'robo');
    expect(svc.assign([root('r'), ...kids]).get('k4').species).toBe('retro-robot');
  });

  test('seeded casting: an orc-typed fleet is not an orc army; installs differ; a Forge pin wins; Euphonia is out of the pool', () => {
    svc.agentTypes.put({ slug: 'smith', name: 'Smith', category: 'worker', species: 'orc', traits: ['backend'], personality: 'blunt' }, svc.typeChecks);
    const kids = Array.from({ length: 24 }, (_, i) => kid(`k${i}`, 'r', 'worker', { order: i + 1, title: 'Backend handler' }));
    const agents = [root('r'), ...kids];
    const species = (s) => kids.map((k) => s.assign(agents).get(k.id).species);
    const mine = species(svc);
    expect(mine.filter((s) => s === 'orc').length).toBeLessThanOrEqual(2);
    for (const n of new Map(mine.map((s) => [s, mine.filter((x) => x === s).length])).values()) expect(n).toBeLessThanOrEqual(6);   // 25% of 24
    expect(species(svc)).toEqual(mine);   // stable between refreshes

    const other = createPetsService({ userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'svc2-')), assetsDir: ASSETS, bundled: BUNDLED, getSeed: () => 'another-install' });
    other.seed('orc');
    other.agentTypes.put({ slug: 'smith', name: 'Smith', category: 'worker', species: 'orc', traits: ['backend'], personality: 'blunt' }, other.typeChecks);
    expect(species(other)).not.toEqual(mine);

    svc.agentTypes.pin('session', 'k3', 'smith');   // Forge pin: exactly the kind's own pet
    expect(svc.assign(agents).get('k3').species).toBe('orc');
    svc.agentTypes.pin('session', 'k3', null);      // cleared: back to the seeded pick
    expect(svc.assign(agents).get('k3').species).toBe(mine[3]);
  });
});

