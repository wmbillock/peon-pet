'use strict';
// Seeded, preference-weighted casting of auto-picked agent pets, with a variety guard so a roster is not
// an army of one species. Pure: no Electron, no filesystem except loadPrefs.
const fs = require('fs');

const SHIPPED = require('./character-preferences.json');
const DEFAULT_VARIETY = { maxShare: 0.25, minAgentsForShare: 8, maxConsecutive: 2, repeatPenalty: 1 };

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

// The user's file overrides the shipped one: maps merge per key (a kind in the user file replaces that
// kind's map), `exclude` and `rare` merge, `variety` merges key by key.
function mergePrefs(base, user) {
  if (!user || typeof user !== 'object') return base;
  const m = (k) => ({ ...(base[k] || {}), ...(user[k] && typeof user[k] === 'object' ? user[k] : {}) });
  return {
    ...base,
    variety: { ...DEFAULT_VARIETY, ...base.variety, ...(user.variety || {}) },
    exclude: [...new Set([...(base.exclude || []), ...(Array.isArray(user.exclude) ? user.exclude : [])])],
    rare: m('rare'),
    default: user.default && typeof user.default === 'object' ? user.default : base.default,
    kinds: { ...(base.kinds || {}), ...(user.kinds && typeof user.kinds === 'object' ? user.kinds : {}) },
  };
}
const loadPrefs = (userFile) => mergePrefs({ ...SHIPPED, variety: { ...DEFAULT_VARIETY, ...SHIPPED.variety } }, userFile ? readJson(userFile) : null);

function hash32(str) {
  let h = 2166136261;
  for (const c of String(str)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  return h >>> 0;
}
function rng(seedStr) {   // mulberry32
  let a = hash32(seedStr);
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function weightOf(prefs, kind, sp) {
  if ((prefs.exclude || []).includes(sp)) return 0;
  const k = (prefs.kinds || {})[kind];
  const base = k && Object.hasOwn(k, sp) ? k[sp] : (prefs.default || {})[sp];
  const w = Number(base);
  if (!(w > 0)) return 0;
  const rare = Number((prefs.rare || {})[sp]);
  return rare >= 0 && Object.hasOwn(prefs.rare || {}, sp) ? w * rare : w;
}

const isRareOrExcluded = (prefs, sp) => (prefs.exclude || []).includes(sp) || (Object.hasOwn(prefs.rare || {}, sp) && Number(prefs.rare[sp]) < 1);

/**
 * agents: [{ id, kind }] in a stable order; ready: Set of usable species slugs;
 * sticky: Map(id → species) of picks to keep (counted, not re-rolled); override(id) → species|null (Forge wins).
 * → Map(id → species). Deterministic for (seed, agent ids, kinds, prefs, ready).
 */
function pickCast({ agents, prefs, seed, ready, sticky = new Map(), override = () => null }) {
  const v = { ...DEFAULT_VARIETY, ...(prefs.variety || {}) };
  const out = new Map();
  const counts = new Map();
  const recent = [];
  const total = agents.length;
  const take = (id, sp) => { out.set(id, sp); counts.set(sp, (counts.get(sp) || 0) + 1); recent.push(sp); };
  const capFor = () => (total >= v.minAgentsForShare ? Math.max(1, Math.floor(v.maxShare * total)) : Infinity);
  const cap = capFor();

  const pending = [];
  for (const a of agents) {
    const o = override(a.id);
    if (o && ready.has(o)) take(a.id, o);
    else if (sticky.has(a.id) && ready.has(sticky.get(a.id))) take(a.id, sticky.get(a.id));
    else pending.push(a);
  }
  for (const a of pending) {
    const kind = a.kind || 'worker';
    const pool = [...ready].sort();
    const fits = (sp, relax) => {
      if (weightOf(prefs, kind, sp) <= 0 && !relax) return false;
      if ((counts.get(sp) || 0) >= cap) return false;
      const n = v.maxConsecutive;
      if (!relax && n > 0 && recent.length >= n && recent.slice(-n).every((x) => x === sp)) return false;
      return true;
    };
    let cands = pool.filter((sp) => fits(sp, false));
    if (!cands.length) cands = pool.filter((sp) => weightOf(prefs, kind, sp) > 0 && (counts.get(sp) || 0) < cap);   // relax consecutive
    if (!cands.length) cands = pool.filter((sp) => (counts.get(sp) || 0) < cap);                                    // relax preferences
    if (!cands.length) cands = pool;
    const ws = cands.map((sp) => {
      const w = weightOf(prefs, kind, sp) || 0.0001;
      return w / Math.pow(1 + (counts.get(sp) || 0), v.repeatPenalty);
    });
    let r = rng(`${seed}|${a.id}|${kind}`)() * ws.reduce((x, y) => x + y, 0);
    let pick = cands[cands.length - 1];
    for (let i = 0; i < cands.length; i++) { r -= ws[i]; if (r < 0) { pick = cands[i]; break; } }
    take(a.id, pick);
  }
  return out;
}

module.exports = { isRareOrExcluded, loadPrefs, mergePrefs, pickCast, weightOf, hash32, DEFAULT_VARIETY };
