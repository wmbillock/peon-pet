const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRoster } = require('../lib/roster');
const { createEuphonia } = require('../lib/euphonia/service');
const { registerEuphoniaIpc } = require('../lib/euphonia/ipc');
const lead = require('../lib/euphonia/lead');

const INSTALLED = ['orc', 'trillian', 'capybara', 'kirby'];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'per-'));

// Everything a "restart" recreates: the service, the roster, the IPC. State lives only in the two directories.
function boot({ home, rosterFile, packs = ['alpha', 'beta'], peon = null, spawnImpl = () => { throw new Error('no cli'); } }) {
  const svc = createEuphonia({ home, hubDir: path.join(home, 'hub'), user: 'w', discover: () => ({ servers: [], errors: [] }), spawnImpl });
  const roster = createRoster({ file: rosterFile, isSpecies: (s) => INSTALLED.includes(s) });
  const facade = { pinReserved: (spec) => roster.pinReserved(spec), update: (id, p) => roster.update(id, p) };
  const handlers = {};
  const ipcMain = { handle: (c, f) => { handlers[c] = f; }, on: () => {} };
  const dash = { isDestroyed: () => false, send() {} }, chat = { isDestroyed: () => false, send() {} };
  const plays = [];
  registerEuphoniaIpc({
    ipcMain, getPetWebContents: () => null, getChat: { webContents: () => chat, isActive: () => false, open: () => {} }, getSenders: () => [dash], getService: () => svc,
    peonDir: () => peon || '/none', listPacks: () => packs.map((n) => ({ name: n })), isMuted: () => false, getVolume: () => 0.5, play: (file) => plays.push(file),
    onConfigChanged: () => lead.applyConfigToLead({ roster: facade, svc }),
  });
  lead.startupPin({ roster: facade, svc });
  return { svc, roster, facade, handlers, dash, chat, plays };
}

test('name and sound pack set through the real IPC survive a restart, and startup does not overwrite them', async () => {
  const home = tmp(), rosterFile = path.join(tmp(), 'pets.json');
  let a = boot({ home, rosterFile });
  expect(a.roster.get('euphonia')).toMatchObject({ name: 'Euphonia', reserved: true });
  const r = await a.handlers['euphonia-set-config']({ sender: a.dash }, { name: 'Ska Bot', soundPack: 'beta' });
  expect(r).toMatchObject({ ok: true, warning: null });
  expect(r.config).toMatchObject({ name: 'Ska Bot', soundPack: 'beta' });
  expect(a.roster.get('euphonia').name).toBe('Ska Bot');           // plate follows the setting

  for (let i = 0; i < 3; i++) {                                    // restart, repeatedly
    a = boot({ home, rosterFile });
    expect(a.svc.getConfig()).toMatchObject({ name: 'Ska Bot', soundPack: 'beta' });
    expect(a.roster.get('euphonia')).toMatchObject({ name: 'Ska Bot', reserved: true, assignment: { type: 'bench' } });
    expect(a.roster.lead().id).toBe('euphonia');
  }
});

test('a rename made through the roster (Pets tab / Forge) survives pinReserved and writes through to the config', () => {
  const home = tmp(), rosterFile = path.join(tmp(), 'pets.json');
  let a = boot({ home, rosterFile });
  const pet = a.roster.update('euphonia', { name: 'Trilly', tint: 'blue' });
  lead.mirrorLeadToConfig({ svc: a.svc, pet });
  expect(a.svc.getConfig().name).toBe('Trilly');
  a.roster.pinReserved({ id: 'euphonia', name: 'Euphonia', species: ['trillian'] });   // a second pin, as on every start
  expect(a.roster.get('euphonia')).toMatchObject({ name: 'Trilly', tint: 'blue' });
  a = boot({ home, rosterFile });
  expect(a.roster.get('euphonia')).toMatchObject({ name: 'Trilly', tint: 'blue' });
  expect(a.svc.getConfig().name).toBe('Trilly');
  // other pets are not mirrored
  const other = a.roster.create({ species: 'orc', name: 'Grunt' });
  expect(lead.mirrorLeadToConfig({ svc: a.svc, pet: other })).toBeNull();
  expect(a.svc.getConfig().name).toBe('Trilly');
});

