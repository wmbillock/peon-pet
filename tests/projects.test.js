const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProjectStore, projectKeyOf, projectColors, suggestEmoji, HUES } = require('../lib/projects');

let dir, file;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-')); file = path.join(dir, 'projects.json'); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('emoji and colours', () => {
  test('suggestEmoji reads the name, and falls back to a stable pick', () => {
    expect(suggestEmoji('peon-pet')).toBe('🐾');
    expect(suggestEmoji('Pricing CLI')).toBe('💲');
    expect(suggestEmoji('Libretto knowledge')).toBe('📚');
    const a = suggestEmoji('zzz-unknown', 'cwd:/x');
    expect(a).toBe(suggestEmoji('zzz-unknown', 'cwd:/x'));
    expect(suggestEmoji('qqq', 'cwd:/different')).toBeTruthy();
  });

  test('projectColors: same hue, role-dependent shade, lead brighter than critique', () => {
    const lead = projectColors(215, 'lead'), crit = projectColors(215, 'critique'), none = projectColors(215, undefined);
    expect(lead.plate).toBe('hsl(215 55% 42%)');
    expect(crit.plate).toBe('hsl(215 55% 23%)');
    expect(none.plate).toBe('hsl(215 55% 38%)');
    expect(lead.ring).toBe(crit.ring);   // the family ring is one colour
    expect(new Set(HUES).size).toBe(HUES.length);
  });
});

describe('projectKeyOf', () => {
  const row = (extra) => ({ id: 's1', name: 'peon-pet', cwd: '/w/peon-pet', title: null, titleKind: null, firm: null, ...extra });

  test('sessions in one folder share a project (Claude + Codex on the same repo)', () => {
    expect(projectKeyOf(row())).toEqual({ key: 'cwd:/w/peon-pet', name: 'peon-pet' });
    expect(projectKeyOf(row({ id: 'codex-1', agent: 'codex' })).key).toBe('cwd:/w/peon-pet');
  });

  test('a name you chose is the project, even when sessions share a folder', () => {
    const a = projectKeyOf(row({ cwd: '/w/notes', title: 'Euphonia', titleKind: 'custom' }));
    const b = projectKeyOf(row({ cwd: '/w/notes', title: 'libretto', titleKind: 'custom' }));
    expect(a).toEqual({ key: 'title:euphonia', name: 'Euphonia' });
    expect(a.key).not.toBe(b.key);
    expect(projectKeyOf(row({ cwd: '/w/notes', title: 'auto name', titleKind: 'ai' })).key).toBe('cwd:/w/notes');
  });

  test('Firm agents: by Firm project (with its title), management apart, stray worktrees by workstream', () => {
    expect(projectKeyOf(row({ firm: { role: 'worker', projectId: 'p9' } }), { p9: 'Pricing CLI' })).toEqual({ key: 'firm:p9', name: 'Pricing CLI' });
    expect(projectKeyOf(row({ firm: { role: 'worker', projectId: 'p9' } }))).toEqual({ key: 'firm:p9', name: 'p9' });
    expect(projectKeyOf(row({ firm: { role: 'management', projectId: null } })).key).toBe('firm:management');
    expect(projectKeyOf(row({ cwd: '/Users/me/.firm/worktrees/ws_ab12/_base/x' }))).toEqual({ key: 'ws:ws_ab12', name: 'Workstream ab12' });
  });

  test('no folder falls back to the session', () => {
    expect(projectKeyOf({ id: 'x1', name: null, title: 'T', cwd: null, firm: null })).toEqual({ key: 'session:x1', name: 'T' });
  });
});

