const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRoster } = require('../lib/roster');
const { assignPets } = require('../lib/assignment');
const { shouldOpenChatOnLaunch, migrateCornerView, species } = require('../lib/euphonia/launch');

const mkRoster = (installed = ['orc', 'capybara', 'trillian']) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ros-')), 'pets.json');
  return createRoster({ file, isSpecies: (s) => installed.includes(s) });
};
const spec = { id: 'euphonia', name: 'Euphonia', species: ['trillian', 'orc'] };

test('Euphonia is pinned first, is the lead, and is benched from assignment', () => {
  const r = mkRoster();
  r.create({ species: 'orc' }); r.create({ species: 'capybara' });
  const pet = r.pinReserved(spec);
  expect(r.list()[0].id).toBe('euphonia');
  expect(r.lead().id).toBe('euphonia');
  expect(pet).toMatchObject({ species: 'trillian', reserved: true, assignment: { type: 'bench' } });
  expect(r.list()).toHaveLength(3);
  r.pinReserved(spec);   // idempotent
  expect(r.list()).toHaveLength(3);
});

test('she cannot be removed or displaced as lead; species falls back when art is missing', () => {
  const r = mkRoster(['orc']);
  const other = r.create({ species: 'orc' });
  const e = r.pinReserved(spec);
  expect(e.species).toBe('orc');
  expect(() => r.remove('euphonia')).toThrow(/built in/);
  expect(() => r.setLead(other.id)).toThrow(/lead pet/);
  expect(() => mkRoster([]).pinReserved(spec)).toThrow(/No installed species/);
});

test('agent sessions are never assigned to her, even with no other pet free', () => {
  const r = mkRoster();
  const o = r.create({ species: 'orc' });
  r.pinReserved(spec);
  const sessions = [{ id: 's1' }, { id: 's2' }, { id: 's3' }];
  const picks = assignPets({ pets: r.list(), lead: 'euphonia', sessions });
  expect([...picks.values()].every((id) => id === o.id)).toBe(true);
  const only = mkRoster(); only.pinReserved(spec);
  // a roster of only her still resolves (nothing else exists); documented edge
  expect(assignPets({ pets: only.list(), lead: 'euphonia', sessions }).get('s1')).toBe('euphonia');
});

test('open chat on launch: default false; true only for the reserved lead; saved chat view migrates to pet', () => {
  const views = ['pet', 'grid', 'speaker', 'presenter'];
  expect(shouldOpenChatOnLaunch({ leadId: 'euphonia' })).toBe(false);
  expect(shouldOpenChatOnLaunch({ openChatOnLaunch: true, leadId: 'euphonia' })).toBe(true);
  expect(shouldOpenChatOnLaunch({ openChatOnLaunch: true, leadId: 'pet_1' })).toBe(false);
  expect(migrateCornerView('chat', views)).toBe('pet');
  expect(migrateCornerView('grid', views)).toBe('grid');
  expect(migrateCornerView(undefined, views)).toBe('pet');
});

test('the pet window has no chat view anywhere in its source', () => {
  for (const f of ['../main.js', '../renderer/app.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    const line = src.split('\n').find((l) => l.startsWith('const CORNER_VIEWS'));
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/chat/);
  }
  expect(fs.readFileSync(path.join(__dirname, '../renderer/index.html'), 'utf8')).not.toMatch(/data-v="chat"|id="chat-list"/);
});

test('species candidates', () => { expect(species({ species: 'x' })).toEqual(['x', 'trillian', 'orc']); });
