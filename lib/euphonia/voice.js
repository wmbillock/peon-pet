'use strict';
// Euphonia's own voice: a peon-ping sound pack, distinct from the rotation the user's agents use.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_PACK = 'ra2_eva_commander';   // an assistant-sounding, work-safe pack outside the user's rotation
const PACK_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CUE_ORDER = ['task.complete', 'task.acknowledge', 'session.start'];

// A sound file for a finished reply. Manifests are third-party data: never leave the pack directory.
function pickCue(pack, peonDir, rand = Math.random) {
  if (!PACK_RE.test(String(pack))) return null;
  const packDir = path.join(peonDir, 'packs', pack);
  const manifest = ['openpeon.json', 'manifest.json'].map((f) => path.join(packDir, f)).find((f) => fs.existsSync(f));
  if (!manifest) return null;
  let cats = {};
  try { cats = JSON.parse(fs.readFileSync(manifest, 'utf8')).categories || {}; } catch { return null; }
  const resolve = (f) => [f, path.join('sounds', f)].map((rel) => path.resolve(packDir, rel))
    .find((abs) => abs.startsWith(packDir + path.sep) && fs.existsSync(abs));
  for (const cat of CUE_ORDER) {
    const found = ((cats[cat] || {}).sounds || []).map((s) => s.file && resolve(s.file)).filter(Boolean);
    if (found.length) return found[Math.floor(rand() * found.length)];
  }
  return null;
}

function playCue(file, volume = 0.5, spawnImpl = spawn) {
  if (!file) return false;
  const p = spawnImpl('afplay', ['-v', String(volume), file], { stdio: 'ignore' });
  if (p && p.on) p.on('error', () => {});
  return true;
}

module.exports = { DEFAULT_PACK, pickCue, playCue, PACK_RE };
