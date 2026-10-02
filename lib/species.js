const fs = require('fs');
const path = require('path');
const DEFAULTS = require('./species-defaults');
const { CHAR_NAME_RE } = require('./characters');

const MAX_FACTS = 30;
const SETTINGS = new Set(['desk', 'free']);
const LAYOUTS = new Set(['baked', 'cutout']);
// Extra animation rows (beyond the 6 standard states) live in <species>/extras.png, 6 frames per row.
// `flourish` = an occasional idle flourish while working; the rest are session events.
const EXTRA_TRIGGERS = ['SubagentStart', 'SessionStart', 'Stop', 'PermissionRequest', 'PostToolUseFailure', 'flourish'];
const EXTRA_NAME_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const clean = (s, max) => String(s ?? '').trim().slice(0, max);

function cleanFacts(facts) {
  if (!Array.isArray(facts)) throw new Error('facts must be a list');
  return facts.slice(0, MAX_FACTS)
    .map((f) => ({ key: clean(f && f.key, 40), value: clean(f && f.value, 500) }))
    .filter((f) => f.key);
}

function cleanExtras(list) {
  if (!Array.isArray(list)) throw new Error('extras must be a list');
  const seen = new Set();
  return list.slice(0, 12).map((e) => {
    const name = String((e && e.name) ?? '').trim().toLowerCase();
    if (!EXTRA_NAME_RE.test(name)) throw new Error(`Invalid extra animation name: "${name}" (lowercase letters, digits, dashes)`);
    if (seen.has(name)) throw new Error(`Duplicate extra animation: ${name}`);
    seen.add(name);
    const row = Number(e.row);
    if (!Number.isInteger(row) || row < 0 || row > 15) throw new Error('Extra row must be 0-15');
    const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
    return {
      name, row,
      fps: num(e.fps, 1, 30, 10),
      loops: num(e.loops, 1, 6, 1),
      triggers: [...new Set((Array.isArray(e.triggers) ? e.triggers : []).filter((t) => EXTRA_TRIGGERS.includes(t)))],
    };
  });
}

function slugify(text) {
  const s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return s && /^[a-z0-9]/.test(s) ? s : 'pet';
}

/**
 * Species = the art + descriptive metadata ("what kind of critter is this").
 * Built-ins come from species-defaults.js; user changes live in `file` (a JSON overrides map), so
 * editing a name or fact never touches the repo. A species without a sheet yet is a `draft`.
 */
function createSpeciesStore({ file, bundledNames, hasSheet }) {
  const bundled = new Set(bundledNames);
  const overrides = () => {
    const data = readJson(file, {});
    return data && typeof data.species === 'object' && data.species ? data.species : {};
  };
  const own = (obj, k) => Object.hasOwn(obj, k);

  function build(slug, ov) {
    const d = own(DEFAULTS, slug) ? DEFAULTS[slug] : {};
    const o = own(ov, slug) ? ov[slug] : {};
    const ready = hasSheet(slug);
    return {
      slug,
      display: o.display || d.display || slug,
      brief: o.brief ?? d.brief ?? '',
      facts: Array.isArray(o.facts) ? o.facts : (d.facts || []),
      localOnly: typeof o.localOnly === 'boolean' ? o.localOnly : !!d.localOnly,
      scene: o.scene ?? d.scene ?? '',
      activity: o.activity ?? d.activity ?? '',
      setting: SETTINGS.has(o.setting) ? o.setting : (d.setting || 'desk'),
      layout: LAYOUTS.has(o.layout) ? o.layout : (d.layout || 'baked'),
      defaultEnv: o.defaultEnv === undefined ? (d.defaultEnv ?? null) : o.defaultEnv,
      extras: Array.isArray(o.extras) ? o.extras : (d.extras || []),
      builtin: bundled.has(slug),
      ready,
      draft: !ready,
    };
  }

  function list() {
    const ov = overrides();
    const slugs = new Set([...bundled, ...Object.keys(ov).filter((s) => CHAR_NAME_RE.test(s))]);
    for (const s of listExtra()) slugs.add(s);
    return [...slugs].map((s) => build(s, ov));
  }

  let listExtra = () => [];   // custom sheet folders, supplied by the caller
  const store = {
    setExtraLister(fn) { listExtra = fn; },
    list,
    get(slug) { return CHAR_NAME_RE.test(slug) ? list().find((s) => s.slug === slug) || null : null; },

    update(slug, patch) {
      if (!CHAR_NAME_RE.test(slug)) throw new Error('Invalid species id');
      const all = readJson(file, {});
      const species = all.species && typeof all.species === 'object' ? all.species : {};
      const cur = own(species, slug) ? species[slug] : {};
      const next = { ...cur };
      if ('display' in patch) {
        const d = clean(patch.display, 40);
        if (!d) throw new Error('Name cannot be empty');
        next.display = d;
      }
      if ('brief' in patch) next.brief = clean(patch.brief, 2000);
      if ('facts' in patch) next.facts = cleanFacts(patch.facts);
      if ('localOnly' in patch) next.localOnly = !!patch.localOnly;
      if ('scene' in patch) next.scene = clean(patch.scene, 1000);
      if ('activity' in patch) next.activity = clean(patch.activity, 500);
      if ('setting' in patch) {
        if (!SETTINGS.has(patch.setting)) throw new Error('setting must be desk or free');
        next.setting = patch.setting;
      }
      if ('layout' in patch) {
        if (!LAYOUTS.has(patch.layout)) throw new Error('layout must be baked or cutout');
        next.layout = patch.layout;
      }
      if ('extras' in patch) next.extras = cleanExtras(patch.extras);
      if ('defaultEnv' in patch) next.defaultEnv = patch.defaultEnv === null ? null : clean(patch.defaultEnv, 40);
      species[slug] = next;
      writeJsonAtomic(file, { version: 1, species });
      return store.get(slug);
    },

    // Reserve a new species id from a display name (a draft until a sheet is imported).
    createDraft({ display, brief = '' }) {
      const name = clean(display, 40);
      if (!name) throw new Error('Name cannot be empty');
      const taken = new Set(list().map((s) => s.slug));
      const base = slugify(name);
      let slug = base;
      for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
      return store.update(slug, { display: name, brief, facts: [], localOnly: false });
    },

    // Only drafts / custom-only species can be forgotten; built-ins are permanent.
    removeDraft(slug) {
      const s = store.get(slug);
      if (!s) throw new Error('Unknown species');
      if (s.builtin || s.ready) throw new Error('Only drafts without a sheet can be removed');
      const all = readJson(file, {});
      if (all.species && own(all.species, slug)) delete all.species[slug];
      writeJsonAtomic(file, { version: 1, species: all.species || {} });
    },
  };
  return store;
}

module.exports = { createSpeciesStore, slugify, cleanFacts, cleanExtras, EXTRA_TRIGGERS };
