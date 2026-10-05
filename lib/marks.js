'use strict';
// Visual identity for each agent on the dashboard.
//   project  → one family: hue, emoji, frame, environment (shared by all its agents)
//   agent    → art that matches its type, and a *shade* of the project's hue that tells it apart from
//              other agents of the same type in that project
const { projectKeyOf } = require('./projects');
const { hueOfType, typeColors } = require('./type-colors');

// Duplicates of one type in a project are told apart by hue, not by darkness: dark overlays read as "switched off".
// The 2nd, 3rd… agent gets the project's hue rotated by a step (alternating either side, widening), at full
// brightness and high saturation, so every copy looks lit and every copy looks different.
const HUE_STEPS = [40, -40, 80, -80, 120, -120, 160];
const SHADE_SATURATION = 0.9, SHADE_VALUE = 1, SHADE_ALPHA = 0.4;

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

// h in degrees, s and v in 0..1
function hsvToRgb(h, s, v) {
  const c = v * s, hp = (((h % 360) + 360) % 360) / 60, x = c * (1 - Math.abs((hp % 2) - 1)), m = v - c;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((n) => Math.round(255 * (n + m)));
}

function shadeTint(hue, k) {
  const rgb = hsvToRgb(hue + HUE_STEPS[(k - 1) % HUE_STEPS.length], SHADE_SATURATION, SHADE_VALUE);
  return { tintRgb: rgb, tintAlpha: SHADE_ALPHA, tintCss: `rgba(${rgb.join(',')},${SHADE_ALPHA})` };
}

const markRole = (a) => a.firmRole || (a.isRoot !== false ? 'lead' : 'worker');

/**
 * agents: ordered rows from the agent graph;  looks: Map(agentId → pet look);
 * assignments: agent id → project key you chose;  resolveProject(key, suggestedName) → { key, name, emoji, hue, frame, env };  titles: Firm project id → title.
 * → Map(agentId → { project, mark, look })
 */
function applyMarks({ agents, looks, resolveProject, firmProjects = {}, titles = {}, assignments = {} }) {
  // Firm project id → title (and, when The Firm supplies it, the project's look).
  const titleOf = Object.fromEntries([...Object.entries(titles), ...Object.entries(firmProjects).map(([id, p]) => [id, p.title])].filter(([, t]) => t));
  const out = new Map();
  const seen = new Map();   // `${project}|${species}` → how many agents of that type so far
  for (const a of agents) {
    const pk = assignments[a.id] ? { key: assignments[a.id], name: assignments[a.id] } : projectKeyOf(a, titleOf);
    const fp = a.firm && a.firm.projectId && firmProjects[a.firm.projectId];
    const project = resolveProject(pk.key, pk.name, fp ? { emoji: fp.emoji, hue: fp.hue, frame: fp.frame, env: fp.env } : {});
    let look = looks.get(a.id) || null;
    // The border and name plate say what KIND of agent this is; the emoji says which project it is working on.
    const kindHue = look && look.type && Number.isFinite(look.type.hue) ? look.type.hue : hueOfType(markRole(a));
    const mark = { ...typeColors(kindHue), emoji: project.emoji, kind: look && look.type ? look.type.slug : markRole(a) };
    if (look) {
      if (look.tint && look.tint !== 'none') {
        look = { ...look, shade: 0 };   // you set this pet's filter yourself: respect it
      } else {
        // Shades only tell apart true copies: the same kind, wearing the same pet, in the same project.
        const slot = `${project.key}|${mark.kind}|${look.species}`;
        const k = seen.get(slot) || 0;
        seen.set(slot, k + 1);
        look = k === 0 ? { ...look, shade: 0 } : { ...look, ...shadeTint(kindHue, k), shade: k };
      }
    }
    out.set(a.id, { project, mark, look });
  }
  return out;
}

module.exports = { applyMarks, shadeTint, hslToRgb, hsvToRgb, HUE_STEPS };
