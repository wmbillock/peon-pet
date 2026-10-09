'use strict';
// The third-party rule, enforced: a SHIPPED default (what a fresh install uses with no choice made) may name only assets that are
// original/public-domain or already in the published repo. Third-party species art and sound packs stay local to the owner.
//   species: shippable only if it has tracked art AND none of that art is excluded from a distribution (lib/dist-filter.js:
//            third-party `localOnly` flags and "generated-locally" art). A species with no tracked art is not shippable either.
//   packs:   sound packs are third-party audio outside this repo, so no pack may be a shipped default unless listed in SAFE_PACKS
//            (publishable: public-domain or original, with the owner's decision recorded). Empty today.
// User-chosen local overrides (config.json, user-data files, the gitignored lib/character-preferences.local.json) are never checked
// here and are never written into tracked files.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { excluded, localOnlySlugs } = require('./dist-filter');

const SAFE_PACKS = [];

function trackedFiles(root) {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
}

// → Set of species slugs that may appear in a shipped default.
function shippableSpecies(root, files = trackedFiles(root)) {
  const out = new Set(excluded(files));
  const bySlug = new Map();
  for (const f of files) {
    const m = /^renderer\/assets\/([a-z0-9-]+)-(?:sprite-atlas|dock-icon)\.png$/.exec(f);
    if (m) bySlug.set(m[1], [...(bySlug.get(m[1]) || []), f]);
  }
  const local = new Set(localOnlySlugs());
  return new Set([...bySlug].filter(([slug, fs_]) => !local.has(slug) && !fs_.some((f) => out.has(f))).map(([slug]) => slug));
}

// Every place a fresh install gets a species or a pack from, read from the code that ships.
function collectDefaults(root) {
  const req = (p) => require(path.join(root, p));
  const found = [];
  const species = (where, slug) => { if (slug) found.push({ kind: 'species', where, value: slug }); };
  const pack = (where, name) => { if (name) found.push({ kind: 'pack', where, value: name }); };
  const euph = req('lib/euphonia/service.js').DEFAULT_CONFIG;
  species('Euphonia default species (lib/euphonia/service.js)', euph.species);
  pack('Euphonia default sound pack (lib/euphonia/service.js)', euph.soundPack);
  for (const s of req('lib/euphonia/launch.js').species({})) species('Euphonia species fallback (lib/euphonia/launch.js)', s);
  const prefs = req('lib/character-preferences.js').SHIPPED;
  for (const s of Object.keys(prefs.default || {})) species('shipped casting preferences: default', s);
  for (const [kind, m] of Object.entries(prefs.kinds || {})) for (const s of Object.keys(m)) species(`shipped casting preferences: ${kind}`, s);
  for (const s of Object.keys(prefs.rare || {})) species('shipped casting preferences: rare', s);
  for (const t of req('lib/agent-types.js').SEED) species(`seeded agent kind ${t.slug} (lib/agent-types.js)`, t.species);
  return found;
}

function findViolations({ root = path.join(__dirname, '..'), defaults, files } = {}) {
  const ok = shippableSpecies(root, files);
  const list = defaults || collectDefaults(root);
  return list.filter((d) => (d.kind === 'species' ? !ok.has(d.value) : !SAFE_PACKS.includes(d.value)))
    .map((d) => ({ ...d, why: d.kind === 'species' ? 'art is third-party, generated locally, or not published' : 'sound packs are third-party audio; not an approved shipped default' }));
}

module.exports = { findViolations, shippableSpecies, collectDefaults, SAFE_PACKS };
