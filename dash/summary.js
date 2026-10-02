// Summary counts for the agent list — one definition shared by the pet window (browser) and the
// Pixoo mirror (Node), so the number on your desktop and the number on the LED matrix always agree.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgentSummary = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const ATTENTION_MS = 120000;   // an alarm/annoyed reaction counts as "needs attention" for two minutes

  // An agent is "working" when mid-turn; "idle" when it is alive but between turns (a master that has
  // sat quiet for hours is still idle, not gone); anything else is just quiet and not counted.
  const isWorking = (a) => !!a.hot;
  const isIdle = (a) => !a.hot && !!(a.warm || a.live || a.role === 'master');
  const needsAttention = (a, now) => (a.anim === 'alarmed' || a.anim === 'annoyed') && now - (a.animAt || 0) < ATTENTION_MS;

  function summarizeAgents(agents, now = Date.now()) {
    const out = { total: 0, working: 0, idle: 0, attention: 0, projects: [] };
    const byProject = new Map();
    for (const a of agents || []) {
      const w = isWorking(a), i = isIdle(a);
      if (!w && !i) continue;
      out.total += 1;
      if (w) out.working += 1; else out.idle += 1;
      if (needsAttention(a, now)) out.attention += 1;
      if (a.project) {
        const p = byProject.get(a.project.key) || { key: a.project.key, name: a.project.name, emoji: a.project.emoji, ring: a.mark ? a.mark.ring : '#888', count: 0, working: 0 };
        p.count += 1;
        if (w) p.working += 1;
        byProject.set(a.project.key, p);
      }
    }
    // Busiest projects first.
    out.projects = [...byProject.values()].sort((x, y) => y.working - x.working || y.count - x.count || x.name.localeCompare(y.name));
    return out;
  }

  return { summarizeAgents, isWorking, isIdle, needsAttention, ATTENTION_MS };
});
