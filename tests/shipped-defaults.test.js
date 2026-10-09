const path = require('path');
const { findViolations, shippableSpecies, collectDefaults, SAFE_PACKS } = require('../lib/shipped-defaults');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');

test('no shipped default references a third-party, locally generated or unpublished species or any unapproved sound pack', () => {
  expect(findViolations({ root })).toEqual([]);
});

test('the check covers Euphonia, casting preferences and seeded agent kinds', () => {
  const d = collectDefaults(root);
  const where = d.map((x) => x.where).join('\n');
  expect(where).toMatch(/Euphonia default species/);
  expect(where).toMatch(/shipped casting preferences: default/);
  expect(where).toMatch(/seeded agent kind/);
  expect(d.some((x) => x.kind === 'pack')).toBe(false);   // Euphonia ships with no pack
});

test('control: the detector fires on a third-party species, an unpublished one, one with no art, and any pack', () => {
  const bad = [
    { kind: 'species', where: 't', value: 'trillian' },          // third-party character (localOnly)
    { kind: 'species', where: 't', value: 'french-horn' },       // generated locally, never published
    { kind: 'species', where: 't', value: 'princess-peach' },    // third-party
    { kind: 'species', where: 't', value: 'no-such-art' },       // nothing tracked
    { kind: 'pack', where: 't', value: 'ra2_eva_commander' },    // third-party audio
    { kind: 'pack', where: 't', value: 'sc_battlecruiser' },
  ];
  expect(findViolations({ root, defaults: bad }).map((v) => v.value)).toEqual(bad.map((b) => b.value));
  const ok = [{ kind: 'species', where: 't', value: 'orc' }, { kind: 'species', where: 't', value: 'weeping-willow' }];
  expect(findViolations({ root, defaults: ok })).toEqual([]);
});

test('shippable species are exactly those with tracked, non-excluded art', () => {
  const ok = shippableSpecies(root);
  for (const s of ['orc', 'capybara', 'weeping-willow', 'eighth-note']) expect(ok.has(s)).toBe(true);
  for (const s of ['trillian', 'princess-peach', 'kirby', 'french-horn', 'willow-maestro']) expect(ok.has(s)).toBe(false);
  expect(SAFE_PACKS).toEqual([]);
});

test('the local-only preferences file is never tracked', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  expect(tracked).not.toMatch(/character-preferences\.local\.json/);
});

test('the script exits 0 on the shipped tree', () => {
  expect(() => execFileSync('node', [path.join(root, 'scripts/check-shipped-defaults.js')], { cwd: root, stdio: 'pipe' })).not.toThrow();
});
