const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadPrefs, mergePrefs, pickCast, weightOf } = require('../lib/character-preferences');

const prefs = loadPrefs(null, { local: false });   // the shipped file only, so results do not depend on a machine's local additions
const ready = new Set(Object.keys(prefs.default));
const KINDS = ['lead', 'worker', 'worker', 'inspector', 'scout', 'plan', 'critique', 'review', 'management'];
const roster = (n) => Array.from({ length: n }, (_, i) => ({ id: `agent-${String(i).padStart(3, '0')}`, kind: KINDS[i % KINDS.length] }));
const cast = (seed, n = 40, extra = {}) => pickCast({ agents: roster(n), prefs, seed, ready, ...extra });
const tally = (m) => { const t = new Map(); for (const sp of m.values()) t.set(sp, (t.get(sp) || 0) + 1); return t; };

test('shipped preferences are varied and do not make the orc a default', () => {
  expect(Object.keys(prefs.default).length).toBe(8);   // only species published in the repo
  for (const k of ['lead', 'worker', 'inspector', 'scout', 'plan', 'critique', 'review', 'management']) {
    expect(Object.keys(prefs.kinds[k] || {})).not.toContain('orc');
  }
  expect(weightOf(prefs, 'worker', 'orc')).toBeLessThan(weightOf(prefs, 'worker', 'capybara'));
});

test('deterministic for a seed and agent id; independent of unrelated calls', () => {
  const a = cast('seed-1'), b = cast('seed-1');
  expect([...a]).toEqual([...b]);
  expect(cast('seed-1', 12).get('agent-003')).toBe(cast('seed-1', 12).get('agent-003'));
});

test('different seeds give different rosters', () => {
  const a = [...cast('seed-A').values()].join(), b = [...cast('seed-B').values()].join();
  expect(a).not.toBe(b);
});

test('variety: 40 agents stay under the share cap and never repeat more than twice in a row', () => {
  for (const seed of ['s1', 's2', 's3', 'abc', '99']) {
    const m = cast(seed);
    const ids = roster(40).map((a) => m.get(a.id));
    for (const n of tally(m).values()) expect(n).toBeLessThanOrEqual(10);   // 25% of 40
    for (let i = 2; i < ids.length; i++) expect(ids[i] === ids[i - 1] && ids[i] === ids[i - 2]).toBe(false);
  }
});

test('the rare orc is under-represented over many installs', () => {
  let orcs = 0, total = 0;
  for (let s = 0; s < 60; s++) { const m = cast(`install-${s}`, 20); orcs += tally(m).get('orc') || 0; total += 20; }
  expect(orcs / total).toBeLessThan(0.04);   // uniform would be ~3% of 32; the rare weight pushes it well under
  const uniform = 1 / ready.size;
  expect(orcs / total).toBeLessThan(uniform);
});

test('Forge overrides win, count toward caps, and clearing falls back to the seeded pick', () => {
  const base = cast('seed-1');
  const forced = cast('seed-1', 40, { override: (id) => (id === 'agent-005' ? 'orc' : null) });
  expect(forced.get('agent-005')).toBe('orc');
  const cleared = cast('seed-1', 40, { override: () => null });
  expect(cleared.get('agent-005')).toBe(base.get('agent-005'));
  const all = cast('seed-1', 40, { override: () => 'orc' });
  expect(tally(all).get('orc')).toBe(40);   // an explicit choice is never second-guessed
});

test('sticky picks are kept and unready species are never chosen', () => {
  const sticky = new Map([['agent-001', 'capybara']]);
  expect(cast('x', 10, { sticky }).get('agent-001')).toBe('capybara');
  const small = pickCast({ agents: roster(10), prefs, seed: 'x', ready: new Set(['capybara', 'retro-robot', 'eighth-note']) });
  for (const sp of small.values()) expect(['capybara', 'retro-robot', 'eighth-note']).toContain(sp);
});

test('a user preferences file adds to and overrides the shipped one', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cp-')), 'character-preferences.json');
  fs.writeFileSync(f, JSON.stringify({ exclude: ['capybara'], kinds: { worker: { 'retro-robot': 50 } }, variety: { maxShare: 0.5 } }));
  const p = loadPrefs(f);
  expect(weightOf(p, 'scout', 'capybara')).toBe(0);
  expect(p.kinds.worker['retro-robot']).toBe(50);
  expect(p.kinds.scout).toBeDefined();           // untouched kinds survive
  expect(p.variety).toMatchObject({ maxShare: 0.5, maxConsecutive: 2 });
  expect(mergePrefs(prefs, 'garbage')).toBe(prefs);
});
