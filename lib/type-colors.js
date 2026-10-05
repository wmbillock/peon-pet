'use strict';
// The border colour of a tile says what KIND of agent it is. Each kind has a hue (0-359) of its own; a kind with
// none set takes its role's colour, nudged a little by name so two kinds of the same role still look different.
const CATEGORY_HUE = { management: 48, lead: 28, worker: 212, inspector: 4, scout: 140, plan: 280, critique: 315, review: 250 };
const FALLBACK_HUE = 200;

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return h; };

// type: { slug, category, hue? } or just a role name string
function hueOfType(type) {
  if (typeof type === 'string') return CATEGORY_HUE[type] ?? FALLBACK_HUE;
  if (!type) return FALLBACK_HUE;
  if (Number.isFinite(type.hue)) return ((Math.round(type.hue) % 360) + 360) % 360;
  const base = CATEGORY_HUE[type.category] ?? FALLBACK_HUE;
  return (base + (hash(type.slug) % 5 - 2) * 10 + 360) % 360;
}

// CSS colours for the tile border (ring), name plate and swatches of a hue.
function typeColors(hue) {
  return { hue, plate: `hsl(${hue} 42% 27%)`, ring: `hsl(${hue} 75% 58%)`, swatch: `hsl(${hue} 70% 50%)`, text: '#fff' };
}

module.exports = { CATEGORY_HUE, hueOfType, typeColors };
