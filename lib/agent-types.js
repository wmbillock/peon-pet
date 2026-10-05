'use strict';
// Agent types: a *kind of agent* with a look (species), a viewpoint (personality) and traits that decide when it fits.
// One species can back many types, so a pet can serve as several different agents. A type belongs to a category
// (a Firm role: lead, worker, inspector…). This is the seed of The Firm's agent-type registry (see docs/firm/).
const fs = require('fs');
const path = require('path');

const { cleanPermissions, cleanBounds } = require('./permissions');
const CATEGORIES = ['management', 'lead', 'worker', 'inspector', 'scout', 'plan', 'critique', 'review'];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TRAIT_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
const clean = (s, max) => String(s ?? '').trim().slice(0, max);

const SEED = [
  { slug: 'tinkerer', hue: 215, name: 'Tinkerer', category: 'worker', species: 'retro-robot', traits: ['backend', 'api', 'infra', 'build', 'data'], bounds: { directLoc: 150 }, personality: 'Methodical builder. Makes small, testable changes and shows the evidence.' },
  { slug: 'forge-hand', hue: 195, name: 'Forge hand', category: 'worker', species: 'orc', traits: ['perf', 'refactor', 'fix', 'bug', 'cleanup'], personality: 'Blunt and fast. Hammers a problem until it gives, then says exactly what changed.' },
  { slug: 'sprout', hue: 160, name: 'Sprout', category: 'worker', species: 'weeping-willow', traits: ['frontend', 'ui', 'docs', 'design', 'markdown'], personality: 'Patient and careful. Grows things step by step and cares about polish and wording.' },
  { slug: 'skeptic', hue: 4, name: 'Skeptic', category: 'inspector', species: 'bearded-dragon', traits: ['security', 'risk', 'test', 'auth', 'compliance'], personality: 'Unimpressed until shown evidence. Re-runs everything and trusts nothing it has not seen.' },
  { slug: 'button-masher', hue: 340, name: 'Button masher', category: 'inspector', species: 'lcd-creature', traits: ['ui', 'regression', 'frontend', 'ux'], personality: 'Pokes every control and corner case, like a kid with a new toy.' },
  { slug: 'reader', hue: 140, name: 'Reader', category: 'scout', species: 'capybara', traits: ['docs', 'research', 'data', 'notes', 'wiki'], personality: 'Calm and wide-reading. Maps the territory before anyone commits to a route.' },
  { slug: 'composer', hue: 280, name: 'Composer', category: 'plan', species: 'eighth-note', traits: ['plan', 'roadmap', 'design', 'spec'], personality: 'Thinks in sequence and structure. Orders the work so each step sets up the next.' },
  { slug: 'herald', hue: 315, name: 'Herald', category: 'critique', species: 'clipart-trumpet', traits: ['risk', 'security', 'plan', 'cost'], personality: 'Loud about what could go wrong, and specific about why.' },
  { slug: 'quiet-pool', hue: 250, name: 'Quiet pool', category: 'review', species: 'capybara', traits: ['review', 'docs', 'spec', 'notes'], personality: 'Unhurried and fair. Reads the whole change against the spec before forming a view.' },
  { slug: 'forge-master', hue: 28, name: 'Forge master', category: 'lead', species: 'orc', traits: ['lead', 'ship', 'perf'], personality: 'Runs the floor. Decisive about scope and quick to send work back.' },
  { slug: 'conductor', hue: 48, name: 'Conductor', category: 'management', species: 'eighth-note', traits: ['plan', 'roadmap', 'management'], personality: 'Keeps the whole score in view and hands out parts.' },
];

