'use strict';
// The monitor role, kept on the Peon Pet side until The Firm has one: it watches what agents actually do and
// writes it to the ledger. A tool call outside the agent's kind's permissions is a VIOLATION; a finished task is a
// CREDIT. Credits and violations stay separate (lib/ledger.js). Only agents that wear a kind are judged, so your
// own sessions are never on trial.
const { classifyTool } = require('./tool-actions');
const { check } = require('./permissions');

function createMonitor({ ledger, typeOf, now = () => Date.now(), dedupeMs = 5 * 60 * 1000, keep = 200 }) {
  const recent = [];
  const stats = { toolCalls: 0, judged: 0, violations: 0, events: 0 };
  const lastSeen = new Map();   // dedupe key → time
  const credited = new Set();
  const push = (e) => { recent.push({ at: now(), ...e }); if (recent.length > keep) recent.shift(); };
  const fresh = (key) => { const t = now(), last = lastSeen.get(key); if (last !== undefined && t - last < dedupeMs) return false; lastSeen.set(key, t); return true; };

  return {
    // A tool call by an agent: { sessionId, tool, input }
    toolUse({ sessionId, tool, input }) {
      stats.toolCalls++;
      const action = classifyTool(tool, input);
      if (!action) return null;
      const type = typeOf(sessionId);
      if (!type) return null;
      stats.judged++;
      const r = check(type, action);
      if (r.decision === 'allow') return null;
      if (!fresh(`${sessionId}|${action}`)) return null;
      const note = r.route ? `${r.reason}; hand to ${r.route}` : r.reason;
      ledger.record({ type: type.slug, agentId: sessionId, kind: 'violation', action, note });
      stats.violations++;
      push({ kind: 'violation', agentId: sessionId, type: type.slug, action, note });
      return { decision: r.decision, action, type: type.slug };
    },
    // Events from lib/lifecycle.js diffThreads
    lifecycle(events) {
      for (const e of events) {
        stats.events++;
        push({ kind: e.kind, agentId: e.id, role: e.role, title: e.title });
        if (e.kind === 'done' && !credited.has(e.id)) {
          const type = typeOf(e.id) || typeOf(e.sessionId);
          if (type) { credited.add(e.id); ledger.record({ type: type.slug, agentId: e.id, kind: 'credit', note: `finished: ${String(e.title || '').slice(0, 120)}` }); }
        }
      }
    },
    stats: () => ({ ...stats }),
    recent: (n = 30) => recent.slice(-n).reverse(),
  };
}

module.exports = { createMonitor };
