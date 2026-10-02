const { localOnlySlugs, excluded } = require('../lib/dist-filter');

test('local-only species come from the species metadata', () => {
  expect(localOnlySlugs()).toEqual(expect.arrayContaining(['hello-kitty', 'terra-ff6', 'the-dude', 'kirby']));
  expect(localOnlySlugs()).not.toContain('orc');
  expect(localOnlySlugs()).not.toContain('french-horn');
});

test('excludes local-only art and docs plus internal Firm notes, nothing else', () => {
  const files = ['renderer/assets/terra-ff6-sprite-atlas.png', 'renderer/assets/hello-kitty-borders.png', 'docs/art-prompts/terra-ff6.md',
    'renderer/assets/orc-sprite-atlas.png', 'docs/firm/INTEGRATION.md', 'lib/firm-patch.js', 'lib/firm-client.js', 'main.js'];
  expect(excluded(files)).toEqual(['renderer/assets/terra-ff6-sprite-atlas.png', 'renderer/assets/hello-kitty-borders.png', 'docs/art-prompts/terra-ff6.md', 'docs/firm/INTEGRATION.md', 'lib/firm-patch.js']);
});
