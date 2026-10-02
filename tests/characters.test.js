const fs = require('fs');
const os = require('os');
const path = require('path');
const { listCharacters, isKnownCharacter } = require('../lib/characters');

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'chars-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const mk = (name, file = 'sprite-atlas.png') => {
  fs.mkdirSync(path.join(root, name), { recursive: true });
  fs.writeFileSync(path.join(root, name, file), 'x');
};

test('lists bundled first, then custom folders that contain an atlas', () => {
  mk('robot'); mk('empty', 'readme.txt'); mk('bad name!');
  const list = listCharacters(['orc', 'capybara'], root);
  expect(list.map((c) => c.name)).toEqual(['orc', 'capybara', 'robot']);
  expect(list[2]).toEqual({ name: 'robot', builtin: false, custom: true });
});

test('a custom folder can override a bundled character', () => {
  mk('orc');
  expect(listCharacters(['orc'], root)).toEqual([{ name: 'orc', builtin: true, custom: true }]);
});

test('missing custom root is fine; isKnownCharacter rejects unknown and traversal', () => {
  const list = listCharacters(['orc'], path.join(root, 'nope'));
  expect(list).toHaveLength(1);
  expect(isKnownCharacter('orc', list)).toBe(true);
  for (const bad of ['robot', '../orc', '', null]) expect(isKnownCharacter(bad, list)).toBe(false);
});
