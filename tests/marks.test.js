const { applyMarks, shadeTint, hslToRgb, SHADE_LIGHTNESS } = require('../lib/marks');
const { createProjectStore, HUES } = require('../lib/projects');
const fs = require('fs');
const os = require('os');
const path = require('path');

let dir, store, resolve;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marks-')); store = createProjectStore({ file: path.join(dir, 'p.json') }); resolve = (k, n, seed) => store.resolve(k, n, seed); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const agent = (id, extra = {}) => ({ id, cwd: `/w/${id}`, name: id, title: null, titleKind: null, firm: null, isRoot: true, order: 0, ...extra });
const look = (species, extra = {}) => ({ petId: 'p', name: 'Pip', species, tint: 'none', tintRgb: [0, 0, 0], tintAlpha: 0, tintCss: 'transparent', ...extra });

test('hslToRgb sanity', () => {
  expect(hslToRgb(0, 100, 50)).toEqual([255, 0, 0]);
  expect(hslToRgb(120, 100, 50)).toEqual([0, 255, 0]);
  expect(hslToRgb(215, 70, 100)).toEqual([255, 255, 255]);
  expect(hslToRgb(215, 70, 0)).toEqual([0, 0, 0]);
});

test('shades alternate dark and light and cycle', () => {
  const dark = shadeTint(215, 1), light = shadeTint(215, 2);
  expect(dark.tintRgb.reduce((a, b) => a + b)).toBeLessThan(light.tintRgb.reduce((a, b) => a + b));
  expect(shadeTint(215, 1 + SHADE_LIGHTNESS.length)).toEqual(dark);
  expect(dark.tintCss).toMatch(/^rgba\(\d+,\d+,\d+,0\.32\)$/);
});

test('agents of one project share its identity; same-type agents get distinct shades; the first stays natural', () => {
  const agents = ['a', 'b', 'c'].map((id, i) => agent(id, { cwd: '/w/proj', order: i }));
  const looks = new Map(agents.map((a) => [a.id, look('orc')]));
  const m = applyMarks({ agents, looks, resolveProject: resolve });
  expect(new Set([...m.values()].map((x) => x.project.key))).toEqual(new Set(['cwd:/w/proj']));
  expect(m.get('a').look).toMatchObject({ shade: 0, tintAlpha: 0 });
  expect(m.get('b').look).toMatchObject({ shade: 1 });
  expect(m.get('c').look.shade).toBe(2);
  expect(m.get('b').look.tintCss).not.toBe(m.get('c').look.tintCss);
  // every shade is in the project's hue family
  expect(m.get('b').mark.ring).toBe(m.get('a').mark.ring);
});

test('a different species in the same project is its own type: natural, not shaded', () => {
  const agents = [agent('a', { cwd: '/w/p', order: 0 }), agent('b', { cwd: '/w/p', order: 1 })];
  const m = applyMarks({ agents, looks: new Map([['a', look('orc')], ['b', look('retro-robot')]]), resolveProject: resolve });
  expect(m.get('a').look.shade).toBe(0);
  expect(m.get('b').look.shade).toBe(0);
});

test('the same species in different projects is not shaded (the project tells them apart)', () => {
  const agents = [agent('a', { cwd: '/w/one', order: 0 }), agent('b', { cwd: '/w/two', order: 1 })];
  const m = applyMarks({ agents, looks: new Map([['a', look('orc')], ['b', look('orc')]]), resolveProject: resolve });
  expect(m.get('a').look.shade).toBe(0);
  expect(m.get('b').look.shade).toBe(0);
  expect(m.get('a').project.hue).not.toBe(m.get('b').project.hue);
  expect(HUES).toContain(m.get('a').project.hue);
});

test('a pet filter you set yourself is respected and does not use up a shade', () => {
  const agents = ['a', 'b', 'c'].map((id, i) => agent(id, { cwd: '/w/p', order: i }));
  const looks = new Map([['a', look('orc', { tint: 'red', tintAlpha: 0.3, tintCss: 'rgba(255,60,60,0.3)' })], ['b', look('orc')], ['c', look('orc')]]);
  const m = applyMarks({ agents, looks, resolveProject: resolve });
  expect(m.get('a').look).toMatchObject({ tint: 'red', tintCss: 'rgba(255,60,60,0.3)', shade: 0 });
  expect(m.get('b').look.shade).toBe(0);   // first natural one
  expect(m.get('c').look.shade).toBe(1);
});

test('role sets the shade of the name plate: lead brighter than critique, same hue', () => {
  const agents = [
    agent('lead', { cwd: '/w/p', firmRole: 'lead', order: 0 }),
    agent('crit', { cwd: '/w/p', firmRole: 'critique', isRoot: false, order: 1 }),
  ];
  const m = applyMarks({ agents, looks: new Map(), resolveProject: resolve });
  expect(m.get('lead').mark.plate).not.toBe(m.get('crit').mark.plate);
  expect(m.get('lead').mark.hue).toBe(m.get('crit').mark.hue);
  expect(m.get('lead').look).toBeNull();
});

test('Firm agents group by Firm project and use its title', () => {
  const agents = [
    agent('l', { firm: { role: 'lead', projectId: 'p9' }, firmRole: 'lead', order: 0 }),
    agent('w', { firm: { role: 'worker', projectId: 'p9' }, firmRole: 'worker', isRoot: false, order: 1 }),
  ];
  const m = applyMarks({ agents, looks: new Map(), resolveProject: resolve, titles: { p9: 'Pricing CLI' } });
  expect(m.get('l').project).toMatchObject({ key: 'firm:p9', name: 'Pricing CLI', emoji: '💲' });
  expect(m.get('w').project.key).toBe('firm:p9');
});

test('Firm-supplied project looks seed the project (emoji, hue, frame, background)', () => {
  const agents = [agent('l', { firm: { role: 'lead', projectId: 'p9' }, firmRole: 'lead', order: 0 })];
  const m = applyMarks({ agents, looks: new Map(), resolveProject: resolve, firmProjects: { p9: { id: 'p9', title: 'Pricing CLI', emoji: '🏦', hue: 215, frame: 'gold', env: 'dungeon' } } });
  expect(m.get('l').project).toMatchObject({ key: 'firm:p9', name: 'Pricing CLI', emoji: '🏦', hue: 215, frame: 'gold', env: 'dungeon' });
  expect(m.get('l').mark.hue).toBe(215);
});
