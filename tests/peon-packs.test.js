const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  listPacks, getPackState, setSessionPacks, clearSessionPack, setGlobalPack,
} = require('../lib/peon-packs');

let dir;
const write = (rel, data) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data));
};
const read = (rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peon-packs-'));
  write('packs/peon/openpeon.json', { display_name: 'Orc Peon' });
  write('packs/glados/openpeon.json', { display_name: 'GLaDOS' });
  write('packs/legacy/manifest.json', {});
  write('packs/draft/openpeon.json', { display_name: 'Draft', x_openpeon_draft: true });
  write('packs/not-a-pack/readme.txt', 'x');
  write('config.json', { default_pack: 'peon', pack_rotation_mode: 'session_override', path_rules: [{}, {}], volume: 0.5 });
  write('.state.json', {
    session_packs: { a: { pack: 'glados', last_used: 1 }, b: 'peon' },
    rotation_index: 4,
  });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('listPacks returns approved packs sorted by display name', () => {
  expect(listPacks(dir)).toEqual([
    { name: 'glados', display: 'GLaDOS' },
    { name: 'legacy', display: 'legacy' },
    { name: 'peon', display: 'Orc Peon' },
  ]);
});

test('getPackState normalises old and new session_packs formats', () => {
  const s = getPackState(dir);
  expect(s.defaultPack).toBe('peon');
  expect(s.rotationMode).toBe('session_override');
  expect(s.pathRuleCount).toBe(2);
  expect(s.sessionPacks).toEqual({ a: 'glados', b: 'peon' });
});

test('getPackState tolerates a missing dir', () => {
  const s = getPackState(path.join(dir, 'nope'));
  expect(s.packs).toEqual([]);
  expect(s.defaultPack).toBe('peon');
});

test('setSessionPacks pins sessions and leaves other state untouched', () => {
  setSessionPacks(['a', 'c'], 'peon', dir);
  const st = read('.state.json');
  expect(st.session_packs.a.pack).toBe('peon');
  expect(st.session_packs.c.pack).toBe('peon');
  expect(st.session_packs.b).toBe('peon');
  expect(st.rotation_index).toBe(4);
});

test('setSessionPacks rejects unknown, draft, and traversal names', () => {
  for (const bad of ['nope', 'draft', '../packs/peon', '', undefined]) {
    expect(() => setSessionPacks(['a'], bad, dir)).toThrow(/Unknown pack/);
  }
});

test('clearSessionPack removes only that pin', () => {
  clearSessionPack('a', dir);
  expect(Object.keys(read('.state.json').session_packs)).toEqual(['b']);
});

test('setGlobalPack falls back to editing config.json and keeps other keys', async () => {
  await setGlobalPack('glados', dir);
  const cfg = read('config.json');
  expect(cfg.default_pack).toBe('glados');
  expect(cfg.volume).toBe(0.5);
  expect(cfg.path_rules).toHaveLength(2);
});

test('setGlobalPack uses peon.sh packs use when present', async () => {
  write('peon.sh', 'echo "$@" > "$(dirname "$0")/called"\n');
  await setGlobalPack('glados', dir);
  expect(fs.readFileSync(path.join(dir, 'called'), 'utf8').trim()).toBe('packs use glados');
});

test('setGlobalPack rejects unknown packs', async () => {
  await expect(setGlobalPack('nope', dir)).rejects.toThrow(/Unknown pack/);
});

test('setVolume clamps, rounds, and preserves config', () => {
  expect(require('../lib/peon-packs').setVolume(0.456, dir)).toBe(0.46);
  expect(read('config.json').volume).toBe(0.46);
  expect(require('../lib/peon-packs').setVolume(9, dir)).toBe(1);
  expect(require('../lib/peon-packs').setVolume(-1, dir)).toBe(0);
  expect(read('config.json').default_pack).toBe('peon');
  expect(getPackState(dir).volume).toBe(0);
});

test('pickSample returns a file inside the pack and refuses path escapes', () => {
  const { pickSample } = require('../lib/peon-packs');
  write('packs/peon/sounds/hi.wav', 'x');
  write('packs/peon/openpeon.json', { categories: { 'session.start': { sounds: [{ file: 'sounds/hi.wav' }] } } });
  expect(pickSample('peon', dir)).toBe(path.join(dir, 'packs/peon/sounds/hi.wav'));
  write('packs/glados/openpeon.json', { categories: { 'session.start': { sounds: [{ file: '../peon/sounds/hi.wav' }] } } });
  expect(pickSample('glados', dir)).toBeNull();
});

test('pickSample finds bare filenames under sounds/ and falls back to other categories', () => {
  const { pickSample } = require('../lib/peon-packs');
  write('packs/glados/sounds/ready.wav', 'x');
  write('packs/glados/openpeon.json', { categories: { 'user.spam': { sounds: [{ file: 'ready.wav' }] } } });
  expect(pickSample('glados', dir)).toBe(path.join(dir, 'packs/glados/sounds/ready.wav'));
});

test('setCategory/setDesktopNotifications only write whitelisted keys', () => {
  const { setCategory, setDesktopNotifications } = require('../lib/peon-packs');
  setCategory('input.required', false, dir);
  expect(getPackState(dir).categories['input.required']).toBe(false);
  expect(getPackState(dir).categories['task.complete']).toBe(true);
  expect(() => setCategory('__proto__', false, dir)).toThrow(/Unknown category/);
  expect(() => setCategory('volume', false, dir)).toThrow(/Unknown category/);
  setDesktopNotifications(false, dir);
  expect(getPackState(dir).desktopNotifications).toBe(false);
  expect(read('config.json').volume).toBe(0.5);
});
