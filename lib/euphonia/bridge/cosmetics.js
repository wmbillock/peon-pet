'use strict';
// pet_set_cosmetics: writes ONLY name, soundPack, border and species into Euphonia's own config.json (local, never a tracked
// file). The app notices the change and updates the pet. Validation mirrors the app: installed pack, existing art, known border.
const fs = require('fs');
const path = require('path');

const PACK_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const BORDER_RE = /^[a-z0-9-]{1,32}$/;

function packInstalled(peonDir, name) {
  const dir = path.join(peonDir, 'packs', name);
  return fs.existsSync(path.join(dir, 'openpeon.json')) || fs.existsSync(path.join(dir, 'manifest.json'));
}
function speciesInstalled({ assetsDir, userDataDir }, slug) {
  const f = `${slug}-sprite-atlas.png`;
  return (assetsDir && fs.existsSync(path.join(assetsDir, f))) || (userDataDir && fs.existsSync(path.join(userDataDir, 'characters', slug, 'sprite-atlas.png')));
}

function applyCosmetics({ patch, configFile, peonDir, assetsDir, userDataDir }) {
  // A config file that exists but does not parse is never overwritten: that would drop every non-cosmetic setting.
  const cfg = (() => {
    let text = null;
    try { text = fs.readFileSync(configFile, 'utf8'); } catch (e) { if (e && e.code === 'ENOENT') return {}; throw new Error(`cannot read ${configFile}: ${e.message}`); }
    try { const o = JSON.parse(text); if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not an object'); return o; } catch (e) { throw new Error(`config.json is not valid JSON (${e.message}); nothing was changed`); }
  })();
  const next = { ...cfg };
  const changed = [];
  if ('name' in patch) {
    const n = String(patch.name == null ? '' : patch.name).trim();
    if (!n || n.length > 32) throw new Error('name must be 1-32 characters');
    next.name = n; changed.push('name');
  }
  if ('soundPack' in patch) {
    if (!PACK_RE.test(String(patch.soundPack)) || !packInstalled(peonDir, patch.soundPack)) throw new Error(`sound pack is not installed: ${String(patch.soundPack).slice(0, 40)}`);
    next.soundPack = String(patch.soundPack); changed.push('soundPack');
  }
  if ('border' in patch) {
    if (!BORDER_RE.test(String(patch.border))) throw new Error('border is not valid');
    next.border = String(patch.border); changed.push('border');
  }
  if ('species' in patch) {
    if (!SLUG_RE.test(String(patch.species)) || !speciesInstalled({ assetsDir, userDataDir }, patch.species)) throw new Error(`species has no installed art: ${String(patch.species).slice(0, 40)}`);
    next.species = String(patch.species); changed.push('species');
  }
  const tmp = `${configFile}.bridge-${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, configFile);
  return { changed, note: 'Saved to the local config. The pet updates within a few seconds.' };
}

module.exports = { applyCosmetics };