test('double reload: a config change followed by repeated re-applies and pins cannot clobber the write', async () => {
  const home = tmp(), rosterFile = path.join(tmp(), 'pets.json');
  const a = boot({ home, rosterFile });
  await a.handlers['euphonia-set-config']({ sender: a.dash }, { name: 'Echo', soundPack: 'beta' });
  lead.applyConfigToLead({ roster: a.facade, svc: a.svc });
  lead.startupPin({ roster: a.facade, svc: a.svc });
  lead.applyConfigToLead({ roster: a.facade, svc: a.svc });
  lead.startupPin({ roster: a.facade, svc: a.svc });
  expect(a.svc.getConfig()).toMatchObject({ name: 'Echo', soundPack: 'beta' });
  expect(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'))).toMatchObject({ name: 'Echo', soundPack: 'beta' });
  expect(a.roster.get('euphonia').name).toBe('Echo');
});

test('a species change in settings reaches the roster; the pet\'s art falls back only when its species is gone', async () => {
  const home = tmp(), rosterFile = path.join(tmp(), 'pets.json');
  const a = boot({ home, rosterFile });
  await a.handlers['euphonia-set-config']({ sender: a.dash }, { species: 'kirby' });
  expect(a.roster.get('euphonia').species).toBe('kirby');
  const b = boot({ home, rosterFile });
  expect(b.roster.get('euphonia').species).toBe('kirby');
  const gone = createRoster({ file: rosterFile, isSpecies: (s) => ['orc', 'trillian'].includes(s) });   // kirby art removed
  expect(gone.pinReserved({ id: 'euphonia', name: 'x', species: ['trillian'] }).species).toBe('trillian');
});

test('the very next reply uses the saved pack, without a restart', async () => {
  const peon = tmp();
  for (const n of ['alpha', 'beta']) {
    fs.mkdirSync(path.join(peon, 'packs', n, 'sounds'), { recursive: true });
    fs.writeFileSync(path.join(peon, 'packs', n, 'sounds', `${n}.mp3`), 'x');
    fs.writeFileSync(path.join(peon, 'packs', n, 'openpeon.json'), JSON.stringify({ categories: { 'task.complete': { sounds: [{ file: `${n}.mp3` }] } } }));
  }
  const { EventEmitter } = require('events');
  const { PassThrough } = require('stream');
  const spawnImpl = () => {
    const c = new EventEmitter(); c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.stdin = new PassThrough(); c.kill = () => {}; c.stdin.resume();
    c.stdin.on('end', () => setImmediate(() => { c.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: 'hi', session_id: 's' }) + '\n'); c.stdout.end(); c.emit('close', 0); }));
    return c;
  };
  const a = boot({ home: tmp(), rosterFile: path.join(tmp(), 'pets.json'), peon, spawnImpl });
  const reply = () => new Promise((resolve) => {
    const off = a.svc.subscribe((ev) => { if (ev.type === 'done') { off(); resolve(); } });
    a.handlers['euphonia-send']({ sender: a.chat }, 'hello');
  });
  await a.handlers['euphonia-set-config']({ sender: a.dash }, { soundPack: 'alpha' });
  await reply();
  expect(path.basename(a.plays.at(-1))).toBe('alpha.mp3');
  await a.handlers['euphonia-set-config']({ sender: a.dash }, { soundPack: 'beta' });
  await reply();
  expect(path.basename(a.plays.at(-1))).toBe('beta.mp3');       // the next reply, same process
});

test('a failed or non-persisting write is surfaced, not swallowed', async () => {
  const handlers = {};
  const mkIpc = (svc) => registerEuphoniaIpc({
    ipcMain: { handle: (c, f) => { handlers[c] = f; }, on: () => {} }, getPetWebContents: () => null, getChat: { webContents: () => null, isActive: () => false, open: () => {} },
    getSenders: () => [dash], getService: () => svc, peonDir: () => '/none', listPacks: () => [{ name: 'beta' }], isMuted: () => true, getVolume: () => 0.5,
  });
  const dash = {};
  mkIpc({ subscribe: () => {}, setConfig: () => { throw new Error('EACCES: read-only home'); }, getConfig: () => ({}), getSession: () => null, history: () => [] });
  expect(await handlers['euphonia-set-config']({ sender: dash }, { soundPack: 'beta' })).toEqual({ ok: false, error: 'EACCES: read-only home' });
  mkIpc({ subscribe: () => {}, setConfig: () => {}, getConfig: () => ({ soundPack: 'old' }), getSession: () => null, history: () => [] });
  const r = await handlers['euphonia-set-config']({ sender: dash }, { soundPack: 'beta' });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/soundPack setting did not persist/);
  // an update that saved but could not refresh the pet is reported as a warning
  const real = createEuphonia({ home: tmp(), hubDir: '/x', user: 'w', discover: () => ({ servers: [], errors: [] }) });
  registerEuphoniaIpc({
    ipcMain: { handle: (c, f) => { handlers[c] = f; }, on: () => {} }, getPetWebContents: () => null, getChat: { webContents: () => null, isActive: () => false, open: () => {} },
    getSenders: () => [dash], getService: () => real, peonDir: () => '/none', listPacks: () => [{ name: 'beta' }], isMuted: () => true, getVolume: () => 0.5,
    onConfigChanged: () => { throw new Error('Unknown species'); },
  });
  const w = await handlers['euphonia-set-config']({ sender: dash }, { name: 'Zed' });
  expect(w).toMatchObject({ ok: true, config: { name: 'Zed' } });
  expect(w.warning).toMatch(/Saved, but the pet could not be updated: Unknown species/);
  expect(real.getConfig().name).toBe('Zed');
});

test('empty names are rejected and names are trimmed', async () => {
  const a = boot({ home: tmp(), rosterFile: path.join(tmp(), 'pets.json') });
  expect((await a.handlers['euphonia-set-config']({ sender: a.dash }, { name: '   ' })).ok).toBe(false);
  expect((await a.handlers['euphonia-set-config']({ sender: a.dash }, { name: '  Nova  ' })).config.name).toBe('Nova');
});
