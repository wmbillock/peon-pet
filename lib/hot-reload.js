const fs = require('fs');
const path = require('path');

// What a changed file requires: nothing, a window reload, or a full app restart.
function classify(relPath) {
  const p = relPath.split(path.sep).join('/');
  if (!p || /(^|\/)(node_modules|\.git|tests|docs|scripts)(\/|$)/.test(p)) return 'ignore';
  if (/(\.md|\.log|\.tmp|\.DS_Store)$/.test(p) || p.endsWith('~')) return 'ignore';
  if (/^(renderer|dashboard)\//.test(p) || p === 'preload.js') return 'windows';
  if (p === 'main.js' || p === 'package.json' || p.startsWith('lib/')) return 'app';
  return 'ignore';
}

// Watch the app dir; calls onChange('windows'|'app', file) after a short quiet period.
// 'app' wins when both kinds of change land in one burst.
function watchApp(rootDir, onChange, debounceMs = 400) {
  let timer = null;
  let pending = null;
  let lastFile = '';
  const watcher = fs.watch(rootDir, { recursive: true }, (_evt, file) => {
    if (!file) return;
    const kind = classify(file);
    if (kind === 'ignore') return;
    if (pending !== 'app') pending = kind;
    lastFile = file;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const k = pending;
      pending = null;
      onChange(k, lastFile);
    }, debounceMs);
  });
  return { close: () => { clearTimeout(timer); watcher.close(); } };
}

module.exports = { classify, watchApp };
