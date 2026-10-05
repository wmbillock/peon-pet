const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRoster } = require('../lib/roster');
const { assignPets } = require('../lib/assignment');
const { initialCornerView, clickTarget, species } = require('../lib/euphonia/launch');

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

test('open chat on launch: default true when she leads; config false restores the saved view', () => {
  const views = ['pet', 'grid', 'speaker', 'presenter', 'chat'];
  expect(initialCornerView({ saved: 'grid', views, leadId: 'euphonia' })).toBe('chat');
  expect(initialCornerView({ saved: 'grid', views, leadId: 'euphonia', openChatOnLaunch: true })).toBe('chat');
  expect(initialCornerView({ saved: 'grid', views, leadId: 'euphonia', openChatOnLaunch: false })).toBe('grid');
  expect(initialCornerView({ saved: 'nope', views, leadId: 'euphonia', openChatOnLaunch: false })).toBe('pet');
  expect(initialCornerView({ saved: 'grid', views, leadId: 'pet_1' })).toBe('grid');
});

test('clicking her sprite opens chat; other leads keep stepping through views', () => {
  const views = ['pet', 'grid', 'chat'];
  expect(clickTarget({ isEuphoniaLead: true, cornerView: 'pet', views })).toBe('chat');
  expect(clickTarget({ isEuphoniaLead: false, cornerView: 'pet', views })).toBe('grid');
  expect(species({ species: 'x' })).toEqual(['x', 'trillian', 'orc']);
});
