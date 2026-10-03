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

  // ---- tooltip text for the summary strip ---------------------------------------------------
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const ageWord = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`; };
  const labelOf = (a) => a.title || a.name || String(a.id).replace(/^firm:/, '').slice(0, 8);

  // One line per agent: "🐾 peon-pet · lead · 3s"
  function agentLine(a, now) {
    const role = a.firmRole || (a.role === 'master' ? 'master' : '');
    const parts = [`${a.project && a.project.emoji ? `${a.project.emoji} ` : ''}${clip(labelOf(a), 26)}`];
    if (role) parts.push(role);
    parts.push(ageWord(now - (a.lastActive || now)));
    return parts.join(' · ');
  }

  // Heading, then the busiest agents first (working before idle), capped with "+N more".
  function describe(heading, list, now, { max = 7, hint = '' } = {}) {
    const sorted = [...list].sort((x, y) => (isWorking(y) - isWorking(x)) || ((y.lastActive || 0) - (x.lastActive || 0)));
    const lines = [heading, ...sorted.slice(0, max).map((a) => agentLine(a, now))];
    if (sorted.length > max) lines.push(`+${sorted.length - max} more`);
    if (hint) lines.push(hint);
    return lines.join('\n');
  }

  // Tooltip text for every clickable part of the strip.
  function summaryTips(agents, now = Date.now()) {
    const all = agents || [];
    const working = all.filter(isWorking), idle = all.filter(isIdle), alert = all.filter((a) => needsAttention(a, now));
    const plural = (n, w) => `${n} ${w}`;
    const out = {
      working: describe(plural(working.length, 'working'), working, now, { hint: 'Click to see them' }),
      idle: describe(plural(idle.length, 'idle — between turns'), idle, now, { hint: 'Click to see them' }),
      attention: describe(plural(alert.length, alert.length === 1 ? 'needs you — alarmed or interrupted' : 'need you — alarmed or interrupted'), alert, now, { hint: 'Click to see them' }),
      projects: {},
    };
    const byProject = new Map();
    for (const a of all) { if ((isWorking(a) || isIdle(a)) && a.project) byProject.set(a.project.key, [...(byProject.get(a.project.key) || []), a]); }
    for (const [key, list] of byProject) {
      const p = list[0].project, w = list.filter(isWorking).length;
      out.projects[key] = describe(`${p.emoji || ''} ${p.name} — ${w} working, ${list.length - w} idle`.trim(), list, now, { hint: 'Click to see only this project' });
    }
    return out;
  }

  return { summarizeAgents, summaryTips, isWorking, isIdle, needsAttention, ATTENTION_MS };
});
