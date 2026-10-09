'use strict';
// User-granted tool access: grants.json under Euphonia's home. This store has no notion of who is asking;
// grants are created only by the dashboard-gated IPC handlers (lib/euphonia/ipc.js); the service and the bridge runner
// read them. Nothing the model reads or writes can reach it: the file is outside kb/, the only place the CLI may write.
const fs = require('fs');
const path = require('path');
const { SERVER_RE } = require('./tool-class');

const LEVELS = ['read', 'write'];
const DURATIONS = ['1h', '4h', 'eod', '7d', 'blanket'];

function expiryFor(duration, now) {
  const t = now.getTime();
  switch (duration) {
    case '1h': return new Date(t + 3600e3).toISOString();
    case '4h': return new Date(t + 4 * 3600e3).toISOString();
    case '7d': return new Date(t + 7 * 86400e3).toISOString();
    case 'eod': { const d = new Date(now); d.setHours(23, 59, 59, 999); return d.toISOString(); }   // local end of day
    case 'blanket': return null;
    default: throw new Error(`Unknown duration: ${duration}`);
  }
}

function createGrantStore({ file, now = () => new Date() }) {
  const read = () => {
    try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(d.grants) ? d.grants : []; } catch { return []; }
  };
  const write = (grants) => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, grants }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  // expires_at is null (blanket) or a parseable ISO string; "", 0 or false are malformed, never "blanket".
  const validExpiry = (v) => v === null || (typeof v === 'string' && Number.isFinite(Date.parse(v)));
  const valid = (g) => !!g && typeof g.server === 'string' && SERVER_RE.test(g.server) && LEVELS.includes(g.level) && validExpiry(g.expires_at === undefined ? null : g.expires_at);
  const live = (g) => g.expires_at == null || Date.parse(g.expires_at) > now().getTime();

  // Active grants only. Expired or malformed entries are dropped and the file is pruned.
  function list() {
    const all = read();
    const active = all.filter((g) => valid(g) && live(g));
    if (active.length !== all.length) write(active);
    return active;
  }

  function grant({ server, level, duration }) {
    if (typeof server !== 'string' || !SERVER_RE.test(server)) throw new Error('Invalid server name');
    if (!LEVELS.includes(level)) throw new Error('Level must be read or write');
    const at = now();
    const entry = { server: String(server), level, granted_at: at.toISOString(), expires_at: expiryFor(duration, at), via: 'ui' };
    write([...list().filter((g) => g.server !== entry.server), entry]);   // one grant per server; re-granting replaces (extend or change)
    return entry;
  }
  function revoke(server) { const before = list(); write(before.filter((g) => g.server !== server)); return before.length; }
  function revokeAll() { const n = list().length; write([]); return n; }

  return { list, grant, revoke, revokeAll, file };
}

module.exports = { createGrantStore, expiryFor, SERVER_RE, LEVELS, DURATIONS };
