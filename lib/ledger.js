'use strict';
// Reputation ledger for agent types. Credits (good outcomes) and violations (out-of-role actions, broken bounds) are
// recorded and summarised SEPARATELY: a useful result can still carry a violation, and the net never hides either.
// Append-only JSON lines, so a crash can lose at most the line being written.
const fs = require('fs');
const path = require('path');

const KINDS = ['credit', 'violation'];
const clean = (s, max) => String(s ?? '').trim().slice(0, max);
const MAX_KEEP = 5000;   // lines retained when the file is compacted

function createLedger({ file, now = () => Date.now() }) {
  const read = () => {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
    const out = [];
    for (const line of text.split('\n')) { if (!line) continue; try { out.push(JSON.parse(line)); } catch { /* torn last line */ } }
    return out;
  };
  return {
    record({ type, agentId = null, kind, action = null, note = '' }) {
      if (!KINDS.includes(kind)) throw new Error(`kind must be one of: ${KINDS.join(', ')}`);
      const slug = clean(type, 40);
      if (!slug) throw new Error('A ledger entry needs an agent type');
      const entry = { at: now(), type: slug, agentId: agentId ? clean(agentId, 80) : null, kind, action: action ? clean(action, 40) : null, note: clean(note, 300) };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
      return entry;
    },
    // → Map(type slug → { credits, violations, recent: last 5 entries })
    summary() {
      const m = new Map();
      for (const e of read()) {
        const s = m.get(e.type) || { credits: 0, violations: 0, recent: [] };
        if (e.kind === 'credit') s.credits++; else s.violations++;
        s.recent.push(e); if (s.recent.length > 5) s.recent.shift();
        m.set(e.type, s);
      }
      return m;
    },
    entries: (limit = 100) => read().slice(-limit),
    compact() {
      const all = read();
      if (all.length <= MAX_KEEP) return false;
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, all.slice(-MAX_KEEP).map((e) => JSON.stringify(e)).join('\n') + '\n');
      fs.renameSync(tmp, file);
      return true;
    },
  };
}

module.exports = { createLedger, KINDS };
