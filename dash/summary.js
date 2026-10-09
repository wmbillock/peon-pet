// Summary counts for the agent list — one definition shared by the pet window (browser) and the
// Pixoo mirror (Node), so the number on your desktop and the number on the LED matrix always agree.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgentSummary = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const ATTENTION_MS = 120000;   // an alarm/annoyed reaction counts as "needs attention" for two minutes

  // Three states, process first and output age second:
  //   working  = mid-turn (output in the last 30 s, Claude's registry says busy, or the Firm says running);
  //   waiting  = alive (a running process, or a Firm thread that is starting/waiting) but quiet: CI, a tool, or you;
  //   finished = no live process. Not counted in the bar; a quiet file alone never makes an agent waiting.
  // `live` is set by the main process from Claude's pid-checked registry, the Firm's thread status, the
  // remote relay, or (Codex, which has no registry) a recently written rollout, so that last one is a guess.
  const isWorking = (a) => !!a.hot;
  const isWaiting = (a) => !a.hot && !!a.live;
  const isIdle = isWaiting;   // the old name: the dashboard filter and the Pixoo mirror still say "idle"
  const stateOf = (a) => (isWorking(a) ? 'working' : isWaiting(a) ? 'waiting' : 'finished');
  // The Firm's own agents (a thread of its own, or a session it launched) are counted apart from your sessions.
  const isFirm = (a) => a.kind === 'firm' || !!a.firm;
  const needsAttention = (a, now) => (a.anim === 'alarmed' || a.anim === 'annoyed') && now - (a.animAt || 0) < ATTENTION_MS;

  // limit: warn when more than this many agents are working at once (0 or missing = no limit).
  function summarizeAgents(agents, now = Date.now(), { limit = 0 } = {}) {
    const out = { total: 0, working: 0, idle: 0, attention: 0, finished: 0, local: { working: 0, waiting: 0 }, firm: { working: 0, waiting: 0 },
      projects: [], limit: limit > 0 ? limit : 0, over: false, overBy: 0 };
    const byProject = new Map();
    for (const a of agents || []) {
      const w = isWorking(a), i = isWaiting(a);
      if (!w && !i) { out.finished += 1; continue; }
      out.total += 1;
      if (w) out.working += 1; else out.idle += 1;
      out[isFirm(a) ? 'firm' : 'local'][w ? 'working' : 'waiting'] += 1;
      if (needsAttention(a, now)) out.attention += 1;
      if (a.project) {
        const p = byProject.get(a.project.key) || { key: a.project.key, name: a.project.name, emoji: a.project.emoji, ring: a.mark ? a.mark.ring : '#888', count: 0, working: 0 };
        p.count += 1;
        if (w) p.working += 1;
        byProject.set(a.project.key, p);
      }
    }
    out.waiting = out.idle;
    out.over = out.limit > 0 && out.working > out.limit;
    out.overBy = out.over ? out.working - out.limit : 0;
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

  // "3 yours · 2 Firm": where the counted agents come from, so the two sources are never blurred together.
  const sourceLine = (list) => { const f = list.filter(isFirm).length; return `${list.length - f} your sessions · ${f} Firm agents`; };

  // Heading, then the busiest agents first (working before idle), capped with "+N more".
  function describe(heading, list, now, { max = 7, hint = '', note = '' } = {}) {
    const sorted = [...list].sort((x, y) => (isWorking(y) - isWorking(x)) || ((y.lastActive || 0) - (x.lastActive || 0)));
    const lines = [heading, ...(note ? [`${note} · ${sourceLine(list)}`] : []), ...sorted.slice(0, max).map((a) => agentLine(a, now))];
    if (sorted.length > max) lines.push(`+${sorted.length - max} more`);
    if (hint) lines.push(hint);
    return lines.join('\n');
  }

  // Tooltip text for every clickable part of the strip.
  function summaryTips(agents, now = Date.now(), { limit = 0 } = {}) {
    const all = agents || [];
    const working = all.filter(isWorking), idle = all.filter(isWaiting), alert = all.filter((a) => needsAttention(a, now));
    const plural = (n, w) => `${n} ${w}`;
    const out = {
      working: describe(limit > 0 && working.length > limit ? `${working.length} working — ${working.length - limit} over your limit of ${limit}` : plural(working.length, 'working'), working, now,
        { hint: limit > 0 && working.length > limit ? 'Ask Management to hold new work. Click to see them' : 'Click to see them', note: 'mid-turn: output in the last 30s, or the Firm says running' }),
      idle: describe(plural(idle.length, 'waiting — alive, quiet'), idle, now, { hint: 'Click to see them', note: 'a live process with no recent output: CI, a tool, or you' }),
      attention: describe(plural(alert.length, alert.length === 1 ? 'needs you — alarmed or interrupted' : 'need you — alarmed or interrupted'), alert, now, { hint: 'Click to see them' }),
      projects: {},
    };
    const byProject = new Map();
    for (const a of all) { if ((isWorking(a) || isWaiting(a)) && a.project) byProject.set(a.project.key, [...(byProject.get(a.project.key) || []), a]); }
    for (const [key, list] of byProject) {
      const p = list[0].project, w = list.filter(isWorking).length;
      out.projects[key] = describe(`${p.emoji || ''} ${p.name} — ${w} working, ${list.length - w} waiting`.trim(), list, now, { hint: 'Click to see only this project' });
    }
    return out;
  }

  return { summarizeAgents, summaryTips, isWorking, isWaiting, isIdle, isFirm, stateOf, needsAttention, ATTENTION_MS };
});
