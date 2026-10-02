const fs = require('fs');
const path = require('path');

const CHAR_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

// Bundled characters plus any user-installed folder (<userData>/characters/<name>/sprite-atlas.png).
function listCharacters(bundledNames, customRoot) {
  const found = new Map(bundledNames.map((name) => [name, { name, builtin: true, custom: false }]));
  let dirs = [];
  try { dirs = fs.readdirSync(customRoot, { withFileTypes: true }); } catch { /* none installed */ }
  for (const d of dirs) {
    if (!d.isDirectory() || !CHAR_NAME_RE.test(d.name)) continue;
    if (!fs.existsSync(path.join(customRoot, d.name, 'sprite-atlas.png'))) continue;
    found.set(d.name, { name: d.name, builtin: found.has(d.name), custom: true });
  }
  return [...found.values()];
}

function isKnownCharacter(name, list) {
  return typeof name === 'string' && CHAR_NAME_RE.test(name) && list.some((c) => c.name === name);
}

module.exports = { listCharacters, isKnownCharacter, CHAR_NAME_RE };
