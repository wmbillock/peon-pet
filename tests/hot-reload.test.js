const fs = require('fs');
const os = require('os');
const path = require('path');
const { classify, watchApp } = require('../lib/hot-reload');

test('classify routes files to the right reload level', () => {
  expect(classify('main.js')).toBe('app');
  expect(classify('lib/peon-packs.js')).toBe('app');
  expect(classify('package.json')).toBe('app');
  expect(classify('renderer/app.js')).toBe('windows');
  expect(classify('dashboard/index.html')).toBe('windows');
  expect(classify('grid/grid.js')).toBe('windows');
  expect(classify('preload.js')).toBe('windows');
});

test('classify ignores noise', () => {
  for (const f of ['node_modules/three/x.js', '.git/index', 'tests/a.test.js', 'README.md', 'docs/x.png',
    'foo.log', '.DS_Store', 'lib/.DS_Store', 'main.js~', 'unrelated.txt', '']) {
    expect(classify(f)).toBe('ignore');
  }
});

test('watchApp debounces a burst and escalates to app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hot-'));
  fs.mkdirSync(path.join(dir, 'renderer'));
  fs.mkdirSync(path.join(dir, 'lib'));
  const calls = [];
  const w = watchApp(dir, (k, f) => calls.push([k, f]), 100);
  await new Promise((r) => setTimeout(r, 100));
  fs.writeFileSync(path.join(dir, 'renderer', 'a.js'), '1');
  fs.writeFileSync(path.join(dir, 'lib', 'b.js'), '1');
  fs.writeFileSync(path.join(dir, 'notes.md'), '1');
  await new Promise((r) => setTimeout(r, 500));
  w.close();
  fs.rmSync(dir, { recursive: true, force: true });
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe('app');
});
