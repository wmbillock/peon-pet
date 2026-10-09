const { applyMarks, shadeTint, hslToRgb, hsvToRgb, HUE_STEPS } = require('../lib/marks');
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

test('hsvToRgb sanity', () => {
  expect(hsvToRgb(0, 1, 1)).toEqual([255, 0, 0]);
  expect(hsvToRgb(120, 1, 1)).toEqual([0, 255, 0]);
  expect(hsvToRgb(240, 1, 1)).toEqual([0, 0, 255]);
  expect(hsvToRgb(-120, 1, 1)).toEqual([0, 0, 255]);   // negative hues wrap
  expect(hsvToRgb(10, 0, 0.5)).toEqual([128, 128, 128]);
});

test('duplicate shades are bright, different from each other, and cycle', () => {
  const shades = HUE_STEPS.map((_, i) => shadeTint(215, i + 1));
  for (const s of shades) expect(Math.max(...s.tintRgb)).toBe(255);            // full value: never dim
  expect(new Set(shades.map((s) => s.tintRgb.join())).size).toBe(HUE_STEPS.length);
  expect(shadeTint(215, 1 + HUE_STEPS.length)).toEqual(shades[0]);
  expect(shades[0].tintCss).toMatch(/^rgba\(\d+,\d+,\d+,0\.4\)$/);
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

test('the border colour says what kind of agent it is, the emoji which project: same project, different kinds, different colours', () => {
  const agents = [
    agent('lead', { cwd: '/w/p', firmRole: 'lead', order: 0 }),
    agent('crit', { cwd: '/w/p', firmRole: 'critique', isRoot: false, order: 1 }),
  ];
  const m = applyMarks({ agents, looks: new Map(), resolveProject: resolve });
  expect(m.get('lead').mark.ring).not.toBe(m.get('crit').mark.ring);
  expect(m.get('lead').mark.hue).toBe(28);                      // lead
  expect(m.get('crit').mark.hue).toBe(315);                     // critique
  expect(m.get('lead').mark.emoji).toBe(m.get('crit').mark.emoji);   // one project, one emoji
  expect(m.get('lead').look).toBeNull();
});

test('a kind with its own hue colours the border; shades only separate copies of the same kind on the same pet', () => {
  const kind = (slug, hue) => ({ ...look('orc'), type: { slug, hue, category: 'worker' } });
  const agents = ['a', 'b', 'c', 'd'].map((id, i) => agent(id, { cwd: '/w/p', order: i }));
  const looks = new Map([['a', kind('smith', 100)], ['b', kind('smith', 100)], ['c', kind('tinker', 200)], ['d', kind('smith', 100)]]);
  const m = applyMarks({ agents, looks, resolveProject: resolve });
  expect(m.get('a').mark.hue).toBe(100);
  expect(m.get('c').mark.hue).toBe(200);
  expect(m.get('a').look.shade).toBe(0);
  expect(m.get('b').look.shade).toBe(1);
  expect(m.get('c').look.shade).toBe(0);     // a different kind on the same pet is told apart by its border, not a shade
  expect(m.get('d').look.shade).toBe(2);
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
  expect(m.get('l').mark.emoji).toBe('🏦');   // the project's emoji; the border colour is the kind's, not the project's
});

test('an assignment moves an agent to the chosen project, whatever its folder says', () => {
  const agents = [agent('a', { cwd: '/w/one', order: 0 }), agent('b', { cwd: '/w/one', order: 1 })];
  const m = applyMarks({ agents, looks: new Map(), resolveProject: resolve, assignments: { b: 'cwd:/w/two' } });
  expect(m.get('a').project.key).toBe('cwd:/w/one');
  expect(m.get('b').project.key).toBe('cwd:/w/two');
});
