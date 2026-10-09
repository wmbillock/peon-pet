'use strict';
// Art described by manifests in scripts/ (themed species and the background library), so adding art is a data
// change: drop the PNGs in renderer/assets and list them in the manifest. Nothing here edits source tables.
//   scripts/art-selection.json      species (atlas + icon + brief + defaults) and four environments
//   scripts/character-library.json  45 more characters (same entry shape, grouped by collection)
//   scripts/background-library.json 60 categorised environments
//   scripts/art-cutout-envs.json    one environment per plan species (scripts/install-art-envs.js)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (name) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', name), 'utf8')); } catch { return {}; } };
const base = (p) => path.basename(String(p || ''));

// Species from art-selection.json and from the 45-character library (scripts/character-library.json); first wins on a clash.
function speciesEntries(sel = read('art-selection.json'), lib = read('character-library.json')) {
  const seen = new Set();
  const out = [];
  for (const s of [...(Array.isArray(sel.species) ? sel.species : []), ...(Array.isArray(lib.species) ? lib.species : [])]) {
    if (!s || typeof s.slug !== 'string' || seen.has(s.slug)) continue;
    seen.add(s.slug);
    out.push(s);
  }
  return out;
}

// slug → { 'sprite-atlas.png', 'dock-icon.png' } for species that have art. Drafts (no atlas) are left out.
function bundledFromManifest(sel) {
  const out = {};
  for (const s of speciesEntries(sel)) {
    if (!s.atlas) continue;
    out[s.slug] = { 'sprite-atlas.png': base(s.atlas), ...(s.icon ? { 'dock-icon.png': base(s.icon) } : {}) };
  }
  return out;
}

// slug → species metadata (same shape as species-defaults.js).
function defaultsFromManifest(sel) {
  const out = {};
  for (const s of speciesEntries(sel)) {
    out[s.slug] = {
      display: s.display || s.slug, brief: s.brief || '', localOnly: !!s.localOnly,
      layout: s.layout === 'cutout' ? 'cutout' : 'baked', setting: s.setting === 'free' ? 'free' : 'desk',
      defaultEnv: s.defaultEnv || null, activity: s.activity || '',
      facts: s.theme ? [{ key: 'Theme', value: s.theme }] : [],
    };
  }
  return out;
}

// Built-in environments from both manifests; only those whose image is present. assetsDir: absolute renderer/assets.
function environmentsFromManifests(assetsDir, sel = read('art-selection.json'), lib = read('background-library.json'), own = read('art-cutout-envs.json')) {
  const seen = new Set();
  const out = [];
  for (const e of [...(sel.environments || []), ...(lib.environments || []), ...(own.environments || [])]) {
    if (!e || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(e.id) || seen.has(e.id)) continue;
    const file = path.join(assetsDir, base(e.path));
    if (!fs.existsSync(file)) continue;
    seen.add(e.id);
    out.push({ id: e.id, display: e.display || e.id, description: e.description || '', category: e.category || null, path: file });
  }
  return out;
}

// slug → { layout, setting, defaultEnv, activity } for species whose bundled sheet is a cutout (scripts/install-art-cutouts.js).
function cutoutOverrides(m = read('art-cutouts.json')) {
  const out = {};
  for (const [slug, v] of Object.entries(m.species || {})) {
    out[slug] = { layout: v.layout === 'cutout' ? 'cutout' : 'baked', setting: v.setting === 'free' ? 'free' : 'desk', defaultEnv: v.defaultEnv || null, activity: v.activity || '' };
  }
  return out;
}

module.exports = { cutoutOverrides, bundledFromManifest, defaultsFromManifest, environmentsFromManifests };
