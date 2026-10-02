const fs = require('fs');
const os = require('os');
const path = require('path');
const { peonDir, isMuted, setMuted } = require('../lib/peon-sound');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peon-sound-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('peonDir honors CLAUDE_CONFIG_DIR, else ~/.claude', () => {
  expect(peonDir({ CLAUDE_CONFIG_DIR: '/x' }, '/h')).toBe('/x/hooks/peon-ping');
  expect(peonDir({}, '/h')).toBe('/h/.claude/hooks/peon-ping');
});

test('isMuted reflects .paused file', () => {
  expect(isMuted(dir)).toBe(false);
  fs.writeFileSync(path.join(dir, '.paused'), '');
  expect(isMuted(dir)).toBe(true);
});

test('setMuted falls back to the file when peon.sh is missing', async () => {
  expect(await setMuted(true, dir)).toBe(true);
  expect(fs.existsSync(path.join(dir, '.paused'))).toBe(true);
  expect(await setMuted(false, dir)).toBe(false);
  expect(fs.existsSync(path.join(dir, '.paused'))).toBe(false);
});

test('setMuted uses peon.sh pause/resume when present', async () => {
  fs.writeFileSync(path.join(dir, 'peon.sh'),
    'case "$1" in pause) touch "$(dirname "$0")/.paused";; resume) rm -f "$(dirname "$0")/.paused";; esac\n');
  expect(await setMuted(true, dir)).toBe(true);
  expect(await setMuted(false, dir)).toBe(false);
});
