'use strict';
// Euphonia's OWN knowledge base, Libretto style: curated markdown, an index, a dated append-only log.
// Seeding never overwrites; it only creates what is missing.
const fs = require('fs');
const path = require('path');

const day = (d) => d.toISOString().slice(0, 10);

function seedFiles({ user, now }) {
  return {
    'INDEX.md': `# Euphonia knowledge base index\n\nEuphonia's own memory for ${user}. Curated, linked, small. One line per page.\n\n- [identity.md](identity.md) - who Euphonia is and how it works with ${user}\n- [log.md](log.md) - dated, append-only log of what was learned\n\nAdd a line here for every page you create.\n`,
    'identity.md': `# Identity\n\nEuphonia is ${user}'s personal assistant. It is not The Firm's Management agent.\n\n- Memory: this knowledge base (writable) plus read access to ${user}'s hub (read-only).\n- Style: short, human, action first.\n- Durable things learned about ${user} or the work go in this knowledge base, never in the hub.\n\n## Preferences learned\n\n(none yet)\n`,
    'log.md': `# Log\n\nAppend-only. One dated entry per durable thing learned; never rewrite old entries.\n\n## ${day(now)}\n- Knowledge base created.\n`,
  };
}

// Returns the names of the files it created.
function seedKb(kbDir, { user = 'the user', now = new Date() } = {}) {
  fs.mkdirSync(kbDir, { recursive: true, mode: 0o700 });
  const created = [];
  for (const [name, text] of Object.entries(seedFiles({ user, now }))) {
    try { fs.writeFileSync(path.join(kbDir, name), text, { flag: 'wx' }); created.push(name); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  return created;
}

module.exports = { seedKb };
