const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCanvas } = require('canvas');
const { registerPetIpc } = require('../lib/ipc-pets');
const { createPetsService } = require('../lib/pets-service');
const BUNDLED = require('../lib/bundled-characters');
const { byId: borderById } = require('../lib/borders');

const ASSETS = path.join(__dirname, '../renderer/assets');
let dir, svc, handlers, calls, picked;

// Drives the real handlers with a fake ipcMain/dialog and the real pets service.
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-'));
  svc = createPetsService({ userDataDir: dir, assetsDir: ASSETS, bundled: BUNDLED });
  svc.seed('orc');
  handlers = {}; calls = { reload: 0, saved: [], mutated: 0 }; picked = { canceled: true, filePaths: [] };
  registerPetIpc({
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    dialog: { showOpenDialog: async () => picked },
    nativeImage: { createFromPath: () => ({ resize: () => ({ toDataURL: () => 'data:image/png;base64,AAAA' }) }) },
    pets: svc,
    mutate: (fn) => { calls.mutated++; const r = fn(); svc.refresh(); return r; },
    petSnapshot: () => ({ ...svc.snapshot(), activeBorder: 'default' }),
    savePetConfig: (p) => calls.saved.push(p),
    reloadPetWindows: () => { calls.reload++; },
    borderById,
  });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// Like ipcMain.handle, a synchronous throw becomes a rejected promise.
const invoke = async (name, ...args) => handlers[name]({}, ...args);

test('registers every channel the panel uses', () => {
  for (const ch of ['pets-get', 'pets-create', 'pets-update', 'pets-remove', 'pets-set-lead', 'species-update', 'species-create-draft',
    'species-remove-draft', 'gen-prompt', 'species-import', 'species-preview', 'env-import', 'env-update', 'env-remove', 'borders-set']) {
    expect(typeof handlers[ch]).toBe('function');
  }
});

test('create → rename/tint → lead → remove round-trips through the snapshot', async () => {
  let snap = await invoke('pets-create', { species: 'bearded-dragon', name: 'Spike', count: 1 });
  const spike = snap.pets.find((p) => p.name === 'Spike');
  expect(spike).toBeTruthy();
  snap = await invoke('pets-update', spike.id, { name: 'Spike II', tint: 'red', assignment: { type: 'agent', value: 'codex' } });
  expect(snap.pets.find((p) => p.id === spike.id)).toMatchObject({ name: 'Spike II', tint: 'red', assignment: { type: 'agent', value: 'codex' } });
  snap = await invoke('pets-set-lead', spike.id);
  expect(snap.lead).toBe(spike.id);
  snap = await invoke('pets-remove', spike.id);
  expect(snap.pets.some((p) => p.id === spike.id)).toBe(false);
  expect(calls.mutated).toBe(4);
});

test('errors surface (unknown species, bad tint, last pet)', async () => {
  await expect(invoke('pets-create', { species: 'nope' })).rejects.toThrow(/Unknown species/);
  const lead = svc.lead();
  await expect(invoke('pets-update', lead.id, { tint: 'chartreuse' })).rejects.toThrow(/Unknown tint/);
  await expect(invoke('pets-remove', lead.id)).rejects.toThrow(/at least one/);
});

test('species: friendly name + facts persist; draft create returns its slug; prompt builds', async () => {
  let snap = await invoke('species-update', 'bearded-dragon', { display: 'Spike the Beardie', facts: [{ key: 'Mood', value: 'regal' }] });
  expect(snap.species.find((s) => s.slug === 'bearded-dragon')).toMatchObject({ display: 'Spike the Beardie', facts: [{ key: 'Mood', value: 'regal' }] });
  snap = await invoke('species-create-draft', { display: 'Jazz Trumpet', brief: 'A golden trumpet with eyes and a big smile.' });
  expect(snap.created).toBe('jazz-trumpet');
  const prompt = await invoke('gen-prompt', { kind: 'atlas', slug: 'jazz-trumpet' });
  expect(prompt).toContain('A golden trumpet with eyes');
  snap = await invoke('species-remove-draft', 'jazz-trumpet');
  expect(snap.species.some((s) => s.slug === 'jazz-trumpet')).toBe(false);
});

test('species-import: cancel is a no-op; a chosen magenta sheet becomes a cutout', async () => {
  svc.species.createDraft({ display: 'Cutie', brief: 'a small cutie' });
  expect((await invoke('species-import', { slug: 'cutie', mode: 'atlas' })).canceled).toBe(true);

  const f = path.join(dir, 'sheet.png');
  const c = createCanvas(600, 600); const x = c.getContext('2d');
  x.fillStyle = '#ff00ff'; x.fillRect(0, 0, 600, 600); x.fillStyle = '#0a0'; x.fillRect(10, 10, 30, 30);
  fs.writeFileSync(f, c.toBuffer('image/png'));
  picked = { canceled: false, filePaths: [f] };
  const r = await invoke('species-import', { slug: 'cutie', mode: 'atlas', chroma: '#FF00FF' });
  expect(r.layout).toBe('cutout');
  expect(r.species.find((s) => s.slug === 'cutie')).toMatchObject({ ready: true, layout: 'cutout' });
});

