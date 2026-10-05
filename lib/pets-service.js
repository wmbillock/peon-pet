const fs = require('fs');
const path = require('path');
const { createSpeciesStore } = require('./species');
const { createRoster } = require('./roster');
const { createEnvironStore, importEnvironment } = require('./environs');
const { environmentsFromManifests } = require('./art-catalog');
const { assignPets } = require('./assignment');
const { listCharacters, CHAR_NAME_RE } = require('./characters');
const { importCharacter } = require('./character-import');
const { TINTS, CYCLE, byId: tintById, cssColor } = require('./tints');
const { BORDERS, byId: borderById } = require('./borders');
const gen = require('./character-gen');
const { createProjectStore, projectKeyOf } = require('./projects');
const { createAgentTypeStore, pickType } = require('./agent-types');
const { createLedger } = require('./ledger');
const { importExtraRow } = require('./extras-import');

const own = (o, k) => Object.hasOwn(o, k);

/**
 * Everything about pets that doesn't need Electron: species metadata, environments, the roster,
 * session→pet assignment, asset-path resolution, prompts and imports. main.js wires it to IPC.
 *   bundled: { slug: { 'sprite-atlas.png': file, ... } }  (files under assetsDir)
 *   thumb(absPath, px) → data URL | null   (injected so tests don't need Electron)
 */