function cleanType(input, { isSpecies = () => true, isTint = () => true } = {}) {
  const slug = clean(input.slug, 40).toLowerCase();
  if (!SLUG_RE.test(slug)) throw new Error('Type id must be lowercase letters, digits and dashes');
  const name = clean(input.name, 40);
  if (!name) throw new Error('Name cannot be empty');
  if (!CATEGORIES.includes(input.category)) throw new Error(`Category must be one of: ${CATEGORIES.join(', ')}`);
  if (!isSpecies(input.species)) throw new Error(`Unknown or unfinished species: ${input.species}`);
  const traits = [...new Set((Array.isArray(input.traits) ? input.traits : String(input.traits ?? '').split(/[,\s]+/))
    .map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
  for (const t of traits) if (!TRAIT_RE.test(t)) throw new Error(`Invalid trait: ${t}`);
  if (traits.length > 12) throw new Error('At most 12 traits');
  let hue = null;
  if (input.hue !== null && input.hue !== undefined && input.hue !== '') {
    hue = Number(input.hue);
    if (!Number.isFinite(hue) || hue < 0 || hue > 359) throw new Error('Border colour must be a hue from 0 to 359');
    hue = Math.round(hue);
  }
  const tint = input.tint ? String(input.tint) : null;
  if (tint && !isTint(tint)) throw new Error(`Unknown filter: ${tint}`);
  const perms = cleanPermissions({ category: input.category, allow: input.allow, deny: input.deny });
  return { slug, name, category: input.category, species: input.species, traits, personality: clean(input.personality, 600), tint, hue, allow: perms.allow, deny: perms.deny, bounds: cleanBounds(input.bounds) };
}

const WORD_RE = /[a-z0-9]+/g;
const words = (s) => String(s || '').toLowerCase().match(WORD_RE) || [];

// What we know about an agent that traits can match: its role, project, title, folder and tool.
function signalsOf(agent, project = {}) {
  const set = new Set();
  const add = (s) => { for (const w of words(s)) set.add(w); };
  add(agent.firmRole || (agent.isRoot !== false ? 'lead' : 'worker'));
  add(agent.title); add(agent.name); add(agent.agent);
  add(agent.cwd ? path.basename(agent.cwd) : '');
  add(project.name); add(project.key);
  if (agent.firm) { add(agent.firm.title); add(agent.firm.role); }
  return set;
}

/**
 * Best type for an agent within its category: the most trait overlap with its signals; ties go to the type in
 * use the least right now (so duplicates get variety), then to the earlier one. null if the category has no types.
 *   types: [{slug, category, traits}], usage: Map(slug → count of agents currently wearing it)
 */
function pickType({ agent, project, types, usage = new Map() }) {
  const category = agent.firmRole || (agent.isRoot !== false ? 'lead' : 'worker');
  const pool = types.filter((t) => t.category === category);
  if (!pool.length) return null;
  const sig = signalsOf(agent, project);
  const scored = pool.map((t, i) => ({ t, i, score: t.traits.filter((x) => sig.has(x)).length, used: usage.get(t.slug) || 0 }));
  scored.sort((a, b) => b.score - a.score || a.used - b.used || a.i - b.i);
  return scored[0].t;
}

// Older or seeded records may lack the newer fields.
const SEED_HUE = Object.fromEntries(SEED.filter((t) => t.hue !== undefined).map((t) => [t.slug, t.hue]));
const normalize = (t) => ({ tint: null, hue: SEED_HUE[t.slug] ?? null, allow: [], deny: [], traits: [], personality: '', ...t, bounds: { directLoc: null, maxAgents: null, timeoutMin: null, ...(t.bounds || {}) } });

function createAgentTypeStore({ file, seed = SEED }) {
  let data = null;
  const load = () => {
    if (data) return data;
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (d && typeof d.types === 'object' && d.types) data = { version: 1, types: d.types, pins: d.pins || { sessions: {}, projects: {} }, autoRoots: !!d.autoRoots, spread: d.spread !== false };
    } catch { /* first run */ }
    if (!data) { data = { version: 1, types: Object.fromEntries(seed.map((t) => [t.slug, { ...t }])), pins: { sessions: {}, projects: {} }, autoRoots: false, spread: true }; save(); }
    data.pins.sessions = data.pins.sessions || {}; data.pins.projects = data.pins.projects || {};
    return data;
  };
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  };
  const own = (o, k) => Object.hasOwn(o, k);

  return {
    list: () => Object.values(load().types).map(normalize),
    get: (slug) => (own(load().types, slug) ? normalize(load().types[slug]) : null),
    // Create or replace a type. opts: { isSpecies, isTint } validators from the caller.
    put(input, opts) {
      const t = cleanType(input, opts);
      load().types[t.slug] = t;
      save();
      return t;
    },
    remove(slug) {
      const d = load();
      if (!own(d.types, slug)) return;
      delete d.types[slug];
      for (const m of [d.pins.sessions, d.pins.projects]) for (const [k, v] of Object.entries(m)) if (v === slug) delete m[k];
      save();
    },
    pins: () => ({ sessions: { ...load().pins.sessions }, projects: { ...load().pins.projects } }),
    // kind: 'session' | 'project';  slug null clears.
    pin(kind, key, slug) {
      const d = load();
      const m = kind === 'project' ? d.pins.projects : kind === 'session' ? d.pins.sessions : null;
      if (!m) throw new Error('Pin a session or a project');
      if (slug !== null && !own(d.types, slug)) throw new Error('Unknown agent type');
      if (slug === null) delete m[key]; else m[key] = slug;
      save();
    },
    // Spread: duplicates of an automatically chosen kind wear different pets from the whole pool, not just the kind's own.
    spread: () => load().spread !== false,
    setSpread(on) { load().spread = !!on; save(); },
    autoRoots: () => !!load().autoRoots,
    setAutoRoots(on) { load().autoRoots = !!on; save(); },
  };
}

module.exports = { createAgentTypeStore, cleanType, pickType, signalsOf, CATEGORIES, SEED };
