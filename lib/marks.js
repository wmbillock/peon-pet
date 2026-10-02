'use strict';
// Visual identity for each agent on the dashboard.
//   project  → one family: hue, emoji, frame, environment (shared by all its agents)
//   agent    → art that matches its type, and a *shade* of the project's hue that tells it apart from
//              other agents of the same type in that project
const { projectKeyOf, projectColors } = require('./projects');

// Overlay lightness for the 2nd, 3rd… agent of one type in a project (the 1st stays natural).
// Alternating dark/light keeps neighbouring shades far apart.
const SHADE_LIGHTNESS = [22, 78, 38, 62, 12, 88, 50, 30];
const SHADE_ALPHA = 0.32;

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

function shadeTint(hue, k) {
  const L = SHADE_LIGHTNESS[(k - 1) % SHADE_LIGHTNESS.length];
  const rgb = hslToRgb(hue, 70, L);
  return { tintRgb: rgb, tintAlpha: SHADE_ALPHA, tintCss: `rgba(${rgb.join(',')},${SHADE_ALPHA})` };
}

const markRole = (a) => a.firmRole || (a.isRoot !== false ? 'lead' : 'worker');

/**
 * agents: ordered rows from the agent graph;  looks: Map(agentId → pet look);
 * resolveProject(key, suggestedName) → { key, name, emoji, hue, frame, env };  titles: Firm project id → title.
 * → Map(agentId → { project, mark, look })
 */
function applyMarks({ agents, looks, resolveProject, firmProjects = {}, titles = {} }) {
  // Firm project id → title (and, when The Firm supplies it, the project's look).
  const titleOf = Object.fromEntries([...Object.entries(titles), ...Object.entries(firmProjects).map(([id, p]) => [id, p.title])].filter(([, t]) => t));
  const out = new Map();
  const seen = new Map();   // `${project}|${species}` → how many agents of that type so far
  for (const a of agents) {
    const pk = projectKeyOf(a, titleOf);
    const fp = a.firm && a.firm.projectId && firmProjects[a.firm.projectId];
    const project = resolveProject(pk.key, pk.name, fp ? { emoji: fp.emoji, hue: fp.hue, frame: fp.frame, env: fp.env } : {});
    const mark = { ...projectColors(project.hue, markRole(a)), emoji: project.emoji };
    let look = looks.get(a.id) || null;
    if (look) {
      if (look.tint && look.tint !== 'none') {
        look = { ...look, shade: 0 };   // you set this pet's filter yourself: respect it
      } else {
        const slot = `${project.key}|${look.species}`;
        const k = seen.get(slot) || 0;
        seen.set(slot, k + 1);
        look = k === 0 ? { ...look, shade: 0 } : { ...look, ...shadeTint(project.hue, k), shade: k };
      }
    }
    out.set(a.id, { project, mark, look });
  }
  return out;
}

module.exports = { applyMarks, shadeTint, hslToRgb, SHADE_LIGHTNESS };