function createPetsService({ userDataDir, assetsDir, bundled, thumb = () => null }) {
  const customRoot = path.join(userDataDir, 'characters');
  const hasSheet = (slug) => own(bundled, slug) || fs.existsSync(path.join(customRoot, slug, 'sprite-atlas.png'));

  const species = createSpeciesStore({ file: path.join(userDataDir, 'species.json'), bundledNames: Object.keys(bundled), hasSheet });
  species.setExtraLister(() => listCharacters([], customRoot).map((c) => c.name));
  const environs = createEnvironStore({
    file: path.join(userDataDir, 'environs.json'),
    dir: path.join(userDataDir, 'environs'),
    builtins: [{ id: 'dungeon', display: 'Dungeon', description: 'A dark stone dungeon wall lit by a torch.', path: path.join(assetsDir, 'bg-pixel.png') },
      ...environmentsFromManifests(assetsDir).filter((e) => e.id !== 'dungeon')],
  });
  const roster = createRoster({
    file: path.join(userDataDir, 'pets.json'),
    isSpecies: (s) => typeof s === 'string' && CHAR_NAME_RE.test(s) && !!(species.get(s) || {}).ready,
    isEnv: (e) => environs.has(e),
  });

  const projects = createProjectStore({ file: path.join(userDataDir, 'projects.json') });
  const ledger = createLedger({ file: path.join(userDataDir, 'agent-ledger.jsonl') });
  const agentTypes = createAgentTypeStore({ file: path.join(userDataDir, 'agent-types.json') });
  const typeChecks = { isSpecies: (s) => typeof s === 'string' && !!(species.get(s) || {}).ready, isTint: (id) => !!tintById(id) };
  let petsCache = [];
  let leadCache = null;
  let roleSpecies = {};   // Firm role → species for sub-agents (e.g. every worker is a robot)
  let roleTint = {};      // Firm role → full-image filter for that agent type (outranks per-project shades)
  const sticky = new Map();
  const speciesSticky = new Map();   // agent id → the pet species it was spread onto, so it keeps its look between refreshes
  const refresh = () => { petsCache = roster.list(); leadCache = roster.lead(); };

  // --- asset resolution -------------------------------------------------------------------
  function slugOrLead(char) {
    if (typeof char === 'string' && CHAR_NAME_RE.test(char) && hasSheet(char)) return char;
    return (leadCache && leadCache.species) || 'orc';
  }

  function envIdFor(slug, requested) {
    const sp = species.get(slug);
    const lead = leadCache && leadCache.species === slug ? leadCache.env : null;
    return [requested, lead, sp && sp.defaultEnv, 'dungeon'].find((id) => id && environs.has(id));
  }

  // opts: { char, env, border } — char/env come from the asset URL (grid tiles), border from config.
  function resolveAsset(filename, { char, env, border } = {}) {
    const slug = slugOrLead(char);
    if (filename === 'borders.png' && border && border !== 'default') {
      const b = borderById(border);
      if (b && b.file) return path.join(assetsDir, b.file);
    }
    if (filename === 'bg.png') {
      const sp = species.get(slug);
      if (sp && sp.layout === 'cutout') return environs.pathOf(envIdFor(slug, env));
    }
    const custom = path.join(customRoot, slug, filename);
    if (fs.existsSync(custom)) return custom;
    const map = own(bundled, slug) ? bundled[slug] : {};
    return path.join(assetsDir, map[filename] || bundled.orc[filename] || filename);
  }

  // --- looks (what a renderer needs to draw one pet) -------------------------------------
  function lookOf(pet) {
    const sp = species.get(pet.species) || {};
    const t = tintById(pet.tint) || tintById('none');
    return {
      petId: pet.id, name: pet.name, species: pet.species, speciesDisplay: sp.display || pet.species,
      layout: sp.layout || 'baked', extras: sp.extras || [], env: sp.layout === 'cutout' ? envIdFor(pet.species, pet.env) : null,
      tint: pet.tint, tintCss: cssColor(pet.tint), tintRgb: t.rgb, tintAlpha: t.alpha,
    };
  }

  // An extra instance of a pet (several agents on one pet): same species, numbered name. Telling
  // instances apart is the shading step's job (lib/marks.js), per project.
  function recruitLook(pet, n) {
    return { ...lookOf({ ...pet, tint: 'none' }), petId: `${pet.id}~${n}`, name: `${pet.name} ${n}`, virtual: true };
  }

  // agents: rows from the agent graph ({ id, rootId, isRoot, cwd, agent, hot, lastActive, rank, order }).
  // Roots are matched to pets (several roots on one pet get numbered copies); children take their
  // root's pet and name. Colour is not inherited: shades are assigned per project afterwards.
  // → Map(agentId → look)
  function assign(agents) {
    const isRoot = (a) => a.isRoot !== false;
    const roots = agents.filter(isRoot);
    const picks = assignPets({ pets: petsCache, lead: leadCache && leadCache.id, sessions: roots, sticky });
    const byId = new Map(petsCache.map((p) => [p.id, p]));

    const sharers = new Map();   // petId → roots using it, in stable order
    for (const r of [...roots].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id)))) {
      const pid = picks.get(r.id);
      if (byId.has(pid)) sharers.set(pid, [...(sharers.get(pid) || []), r.id]);
    }
    const rootLooks = new Map();
    for (const [pid, ids] of sharers) {
      ids.forEach((id, i) => rootLooks.set(id, i === 0 ? lookOf(byId.get(pid)) : recruitLook(byId.get(pid), i + 1)));
    }

    // A sub-agent keeps its root's pet and name; its species can be set per Firm role (a robot worker).
    const childLook = (rootLook, role) => {
      const sp = role && roleSpecies[role];
      const plain = { ...rootLook, tint: 'none', tintRgb: [0, 0, 0], tintAlpha: 0, tintCss: 'transparent', sub: true };
      if (!sp || sp === rootLook.species || !(species.get(sp) || {}).ready) return plain;
      return { ...lookOf({ id: rootLook.petId, name: rootLook.name, species: sp, tint: 'none', env: null }), petId: rootLook.petId, sub: true };
    };

    // An agent type's own filter, unless the pet already has one you chose yourself.
    const withRoleTint = (look, role) => {
      const id = role && roleTint[role];
      if (!id || (look.tint && look.tint !== 'none')) return look;
      const t = tintById(id);
      return t ? { ...look, tint: id, tintRgb: t.rgb, tintAlpha: t.alpha, tintCss: cssColor(id) } : look;
    };

    // An agent type supplied by The Firm at instantiation decides the art outright (above role mapping).
    const typed = (a, look) => {
      const at = a.firm && a.firm.agentType;
      if (!at || at === look.species || !(species.get(at) || {}).ready) return look;
      return { ...lookOf({ id: look.petId, name: look.name, species: at, tint: 'none', env: null }), petId: look.petId, sub: look.sub, virtual: look.virtual };
    };

    // Which agent type does each agent wear? The Firm's choice, then a pin on the session or its project, then an
    // automatic pick by traits (sub-agents always; roots only if you turned that on). Types in use are counted so
    // duplicates spread across the available types.
    const chosen = new Map();
    {
      const types = agentTypes.list(), pins = agentTypes.pins(), autoRoots = agentTypes.autoRoots();
      const usage = new Map();
      const ordered = [...agents].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id)));
      for (const a of ordered) {
        const pk = projectKeyOf(a);
        const fat = a.firm && a.firm.agentType;
        let t = (fat && agentTypes.get(fat)) || agentTypes.get(pins.sessions[a.id]) || agentTypes.get(pins.projects[pk.key]) || null;
        let auto = false;
        // An automatic pick never overrides a species you assigned to that role on the Forge page.
        if (!t && !fat && (!isRoot(a) || autoRoots) && !(a.firmRole && roleSpecies[a.firmRole])) { t = pickType({ agent: a, project: { key: pk.key, name: pk.name }, types, usage }); auto = !!t; }
        if (t) { chosen.set(a.id, { t, auto }); usage.set(t.slug, (usage.get(t.slug) || 0) + 1); }
      }
    }
    // Variety: with `spread` on, the first agent of a kind in a project wears the kind's own pet and the copies
    // spread over every ready pet, least-used first, so fifteen workers are not fifteen of the same sprite.
    // Pinned and Firm-chosen kinds keep exactly their own pet. Choices stick to the agent between refreshes.
    const spreadSpecies = new Map();   // agent id → species slug
    {
      const present = new Set(agents.map((a) => a.id));
      for (const id of [...speciesSticky.keys()]) if (!present.has(id)) speciesSticky.delete(id);
      if (agentTypes.spread()) {
        const pool = species.list().filter((x) => x.ready && !x.draft).map((x) => x.slug).sort();
        const readySet = new Set(pool);
        const used = new Map();   // `${project}|${species}` → count
        const projectOf = (a) => projectKeyOf(a).key;
        const ordered = [...agents].filter((a) => (chosen.get(a.id) || {}).auto)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id)));
        const claim = (a, sp) => { const k = `${projectOf(a)}|${sp}`; used.set(k, (used.get(k) || 0) + 1); spreadSpecies.set(a.id, sp); speciesSticky.set(a.id, sp); };
        for (const a of ordered) if (readySet.has(speciesSticky.get(a.id))) claim(a, speciesSticky.get(a.id));
        const hash = (str) => { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return h; };
        for (const a of ordered) {
          if (spreadSpecies.has(a.id)) continue;
          const own = chosen.get(a.id).t.species;
          const pk = projectOf(a);
          const cands = [own, ...pool.filter((x) => x !== own)];
          cands.sort((x, y) => (used.get(`${pk}|${x}`) || 0) - (used.get(`${pk}|${y}`) || 0)
            || (x === own ? -1 : y === own ? 1 : 0) || hash(`${a.id}|${x}`) - hash(`${a.id}|${y}`));
          claim(a, cands[0]);
        }
      }
    }

    // Wear a type: its species (art), its filter unless the pet has one you chose, and a `type` tag for the UI.
    const withType = (look, t, speciesOverride) => {
      const sp = speciesOverride || (t && t.species);
      if (!t || !(species.get(sp) || {}).ready) return look;
      let l = look;
      if (sp !== look.species) l = { ...lookOf({ id: look.petId, name: look.name, species: sp, tint: 'none', env: null }), petId: look.petId, sub: look.sub, virtual: look.virtual };
      if (t.tint && (!l.tint || l.tint === 'none')) { const tt = tintById(t.tint); if (tt) l = { ...l, tint: t.tint, tintRgb: tt.rgb, tintAlpha: tt.alpha, tintCss: cssColor(t.tint) }; }
      return { ...l, type: { slug: t.slug, name: t.name, personality: t.personality, category: t.category } };
    };

    const out = new Map();
    for (const a of agents) {
      const look = rootLooks.get(isRoot(a) ? a.id : a.rootId);
      if (!look) continue;
      const base = withRoleTint(typed(a, isRoot(a) ? look : childLook(look, a.firmRole)), a.firmRole);
      out.set(a.id, withType(base, (chosen.get(a.id) || {}).t, spreadSpecies.get(a.id)));
    }
    return out;
  }

  // Role → filter (a tint id). Blank clears; unknown roles/tints are rejected.
  function setRoleTint(map) {
    const clean = {};
    for (const [role, id] of Object.entries(map || {})) {
      if (!FIRM_ROLES.includes(role)) throw new Error(`Unknown Firm role: ${role}`);
      if (id === null || id === '' || id === 'none') continue;
      if (!tintById(id)) throw new Error(`Unknown tint: ${id}`);
      clean[role] = id;
    }
    roleTint = clean;
    return clean;
  }

  // Validate and store the role → species map; unknown roles/species are rejected.
  const FIRM_ROLES = ['management', 'lead', 'worker', 'inspector', 'scout', 'plan', 'critique', 'review'];
  function setRoleSpecies(map) {
    const clean = {};
    for (const [role, sp] of Object.entries(map || {})) {
      if (!FIRM_ROLES.includes(role)) throw new Error(`Unknown Firm role: ${role}`);
      if (sp === null || sp === '') continue;
      if (!(species.get(sp) || {}).ready) throw new Error(`Unknown species: ${sp}`);
      clean[role] = sp;
    }
    roleSpecies = clean;
    return clean;
  }

  // --- snapshot for the UI ----------------------------------------------------------------
  function iconPath(slug) { return resolveAsset('dock-icon.png', { char: slug }); }

  function snapshot() {
    refresh();
    return {
      lead: leadCache && leadCache.id,
      pets: petsCache.map((p) => ({ ...p, look: lookOf(p) })),
      species: species.list().map((s) => ({ ...s, thumb: s.ready ? thumb(iconPath(s.slug), 56) : null })),
      environs: environs.list().map((e) => ({ id: e.id, display: e.display, description: e.description, builtin: e.builtin, thumb: thumb(e.path, 72) })),
      tints: TINTS.map((t) => ({ id: t.id, label: t.label, css: cssColor(t.id) })),
      borders: BORDERS.map((b) => ({ id: b.id, label: b.label, thumb: b.file ? thumb(path.join(assetsDir, b.file), 64) : null })),
    };
  }

  // --- roster operations ------------------------------------------------------------------
  function nextTint(slug, offset = 0) {
    const used = new Set(petsCache.filter((p) => p.species === slug).map((p) => p.tint));
    const free = CYCLE.filter((t) => !used.has(t));
    return free.length ? free[offset % free.length] : CYCLE[(petsCache.length + offset) % CYCLE.length];
  }

  function createPets({ species: slug, name, tint, count = 1 }) {
    const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), 24);
    const made = [];
    for (let i = 0; i < n; i++) {
      refresh();
      const dup = petsCache.some((p) => p.species === slug);
      const useTint = tint !== undefined && tint !== null && n === 1 ? tint : (dup || n > 1 ? nextTint(slug, 0) : 'none');
      made.push(roster.create({ species: slug, name: n === 1 ? name : undefined, tint: useTint }));
    }
    refresh();
    return made;
  }

  function seed(preferredSpecies) {
    const slug = preferredSpecies && (species.get(preferredSpecies) || {}).ready ? preferredSpecies : 'orc';
    roster.ensureSeed(slug);
    refresh();
  }

  // --- generation + import ----------------------------------------------------------------
  function prompt({ kind, slug, spec = {}, row, cell }) {
    if (kind === 'extra') {
      const sp0 = (slug && species.get(slug)) || {};
      return gen.buildExtraPrompt({ name: spec.name, action: spec.action, description: spec.brief || sp0.brief, scene: sp0.scene || undefined, activity: sp0.activity || undefined, setting: sp0.setting || 'desk', layout: sp0.layout || 'baked', cell: cell || 512 });
    }
    if (kind === 'environ') return gen.buildEnvironPrompt({ name: spec.name, description: spec.description, size: cell || 0 });
    const sp = (slug && species.get(slug)) || {};
    const pick = (k, fallback) => (spec[k] !== undefined && spec[k] !== '' ? spec[k] : (sp[k] || fallback));
    const args = {
      name: slug || spec.name || 'pet',
      description: pick('brief', ''),
      scene: pick('scene', undefined),
      activity: pick('activity', undefined),
      setting: pick('setting', 'desk'),
      layout: pick('layout', 'baked'),
      cell: cell === undefined ? 0 : cell,
    };
    if (kind === 'edit') {
      return gen.buildEditPrompt({ name: args.name, description: args.description, activity: args.activity, setting: args.setting, scene: args.scene, props: spec.props || '' });
    }
    return kind === 'strip' ? gen.buildStripPrompt({ ...args, row }) : gen.buildAtlasPrompt(args);
  }

  async function importSheet({ slug, atlas, strips, chroma }) {
    if (!species.get(slug)) throw new Error('Unknown species');
    const r = await importCharacter({ name: slug, atlas, strips, destRoot: customRoot, chroma: chroma || null });
    species.update(slug, { layout: r.layout });
    refresh();
    return r;
  }

  // Add (or replace) a named extra animation from a 6×1 strip and register it on the species.
  async function importExtra({ slug, name, strip, fps = 10, loops = 1, triggers = [], chroma = null }) {
    const sp = species.get(slug);
    if (!sp) throw new Error('Unknown species');
    const cleanName = String(name || '').trim().toLowerCase();
    const existing = sp.extras.find((e) => e.name === cleanName);
    const bundledExtras = own(bundled, slug) && bundled[slug]['extras.png'] ? path.join(assetsDir, bundled[slug]['extras.png']) : null;
    const r = await importExtraRow({ slug, strip, customRoot, bundledExtras, row: existing ? existing.row : null, chroma });
    const entry = { name: cleanName, row: r.row, fps: existing ? existing.fps : fps, loops: existing ? existing.loops : loops, triggers: existing ? existing.triggers : triggers };
    species.update(slug, { extras: [...sp.extras.filter((e) => e.name !== cleanName), entry] });
    refresh();
    return r;
  }

  async function importEnvironFile({ source, display, description = '' }) {
    const id = environs.newId(display);
    const r = await importEnvironment({ source, destFile: path.join(userDataDir, 'environs', `${id}.png`) });
    environs.updateMeta(id, { display: String(display || id).trim() || id, description });
    return { id, ...r };
  }

  // Edit a project, checking that its frame / environment exist.
  function updateProject(key, patch) {
    const clean = { ...patch };
    if (clean.frame !== undefined && clean.frame !== null && !borderById(clean.frame)) throw new Error(`Unknown frame style: ${clean.frame}`);
    if (clean.env !== undefined && clean.env !== null && !environs.has(clean.env)) throw new Error(`Unknown environment: ${clean.env}`);
    return projects.update(key, clean);
  }

  return {
    species, environs, roster, projects, agentTypes, ledger, typeChecks, updateProject,
    refresh, snapshot, lookOf, assign, resolveAsset, seed,
    lead: () => leadCache,
    pets: () => petsCache,
    FIRM_ROLES, setRoleSpecies, roleSpeciesMap: () => ({ ...roleSpecies }), setRoleTint, roleTintMap: () => ({ ...roleTint }),
    createPets, prompt, importSheet, importExtra, importEnvironFile, nextTint,
    customRoot, iconPath,
  };
}

module.exports = { createPetsService };
