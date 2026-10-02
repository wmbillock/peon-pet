const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRoster } = require('../lib/roster');
const { assignPets } = require('../lib/assignment');

let dir, roster;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-'));
  roster = createRoster({
    file: path.join(dir, 'pets.json'),
    isSpecies: (s) => ['orc', 'bearded-dragon'].includes(s),
    isEnv: (e) => e === 'dungeon',
  });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('roster', () => {
  test('create gives each pet its own id, a friendly default name, and defaults', () => {
    const a = roster.create({ species: 'orc' });
    const b = roster.create({ species: 'orc' });
    expect(a.id).not.toBe(b.id);
    expect(a.name).toBeTruthy();
    expect(a.name).not.toBe(b.name);
    expect(a).toMatchObject({ tint: 'none', env: null, facts: [], assignment: null, species: 'orc' });
  });

  test('first pet becomes lead; lead can change; removing lead promotes another; last pet is protected', () => {
    const a = roster.create({ species: 'orc' });
    const b = roster.create({ species: 'bearded-dragon', name: 'Spike' });
    expect(roster.lead().id).toBe(a.id);
    roster.setLead(b.id);
    expect(roster.lead().name).toBe('Spike');
    roster.remove(b.id);
    expect(roster.lead().id).toBe(a.id);
    expect(() => roster.remove(a.id)).toThrow(/at least one/);
  });

  test('update validates names, species, tint, env, facts and assignment', () => {
    const p = roster.create({ species: 'orc' });
    roster.update(p.id, { name: '  Gruk  ', tint: 'red', env: 'dungeon', facts: [{ key: 'Likes', value: 'tests' }, { key: '', value: 'dropped' }], assignment: { type: 'agent', value: 'codex' } });
    expect(roster.get(p.id)).toMatchObject({ name: 'Gruk', tint: 'red', env: 'dungeon', assignment: { type: 'agent', value: 'codex' } });
    expect(roster.get(p.id).facts).toEqual([{ key: 'Likes', value: 'tests' }]);
    expect(() => roster.update(p.id, { species: 'nope' })).toThrow(/Unknown species/);
    expect(() => roster.update(p.id, { tint: 'chartreuse' })).toThrow(/Unknown tint/);
    expect(() => roster.update(p.id, { env: 'mars' })).toThrow(/Unknown environment/);
    expect(() => roster.update(p.id, { assignment: { type: 'wizard', value: 'x' } })).toThrow(/Unknown assignment/);
    expect(() => roster.update(p.id, { assignment: { type: 'project', value: '  ' } })).toThrow(/value/);
    roster.update(p.id, { env: null, assignment: null });
    expect(roster.get(p.id)).toMatchObject({ env: null, assignment: null });
  });

  test('blank name falls back to a suggestion; persists across instances', () => {
    const p = roster.create({ species: 'orc', name: '   ' });
    expect(p.name.length).toBeGreaterThan(0);
    const again = createRoster({ file: path.join(dir, 'pets.json'), isSpecies: () => true });
    expect(again.list()).toHaveLength(1);
  });

  test('ensureSeed only creates when empty', () => {
    roster.ensureSeed('orc');
    roster.ensureSeed('orc');
    expect(roster.list()).toHaveLength(1);
  });

  test('repointSpecies moves pets off removed art', () => {
    roster.create({ species: 'bearded-dragon' }); roster.create({ species: 'orc' });
    expect(roster.repointSpecies('bearded-dragon', 'orc')).toBe(1);
    expect(roster.list().every((p) => p.species === 'orc')).toBe(true);
  });
});

describe('assignPets', () => {
  const pet = (id, assignment = null) => ({ id, assignment });
  const sess = (id, extra = {}) => ({ id, cwd: '/w/proj', agent: 'claude', hot: false, lastActive: 0, ...extra });

  test('session pin beats project pin beats agent pin beats auto', () => {
    const pets = [pet('auto'), pet('agent', { type: 'agent', value: 'claude' }), pet('proj', { type: 'project', value: '/w/proj' }), pet('sess', { type: 'session', value: 's1' })];
    const r = assignPets({ pets, lead: 'auto', sessions: [sess('s1'), sess('s2'), sess('s3', { cwd: '/elsewhere' })] });
    expect(r.get('s1')).toBe('sess');
    expect(r.get('s2')).toBe('proj');
    expect(r.get('s3')).toBe('agent');
  });

  test('longest matching project wins; prefix match respects path boundaries', () => {
    const pets = [pet('a', { type: 'project', value: '/w' }), pet('b', { type: 'project', value: '/w/proj' })];
    expect(assignPets({ pets, lead: 'a', sessions: [sess('s', { cwd: '/w/proj/sub' })] }).get('s')).toBe('b');
    expect(assignPets({ pets, lead: 'a', sessions: [sess('s', { cwd: '/w/project-x' })] }).get('s')).toBe('a');
    expect(assignPets({ pets: [pet('b', { type: 'project', value: '/w/proj' }), pet('z')], lead: 'z', sessions: [sess('s', { cwd: '/w/project-x' })] }).get('s')).toBe('z');
  });

  test('an army spreads out: each session gets a distinct auto pet before any repeats', () => {
    const pets = [pet('a'), pet('b'), pet('c')];
    const sessions = [sess('1'), sess('2'), sess('3'), sess('4')];
    const r = assignPets({ pets, lead: 'a', sessions });
    expect(new Set([r.get('1'), r.get('2'), r.get('3')]).size).toBe(3);
    expect(['a', 'b', 'c']).toContain(r.get('4'));
  });

  test('benched pets are never auto-assigned; with none left the lead is the fallback', () => {
    const pets = [pet('lead', { type: 'bench' }), pet('other', { type: 'bench' })];
    expect(assignPets({ pets, lead: 'lead', sessions: [sess('s')] }).get('s')).toBe('lead');
  });

  test('auto picks are sticky while the session lives and released after', () => {
    const sticky = new Map();
    const pets = [pet('a'), pet('b'), pet('c')];
    const first = assignPets({ pets, lead: 'a', sessions: [sess('1', { hot: true }), sess('2')], sticky });
    // Order flips (2 becomes hot) but each keeps its pet.
    const second = assignPets({ pets, lead: 'a', sessions: [sess('1'), sess('2', { hot: true })], sticky });
    expect(second.get('1')).toBe(first.get('1'));
    expect(second.get('2')).toBe(first.get('2'));
    assignPets({ pets, lead: 'a', sessions: [], sticky });
    expect(sticky.size).toBe(0);
  });

  test('empty roster yields nothing; hot sessions pick first', () => {
    expect(assignPets({ pets: [], lead: null, sessions: [sess('s')] }).size).toBe(0);
    const r = assignPets({ pets: [pet('a'), pet('b')], lead: 'a', sessions: [sess('cold'), sess('hot', { hot: true })] });
    expect(r.get('hot')).toBe('a');
    expect(r.get('cold')).toBe('b');
  });
});

describe('assignPets with ranks', () => {
  const pet = (id, assignment = null) => ({ id, assignment });
  const sess = (id, extra = {}) => ({ id, cwd: '/w', agent: 'claude', hot: true, lastActive: 0, ...extra });

  test('masters pick pets before workers even when workers are busier', () => {
    const pets = [pet('first'), pet('second')];
    const r = assignPets({ pets, lead: 'first', sessions: [sess('w1', { rank: 1, lastActive: 99 }), sess('m1', { rank: 0, lastActive: 1 })] });
    expect(r.get('m1')).toBe('first');
    expect(r.get('w1')).toBe('second');
  });
});