test('environments: import, edit, remove', async () => {
  const f = path.join(dir, 'bg.png');
  const c = createCanvas(500, 400); const x = c.getContext('2d'); x.fillStyle = '#335'; x.fillRect(0, 0, 500, 400);
  fs.writeFileSync(f, c.toBuffer('image/png'));
  picked = { canceled: false, filePaths: [f] };
  let snap = await invoke('env-import', { display: 'Jazz Club', description: 'smoky' });
  expect(snap.created).toBe('jazz-club');
  snap = await invoke('env-update', 'jazz-club', { description: 'very smoky' });
  expect(snap.environs.find((e) => e.id === 'jazz-club').description).toBe('very smoky');
  snap = await invoke('env-remove', 'jazz-club');
  expect(snap.environs.some((e) => e.id === 'jazz-club')).toBe(false);
  await expect(invoke('env-remove', 'dungeon')).rejects.toThrow(/Built-in/);
});

test('borders-set validates, saves, and reloads windows', async () => {
  await invoke('borders-set', 'gold');
  expect(calls.saved).toEqual([{ border: 'gold' }]);
  expect(calls.reload).toBe(1);
  await expect(invoke('borders-set', 'bogus')).rejects.toThrow(/Unknown frame style/);
  expect(calls.reload).toBe(1);
});

test('species-preview returns a data URL', async () => {
  expect(await invoke('species-preview', 'orc')).toMatch(/^data:image\/png/);
});

test('extra-import: cancel is a no-op; a chosen strip adds a named extra', async () => {
  expect((await invoke('extra-import', { slug: 'bearded-dragon', name: 'wave' })).canceled).toBe(true);
  const f = path.join(dir, 'strip.png');
  const c = createCanvas(3072, 512); const x = c.getContext('2d'); x.fillStyle = '#ff00ff'; x.fillRect(0, 0, 3072, 512);
  fs.writeFileSync(f, c.toBuffer('image/png'));
  picked = { canceled: false, filePaths: [f] };
  const r = await invoke('extra-import', { slug: 'bearded-dragon', name: 'wave', fps: 8, triggers: ['SessionStart'] });
  expect(r.row).toBe(1);
  expect(r.species.find((s) => s.slug === 'bearded-dragon').extras.map((e) => e.name)).toEqual(['headbob', 'wave']);
});

test('forge: role → species round-trips, validates, and notifies', async () => {
  let notified = 0;
  handlers = {};
  registerPetIpc({
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, dialog: { showOpenDialog: async () => picked },
    nativeImage: {}, pets: svc, mutate: (fn) => fn(), petSnapshot: () => ({}), savePetConfig: (p) => calls.saved.push(p),
    reloadPetWindows: () => {}, borderById, onRolesChanged: () => { notified++; },
  });
  const s0 = await invoke('forge-get');
  expect(s0.roles).toEqual(expect.arrayContaining(['management', 'lead', 'worker', 'inspector']));
  expect(s0.map).toEqual({});
  expect(s0.species.map((x) => x.slug)).toContain('retro-robot');
  const s1 = await invoke('forge-set', 'worker', 'retro-robot');
  expect(s1.map).toEqual({ worker: 'retro-robot' });
  expect(calls.saved.at(-1)).toEqual({ roleSpecies: { worker: 'retro-robot' } });
  expect(notified).toBe(1);
  const t1 = await invoke('forge-set-tint', 'inspector', 'cyan');
  expect(t1.tintMap).toEqual({ inspector: 'cyan' });
  expect(t1.tints.map((t) => t.id)).toContain('cyan');
  expect(calls.saved.at(-1)).toEqual({ roleTint: { inspector: 'cyan' } });
  await expect(invoke('forge-set-tint', 'inspector', 'chartreuse')).rejects.toThrow(/Unknown tint/);
  await invoke('forge-set-tint', 'inspector', '');
  const s2 = await invoke('forge-set', 'worker', '');       // blank clears
  expect(s2.map).toEqual({});
  await expect(invoke('forge-set', 'worker', 'nope')).rejects.toThrow(/Unknown species/);
  await expect(invoke('forge-set', 'wizard', 'orc')).rejects.toThrow(/Unknown Firm role/);
});

test('projects: list, edit (frame/env validated against the catalogs), forget; changes notify', async () => {
  let notified = 0;
  const { BORDERS } = require('../lib/borders');
  handlers = {};
  registerPetIpc({
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, dialog: { showOpenDialog: async () => picked },
    nativeImage: {}, pets: svc, mutate: (fn) => fn(), petSnapshot: () => ({}), savePetConfig: () => {},
    reloadPetWindows: () => {}, borderById, frames: BORDERS, onProjectsChanged: () => { notified++; },
  });
  svc.projects.resolve('cwd:/w/peon-pet', 'peon-pet');
  const s0 = await invoke('projects-get');
  expect(s0.projects).toHaveLength(1);
  expect(s0.frames.map((f) => f.id)).toEqual(expect.arrayContaining(['default', 'gold']));
  expect(s0.environs.map((e) => e.id)).toContain('dungeon');

  const s1 = await invoke('projects-update', 'cwd:/w/peon-pet', { name: 'Peon Pet', emoji: '🐾', hue: 200, frame: 'gold', env: 'dungeon' });
  expect(s1.projects[0]).toMatchObject({ name: 'Peon Pet', hue: 200, frame: 'gold', env: 'dungeon' });
  expect(notified).toBe(1);
  await expect(invoke('projects-update', 'cwd:/w/peon-pet', { frame: 'bogus' })).rejects.toThrow(/Unknown frame/);
  await expect(invoke('projects-update', 'cwd:/w/peon-pet', { env: 'mars' })).rejects.toThrow(/Unknown environment/);
  await expect(invoke('projects-update', 'nope', { name: 'x' })).rejects.toThrow(/Unknown project/);
  const s2 = await invoke('projects-forget', 'cwd:/w/peon-pet');
  expect(s2.projects).toEqual([]);
});
