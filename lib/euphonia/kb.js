'use strict';
// Euphonia's OWN knowledge base, Libretto style: curated markdown, an index, a dated append-only log.
// Seeding never overwrites; it only creates what is missing.
const fs = require('fs');
const path = require('path');

// Local calendar day (the log is read by a person on this machine; the grants' end-of-day is local too).
const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function seedFiles({ user, now }) {
  return {
    'INDEX.md': `# Euphonia knowledge base index\n\nEuphonia's own memory for ${user}. Curated, linked, small. One line per page.\n\n- [identity.md](identity.md) - who Euphonia is and how it works with ${user}\n- [settings.md](settings.md) - where my settings and permissions live (not mine to change)\n- [log.md](log.md) - dated, append-only log of what was learned\n\nAdd a line here for every page you create.\n`,
    'identity.md': `# Identity\n\nEuphonia is ${user}'s personal assistant. It is not The Firm's Management agent.\n\n- Memory: this knowledge base (writable) plus read access to ${user}'s hub (read-only).\n- Style: short, human, action first.\n- Durable things learned about ${user} or the work go in this knowledge base, never in the hub.\n\n## Preferences learned\n\n(none yet)\n`,
    'log.md': `# Log\n\nAppend-only. One dated entry per durable thing learned; never rewrite old entries.\n\n## ${day(now)}\n- Knowledge base created.\n`,
  };
}

// settings.md is APP-OWNED: rewritten on every start so it never drifts from the code. It holds no tool lists and no rules
// (those live in the per-message access block and the system prompt); only where things are and who changes them.
function settingsPage({ user }) {
  return `# Settings: where things live (written by the app on every start; do not edit)

I cannot change my own permissions. ${user} does, in the dashboard under Euphonia > Tool access.

- What I may call right now: the "Current access" block at the top of every message I receive. It is the whole truth for that turn.
- Tool access (MCP servers, read or write, for how long) and the euphonia-bridge capability (The Firm, GitHub, my own look): the dashboard's Tool access table.
- My voice: dashboard > Voice & sound. My look, name, and how I address ${user}: config.json beside this kb, set from the dashboard.
- My personality: identity.md beside this kb (not inside it); only ${user} edits it.
- The Firm's state as files, rewritten by the app: firm/STATUS.md, firm/inbox.json, firm/events.jsonl in this kb. Read only.
- Receipts for sends through my approval cards: shown to me in the access header; the log itself is outside this kb.
- Logs the app keeps outside this kb: bridge-audit.jsonl (every action), approvals.jsonl (every card decision).
`;
}

// Returns the names of the files it created. settings.md is (re)written every time.
function seedKb(kbDir, { user = 'the user', now = new Date() } = {}) {
  fs.mkdirSync(kbDir, { recursive: true, mode: 0o700 });
  const created = [];
  for (const [name, text] of Object.entries(seedFiles({ user, now }))) {
    try { fs.writeFileSync(path.join(kbDir, name), text, { flag: 'wx' }); created.push(name); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  try { fs.writeFileSync(path.join(kbDir, 'settings.md'), settingsPage({ user })); } catch { /* the page is a convenience */ }
  return created;
}

module.exports = { seedKb, settingsPage };
