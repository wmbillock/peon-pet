const path = require('path');
const { findClaude, childPath } = require('../lib/euphonia/find-claude');

const exists = (...ps) => (p) => ps.includes(p);

test('launchd\'s minimal PATH still finds claude in ~/.local/bin', () => {
  const env = { PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' };
  const r = findClaude({ env, home: '/Users/me', exec: exists('/Users/me/.local/bin/claude'), readdir: () => [] });
  expect(r).toBe('/Users/me/.local/bin/claude');
});

test('PATH wins over the fallbacks, and an explicit override wins over everything', () => {
  const both = exists('/usr/local/bin/claude', '/Users/me/.local/bin/claude', '/custom/claude');
  expect(findClaude({ env: { PATH: '/usr/local/bin' }, home: '/Users/me', exec: both, readdir: () => [] })).toBe('/usr/local/bin/claude');
  expect(findClaude({ env: { PATH: '/usr/local/bin', PEON_PET_CLAUDE_BIN: '/custom/claude' }, home: '/Users/me', exec: both, readdir: () => [] })).toBe('/custom/claude');
  expect(findClaude({ env: { PEON_PET_CLAUDE_BIN: '/missing' }, home: '/Users/me', exec: exists('/Users/me/.local/bin/claude'), readdir: () => [] })).toBe('/Users/me/.local/bin/claude');
});

test('nvm installs are searched newest first; nothing found gives null', () => {
  const readdir = () => ['v18.0.0', 'v20.10.0', 'v9.1.0'];
  expect(findClaude({ env: { PATH: '' }, home: '/h', exec: exists('/h/.nvm/versions/node/v20.10.0/bin/claude', '/h/.nvm/versions/node/v18.0.0/bin/claude'), readdir }))
    .toBe('/h/.nvm/versions/node/v20.10.0/bin/claude');
  expect(findClaude({ env: { PATH: '' }, home: '/h', exec: () => false, readdir })).toBeNull();
});

test('the child gets its own directory and the usual install dirs ahead of the launcher PATH, without duplicates', () => {
  const p = childPath('/Users/me/.local/bin/claude', { PATH: '/usr/bin:/usr/local/bin' }, '/Users/me').split(path.delimiter);
  expect(p[0]).toBe('/Users/me/.local/bin');
  expect(p).toContain('/usr/bin');
  expect(p.filter((x) => x === '/usr/local/bin')).toHaveLength(1);
});
