'use strict';
// Merge Claude/Codex sessions with The Firm's threads into one set of agents, grouped so an agent's
// sub-agents can share its identity (pet + tint).
//
//   Root  = an agent with its own identity: a session you started, Firm's management, or a
//           workstream's lead.
//   Child = everything working for a root: a workstream's workers, inspectors, scouts, planners,
//           critics, reviewers. Children inherit the root's pet look (and so its tint).
const path = require('path');

const FIRM_ROOT_ROLES = new Set(['management', 'lead']);
// Order within a group, and the tie-break for who is the root if a workstream has no lead.
const FIRM_ROLE_ORDER = { management: 0, lead: 1, worker: 2, inspector: 3, scout: 4, plan: 5, critique: 6, review: 7 };
const DEAD = new Set(['error', 'stopped', 'closed', 'dead', 'failed', 'archived']);

const wsFromCwd = (cwd) => {
  const m = /\/\.firm\/worktrees\/(ws_[0-9a-f]+)(?:\/|$)/.exec(cwd || '');
  return m ? m[1] : null;
};
// The Firm reports epoch seconds or milliseconds depending on the field; normalise to ms.
const toMs = (t) => (!t ? 0 : t < 1e12 ? t * 1000 : t);
const labelOf = (r) => `${r.title || r.name || ''}|${r.id}`;

function firmOnlyRow(t, now) {
  const running = t.status === 'running';
  const alive = !DEAD.has(t.status);
  return {
    id: `firm:${t.id}`, kind: 'firm', agent: 'claude', cwd: t.cwd, name: t.cwd ? path.basename(t.cwd) : null,
    title: t.title, hot: running, warm: alive, live: alive, status: running ? 'busy' : alive ? 'idle' : null,
    lastActive: running ? now : (toMs(t.updatedAt) || now - 3600e3), anim: null, animAt: 0, peonKey: null,
  };
}

function buildAgents({ sessions, firmThreads = [], now = Date.now() }) {
  const rows = sessions.map((s) => ({ ...s, kind: s.kind || 'session', firm: null }));
  const bySession = new Map(rows.map((r) => [r.id, r]));

  for (const t of firmThreads) {
    const row = t.sessionId && bySession.get(t.sessionId);
    if (row) row.firm = t;
    else {
      const extra = { ...firmOnlyRow(t, now), firm: t };
      rows.push(extra);
      bySession.set(extra.id, extra);
    }
  }

  // Roles and groups
  for (const r of rows) {
    if (r.firm) {
      const fr = r.firm.role;
      r.firmRole = fr;
      r.role = FIRM_ROOT_ROLES.has(fr) ? 'master' : 'worker';
      if (fr === 'management') r.groupId = 'management';
      else if (r.firm.workstreamId) r.groupId = `ws:${r.firm.workstreamId}`;
      else r.groupId = `agent:${r.id}`;
    } else {
      const ws = r.role === 'worker' ? wsFromCwd(r.cwd) : null;
      r.groupId = ws ? `ws:${ws}` : `agent:${r.id}`;
    }
  }

  // Roots
  const groups = new Map();
  for (const r of rows) groups.set(r.groupId, [...(groups.get(r.groupId) || []), r]);
  for (const members of groups.values()) {
    const rank = (r) => (r.firm ? (FIRM_ROLE_ORDER[r.firm.role] ?? 9) : 10);
    const root = [...members].sort((a, b) => rank(a) - rank(b) || labelOf(a).localeCompare(labelOf(b)))[0];
    for (const r of members) {
      r.rootId = root.id;
      r.isRoot = r === root;
    }
  }
  for (const r of rows) r.rank = r.role === 'master' && r.isRoot ? 0 : 1;

  // Stable order: masters first; each root followed by its children; orphans last.
  const roots = rows.filter((r) => r.isRoot)
    .sort((a, b) => a.rank - b.rank || (a.rank === 0 ? labelOf(a).localeCompare(labelOf(b)) : b.lastActive - a.lastActive));
  const ordered = [];
  for (const root of roots) {
    ordered.push(root);
    ordered.push(...groups.get(root.groupId).filter((r) => !r.isRoot)
      .sort((a, b) => (FIRM_ROLE_ORDER[a.firm && a.firm.role] ?? 9) - (FIRM_ROLE_ORDER[b.firm && b.firm.role] ?? 9) || b.lastActive - a.lastActive));
  }
  ordered.forEach((r, i) => { r.order = i; });
  return ordered;
}

module.exports = { buildAgents, wsFromCwd, FIRM_ROLE_ORDER };