describe('project store', () => {
  test('first sight creates a project with an emoji and the next unused hue, and persists it', () => {
    const s = createProjectStore({ file });
    const a = s.resolve('cwd:/w/peon-pet', 'peon-pet');
    const b = s.resolve('title:euphonia', 'Euphonia');
    expect(a).toMatchObject({ name: 'peon-pet', emoji: '🐾', hue: HUES[0], autoName: true });
    expect(b.hue).toBe(HUES[1]);
    expect(createProjectStore({ file }).resolve('cwd:/w/peon-pet', 'peon-pet')).toMatchObject({ hue: HUES[0], emoji: '🐾' });
  });

  test('an auto name follows a better title until you edit it', () => {
    const s = createProjectStore({ file });
    s.resolve('firm:p1', 'p1');
    expect(s.resolve('firm:p1', 'Pricing CLI')).toMatchObject({ name: 'Pricing CLI', emoji: '💲' });
    s.update('firm:p1', { name: 'My pricing thing' });
    expect(s.resolve('firm:p1', 'Pricing CLI Reborn').name).toBe('My pricing thing');
  });

  test('edits validate; a chosen emoji sticks even if the name changes', () => {
    const s = createProjectStore({ file });
    s.resolve('k', 'plain');
    expect(() => s.update('k', { name: '  ' })).toThrow(/empty/);
    expect(() => s.update('k', { emoji: '' })).toThrow(/emoji/);
    expect(() => s.update('k', { emoji: 'abcdef' })).toThrow(/emoji/);
    expect(() => s.update('k', { hue: 400 })).toThrow(/Hue/);
    expect(() => s.update('nope', { name: 'x' })).toThrow(/Unknown/);
    s.update('k', { emoji: '🦊', hue: 100 });
    s.update('k', { name: 'Pricing' });
    expect(s.list()[0]).toMatchObject({ emoji: '🦊', hue: 100, name: 'Pricing' });
  });

  test('hues are not reused while any are free; forget removes', () => {
    const s = createProjectStore({ file });
    const hues = HUES.map((_, i) => s.resolve(`k${i}`, `n${i}`).hue);
    expect(new Set(hues).size).toBe(HUES.length);
    expect(HUES).toContain(s.resolve('overflow', 'extra').hue);   // past twelve, it still gets a valid hue
    s.forget('k0');
    expect(s.list().some((p) => p.key === 'k0')).toBe(false);
  });

  test('a corrupt file starts fresh; __proto__ keys do not poison it', () => {
    fs.writeFileSync(file, '{not json');
    const s = createProjectStore({ file });
    expect(s.resolve('__proto__', 'x').key).toBe('__proto__');
    expect(({}).emoji).toBeUndefined();
  });
});

test('projects carry a frame and an environment (null = default), validated as catalog ids', () => {
  const s = createProjectStore({ file });
  expect(s.resolve('k', 'Thing')).toMatchObject({ frame: null, env: null });
  s.update('k', { frame: 'dyn-status', env: 'jazz-club' });
  expect(createProjectStore({ file }).resolve('k', 'Thing')).toMatchObject({ frame: 'dyn-status', env: 'jazz-club' });
  s.update('k', { frame: null });
  expect(s.list()[0]).toMatchObject({ frame: null, env: 'jazz-club' });
  expect(() => s.update('k', { frame: '../etc' })).toThrow(/Invalid frame/);
  expect(() => s.update('k', { env: 'Has Spaces' })).toThrow(/Invalid env/);
});

test('bare sessions and peeks are never persisted', () => {
  const s = createProjectStore({ file });
  const e = s.resolve('session:abc', 'thing');
  expect(e).toMatchObject({ key: 'session:abc', ephemeral: true });
  expect(HUES).toContain(e.hue);
  expect(s.resolve('session:abc', 'thing').hue).toBe(e.hue);          // stable without being stored
  const p = s.peek('cwd:/w/x', 'x');
  expect(p).toMatchObject({ ephemeral: true, name: 'x' });
  expect(s.list()).toEqual([]);
  s.resolve('cwd:/w/x', 'x');
  expect(s.peek('cwd:/w/x', 'x').ephemeral).toBeUndefined();          // once resolved it is the stored one
  expect(s.list()).toHaveLength(1);
});

test('emoji rules match whole-word starts: "display" is not "play", "carpet" is not "pet"', () => {
  expect(suggestEmoji('Markdown display')).toBe('📝');
  expect(suggestEmoji('display')).not.toBe('🎮');
  expect(suggestEmoji('carpet')).not.toBe('🐾');
  expect(suggestEmoji('playground')).not.toBe('🎮');
  expect(suggestEmoji('play')).toBe('🎮');
  expect(suggestEmoji('peon-pet')).toBe('🐾');
  expect(suggestEmoji('the-firm')).toBe('🏛️');
  expect(suggestEmoji('security-audit')).toBe('🧾');   // first matching rule wins (audit before security)
});
