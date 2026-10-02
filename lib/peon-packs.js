const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { peonDir } = require('./peon-sound');

const DEFAULT_CATEGORIES = {
  'session.start': true, 'task.acknowledge': true, 'task.complete': true, 'task.error': true,
  'input.required': true, 'resource.limit': true, 'user.spam': true,
};
const PACK_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Write via temp file + rename so a concurrent reader (the peon-ping hook) never sees a partial file.
function writeJsonAtomic(file, data) {
  const tmp = `${file}.peonpet-${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Installed packs, skipping unapproved drafts (`peon packs use` refuses them too).
function listPacks(dir = peonDir()) {
  const packsDir = path.join(dir, 'packs');
  let names;
  try { names = fs.readdirSync(packsDir); } catch { return []; }
  const packs = [];
  for (const name of names) {
    if (!PACK_NAME_RE.test(name)) continue;
    const manifest = ['openpeon.json', 'manifest.json']
      .map((f) => path.join(packsDir, name, f))
      .find((f) => fs.existsSync(f));
    if (!manifest) continue;
    const m = readJson(manifest, {});
    if (m.x_openpeon_draft) continue;
    packs.push({ name, display: m.display_name || name });
  }
  return packs.sort((a, b) => a.display.localeCompare(b.display));
}

function packOf(entry) {
  return (entry && typeof entry === 'object' ? entry.pack : entry) || null;
}

// Snapshot for the control panel.
function getPackState(dir = peonDir()) {
  const cfg = readJson(path.join(dir, 'config.json'), {});
  const state = readJson(path.join(dir, '.state.json'), {});
  const sessionPacks = {};
  for (const [sid, entry] of Object.entries(state.session_packs || {})) {
    const pack = packOf(entry);
    if (pack) sessionPacks[sid] = pack;
  }
  return {
    packs: listPacks(dir),
    defaultPack: cfg.default_pack || cfg.active_pack || 'peon',
    rotationMode: cfg.pack_rotation_mode || 'random',
    rotation: Array.isArray(cfg.pack_rotation) ? cfg.pack_rotation.filter((n) => typeof n === 'string') : [],
    categories: { ...DEFAULT_CATEGORIES, ...(cfg.categories || {}) },
    desktopNotifications: cfg.desktop_notifications !== false,
    volume: typeof cfg.volume === 'number' ? cfg.volume : 0.5,
    pathRuleCount: Array.isArray(cfg.path_rules) ? cfg.path_rules.length : 0,
    sessionPacks,
  };
}

function assertInstalled(name, dir) {
  if (typeof name !== 'string' || !PACK_NAME_RE.test(name) || !listPacks(dir).some((p) => p.name === name)) {
    throw new Error(`Unknown pack: ${name}`);
  }
}

// Pin packs for sessions in peon-ping's state. Only the `session_packs` key is touched,
// and the read→write window is kept synchronous to minimise racing the hook's own writes.
function setSessionPacks(sessionIds, name, dir = peonDir()) {
  assertInstalled(name, dir);
  const file = path.join(dir, '.state.json');
  const state = readJson(file, {});
  const sp = state.session_packs && typeof state.session_packs === 'object' ? state.session_packs : {};
  const now = Date.now() / 1000;
  for (const sid of sessionIds) sp[sid] = { pack: name, last_used: now };
  state.session_packs = sp;
  writeJsonAtomic(file, state);
}

// Clear a pin so the session falls back to path rules / the global default.
function clearSessionPack(sessionId, dir = peonDir()) {
  const file = path.join(dir, '.state.json');
  const state = readJson(file, {});
  if (!state.session_packs || !(sessionId in state.session_packs)) return;
  delete state.session_packs[sessionId];
  writeJsonAtomic(file, state);
}

// Prefer `peon.sh packs use` (the supported path); fall back to editing config.json directly.
function setGlobalPack(name, dir = peonDir()) {
  return new Promise((resolve, reject) => {
    assertInstalled(name, dir);
    const direct = () => {
      try {
        const file = path.join(dir, 'config.json');
        const cfg = readJson(file, {});
        cfg.default_pack = name;
        delete cfg.active_pack;
        writeJsonAtomic(file, cfg);
        resolve();
      } catch (e) { reject(e); }
    };
    const script = path.join(dir, 'peon.sh');
    if (!fs.existsSync(script)) return direct();
    execFile('bash', [script, 'packs', 'use', name], { timeout: 10000 }, (err) => {
      if (err) return direct();
      resolve();
    });
  });
}

function setVolume(value, dir = peonDir()) {
  const v = Math.round(Math.min(1, Math.max(0, Number(value))) * 100) / 100;
  if (!Number.isFinite(v)) throw new Error('Invalid volume');
  const file = path.join(dir, 'config.json');
  const cfg = readJson(file, {});
  cfg.volume = v;
  writeJsonAtomic(file, cfg);
  return v;
}

// Only whitelisted keys are writable from the panel.
function setCategory(category, enabled, dir = peonDir()) {
  if (!Object.hasOwn(DEFAULT_CATEGORIES, category)) throw new Error(`Unknown category: ${category}`);
  const file = path.join(dir, 'config.json');
  const cfg = readJson(file, {});
  cfg.categories = { ...DEFAULT_CATEGORIES, ...(cfg.categories || {}), [category]: !!enabled };
  writeJsonAtomic(file, cfg);
}

function setDesktopNotifications(enabled, dir = peonDir()) {
  const file = path.join(dir, 'config.json');
  const cfg = readJson(file, {});
  cfg.desktop_notifications = !!enabled;
  writeJsonAtomic(file, cfg);
}

// A sound file from the pack's manifest, preferring greeting-style categories.
function pickSample(name, dir = peonDir(), rand = Math.random) {
  assertInstalled(name, dir);
  const packDir = path.join(dir, 'packs', name);
  const manifest = ['openpeon.json', 'manifest.json']
    .map((f) => path.join(packDir, f)).find((f) => fs.existsSync(f));
  const cats = readJson(manifest, {}).categories || {};
  const order = ['session.start', 'task.complete', 'task.acknowledge', ...Object.keys(cats)];
  // Manifests are third-party data: never play anything outside the pack dir.
  // Some packs list bare filenames that live under sounds/, so try both locations.
  const resolve = (f) => [f, path.join('sounds', f)]
    .map((rel) => path.resolve(packDir, rel))
    .find((abs) => abs.startsWith(packDir + path.sep) && fs.existsSync(abs));
  for (const cat of order) {
    const found = ((cats[cat] || {}).sounds || [])
      .map((snd) => snd.file && resolve(snd.file)).filter(Boolean);
    if (found.length) return found[Math.floor(rand() * found.length)];
  }
  return null;
}

let auditionProc = null;
function auditionPack(name, dir = peonDir()) {
  const file = pickSample(name, dir);
  if (!file) throw new Error(`No playable sound in ${name}`);
  if (auditionProc) { try { auditionProc.kill(); } catch { /* already gone */ } }
  const vol = getPackState(dir).volume;
  auditionProc = spawn('afplay', ['-v', String(vol), file], { stdio: 'ignore' });
  auditionProc.on('error', () => {});  // no afplay (non-mac): silently skip
  auditionProc.on('exit', () => { auditionProc = null; });
}

module.exports = {
  listPacks, getPackState, setSessionPacks, clearSessionPack, setGlobalPack,
  setVolume, setCategory, setDesktopNotifications, pickSample, auditionPack,
};
