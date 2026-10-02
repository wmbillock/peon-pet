// Decide which pet represents each active session.
//
// Priority: pet pinned to the session → pinned to its project (longest matching path) → pinned to
// its agent → auto pool (roster order, skipping benched/pinned pets). Within a rule, pets already
// claimed by another session in this pass are skipped first, so an army spreads out before it
// doubles up. Auto picks are sticky (`sticky` map) so pets don't shuffle as sessions come and go.

function projectMatches(value, cwd) {
  if (!cwd) return false;
  const v = value.replace(/\/+$/, '');
  return cwd === v || cwd.startsWith(v + '/');
}

function assignPets({ pets, lead, sessions, sticky = new Map() }) {
  const result = new Map();
  if (!pets.length) return result;
  const byId = new Map(pets.map((p) => [p.id, p]));
  const used = new Set();
  const live = new Set(sessions.map((s) => s.id));
  for (const id of [...sticky.keys()]) if (!live.has(id)) sticky.delete(id);

  const pinned = (type) => pets.filter((p) => p.assignment && p.assignment.type === type);
  const take = (candidates) => {
    const free = candidates.find((p) => !used.has(p.id));
    const pick = free || candidates[0];
    if (pick) used.add(pick.id);
    return pick;
  };

  // Hot sessions choose first so they get the best (earliest) pets.
  const ordered = [...sessions].sort((a, b) => (b.hot ? 1 : 0) - (a.hot ? 1 : 0) || (b.lastActive || 0) - (a.lastActive || 0));

  const rest = [];
  for (const s of ordered) {
    const direct = pinned('session').filter((p) => p.assignment.value === s.id);
    if (direct.length) { result.set(s.id, take(direct).id); continue; }
    const projects = pinned('project').filter((p) => projectMatches(p.assignment.value, s.cwd));
    if (projects.length) {
      const longest = Math.max(...projects.map((p) => p.assignment.value.length));
      result.set(s.id, take(projects.filter((p) => p.assignment.value.length === longest)).id);
      continue;
    }
    const agents = pinned('agent').filter((p) => p.assignment.value === s.agent);
    if (agents.length) { result.set(s.id, take(agents).id); continue; }
    rest.push(s);
  }

  const pool = pets.filter((p) => !p.assignment);
  const fallback = byId.get(lead) || pets[0];
  for (const s of rest) {
    const prior = byId.get(sticky.get(s.id));
    if (prior && !prior.assignment && !used.has(prior.id)) { used.add(prior.id); result.set(s.id, prior.id); continue; }
    const pick = pool.length ? take(pool) : fallback;
    sticky.set(s.id, pick.id);
    result.set(s.id, pick.id);
  }
  return result;
}

module.exports = { assignPets, projectMatches };
