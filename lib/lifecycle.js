'use strict';
// Lifecycle events derived from the Firm's thread list: what changed between two polls. The Firm does not publish
// an event stream yet (Affirm/affirm-builders issue #4550), so Peon Pet derives one. The first poll yields nothing, so
// starting the app does not look like a swarm spawning.
const KINDS = { running: 'started', idle: 'idle', waiting: 'waiting', blocked: 'blocked', done: 'done', error: 'error', disconnected: 'gone' };

// prev: threads or null; next: threads. thread: { id, status, role, title, sessionId?, workstreamId? }
function diffThreads(prev, next) {
  if (!Array.isArray(prev)) return [];
  const before = new Map(prev.map((t) => [t.id, t]));
  const out = [];
  const ev = (kind, t) => out.push({ kind, id: t.id, sessionId: t.sessionId || null, role: t.role, title: t.title, workstreamId: t.workstreamId || null, status: t.status });
  for (const t of next) {
    const was = before.get(t.id);
    if (!was) { ev('spawned', t); if (KINDS[t.status]) ev(KINDS[t.status], t); continue; }
    if (was.status !== t.status && KINDS[t.status]) ev(KINDS[t.status], t);
  }
  return out;
}

module.exports = { diffThreads, KINDS };
