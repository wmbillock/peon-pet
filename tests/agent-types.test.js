const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAgentTypeStore, cleanType, pickType, signalsOf, CATEGORIES } = require('../lib/agent-types');

let file;
beforeEach(() => { file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'at-')), 'agent-types.json'); });

const T = (slug, category, traits, species = 'orc') => ({ slug, name: slug, category, species, traits, personality: '', tint: null });

test('first run seeds types for every role; they persist and can be edited or removed', () => {
  const s = createAgentTypeStore({ file });
  const cats = new Set(s.list().map((t) => t.category));
  for (const c of CATEGORIES) expect(cats.has(c)).toBe(true);
  s.put({ slug: 'my-type', name: 'Mine', category: 'worker', species: 'orc', traits: 'Perf, cache', personality: 'fast' });
  expect(createAgentTypeStore({ file }).get('my-type')).toMatchObject({ traits: ['perf', 'cache'], tint: null });
  s.remove('my-type');
  expect(createAgentTypeStore({ file }).get('my-type')).toBeNull();
});

test('cleanType validates id, category, species, traits and filter', () => {
  const ok = { slug: 'a', name: 'A', category: 'worker', species: 'orc' };
  expect(() => cleanType({ ...ok, slug: 'Bad Id' })).toThrow(/Type id/);
  expect(() => cleanType({ ...ok, name: ' ' })).toThrow(/Name/);
  expect(() => cleanType({ ...ok, category: 'wizard' })).toThrow(/Category/);
  expect(() => cleanType(ok, { isSpecies: () => false })).toThrow(/species/);
  expect(() => cleanType({ ...ok, traits: ['bad trait!'] })).toThrow(/trait/i);
  expect(() => cleanType({ ...ok, tint: 'nope' }, { isTint: () => false })).toThrow(/filter/);
});

test('pickType prefers trait overlap, within the agent\'s category only', () => {
  const types = [T('web', 'worker', ['frontend', 'ui']), T('api', 'worker', ['backend', 'api']), T('rev', 'review', ['frontend'])];
  const agent = { id: 'a', isRoot: false, firmRole: 'worker', title: 'Add the chat UI', cwd: '/w/frontend-app', agent: 'claude' };
  expect(pickType({ agent, types }).slug).toBe('web');
  expect(pickType({ agent: { ...agent, title: 'Fix API handler', cwd: '/w/svc' }, types }).slug).toBe('api');
  expect(pickType({ agent: { ...agent, firmRole: 'scout' }, types })).toBeNull();
});

test('ties go to the least-used type, so duplicates get variety', () => {
  const types = [T('one', 'worker', []), T('two', 'worker', [])];
  const agent = { id: 'a', isRoot: false, firmRole: 'worker' };
  expect(pickType({ agent, types, usage: new Map() }).slug).toBe('one');
  expect(pickType({ agent, types, usage: new Map([['one', 1]]) }).slug).toBe('two');
});

test('signals come from role, title, folder, project and tool', () => {
  const s = signalsOf({ firmRole: 'inspector', title: 'Security pass', cwd: '/w/my-app', agent: 'codex' }, { name: 'Pricing CLI' });
  for (const w of ['inspector', 'security', 'app', 'codex', 'pricing', 'cli']) expect(s.has(w)).toBe(true);
});

test('pins validate, persist, and disappear with their type', () => {
  const s = createAgentTypeStore({ file });
  expect(() => s.pin('session', 'x', 'nope')).toThrow(/Unknown/);
  s.pin('session', 'sess1', 'tinkerer'); s.pin('project', 'cwd:/w/a', 'tinkerer');
  expect(createAgentTypeStore({ file }).pins()).toEqual({ sessions: { sess1: 'tinkerer' }, projects: { 'cwd:/w/a': 'tinkerer' } });
  s.remove('tinkerer');
  expect(s.pins()).toEqual({ sessions: {}, projects: {} });
  s.pin('session', 'sess1', null);
});
