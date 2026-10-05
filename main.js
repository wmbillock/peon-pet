const { app, BrowserWindow, screen, Menu, Tray, nativeImage, protocol, net, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  isValidSessionId,
  createSessionTracker,
  buildSessionStates,
  EVENT_TO_ANIM,
} = require('./lib/session-tracker');
const { JsonlWatcher } = require('./lib/jsonl-watcher');
const { CodexWatcher } = require('./lib/codex-watcher');
const peonSound = require('./lib/peon-sound');
const peonPacks = require('./lib/peon-packs');
const { createEuphonia } = require('./lib/euphonia/service');
const { registerEuphoniaIpc } = require('./lib/euphonia/ipc');
const BUNDLED_CHARS = require('./lib/bundled-characters');
const { createPetsService } = require('./lib/pets-service');
const { byId: borderById } = require('./lib/borders');
const { registerPetIpc } = require('./lib/ipc-pets');
const { readSessionRegistry, transcriptFor, codexMasters } = require('./lib/live-agents');
const { createFirmClient, createFirmPoller, parseBaseUrl } = require('./lib/firm-client');
const { buildAgents } = require('./lib/agent-graph');
const { applyMarks } = require('./lib/marks');
const { summarizeAgents } = require('./dash/summary');
const { BORDERS } = require('./lib/borders');
const { computeCornerBounds } = require('./lib/corner-window');
const { watchApp } = require('./lib/hot-reload');
const { PixooClient, isValidDeviceIp, applyLook, applyTint, drawSummary } = require('./lib/pixoo');
const { buildAnimFrames } = require('./lib/pixoo-frames');
const { waitMs, cleanInterval } = require('./lib/pixoo-throttle');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'peon-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let win;
let petVisible = true;
let dashWin = null;
let gridWin = null;
let latestSessions = { sessions: [] };
const subAgentWindows = new Map(); // session_id → BrowserWindow
const subAgentCreatedAt = new Map(); // session_id → creation timestamp (ms)
const dummySessionIds = new Set(); // dev-only: protected from sync cleanup
const MAX_SUB_AGENT_WINDOWS = 5;
const SUB_AGENT_BASE_Y_OFFSET = 170; // px from bottom of work area to main pet
const SUB_AGENT_TTL_MS = 10 * 60 * 1000; // 10 min — destroy stale windows if SubagentStop never fired

// --- Character system ---
// Per-character asset maps: canonical name → bundled filename

function parseArgPath(flag) {
  const i = process.argv.indexOf(flag);
  return (i !== -1 && process.argv[i + 1]) ? process.argv[i + 1] : null;
}

const argCharacter = parseArgPath('--character');

function loadPetConfig() {
  try {
    return JSON.parse(fs.readFileSync(
      path.join(app.getPath('userData'), 'peon-pet-config.json'), 'utf8'
    ));
  } catch { return {}; }
}

function savePetConfig(patch) {
  const file = path.join(app.getPath('userData'), 'peon-pet-config.json');
  const next = { ...loadPetConfig(), ...patch };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return next;
}

const bundledAssetsDir = path.join(__dirname, 'renderer', 'assets');
const ASSET_NAMES = new Set(['sprite-atlas.png', 'borders.png', 'bg.png', 'dock-icon.png', 'extras.png']);
let pets = null;  // pets service (species, environments, roster); created once the app is ready

// Resized data-URL thumbnails, cached by file + mtime.
const thumbCache = new Map();
function thumb(file, px) {
  try {
    const key = `${file}|${px}|${fs.statSync(file).mtimeMs}`;
    if (!thumbCache.has(key)) thumbCache.set(key, nativeImage.createFromPath(file).resize({ width: px }).toDataURL());
    return thumbCache.get(key);
  } catch { return null; }
}

function initPets() {
  const savedView = loadPetConfig().cornerView;
  if (CORNER_VIEWS.includes(savedView)) cornerView = savedView;
  armyOn = loadPetConfig().army === true;
  pets = createPetsService({ userDataDir: app.getPath('userData'), assetsDir: bundledAssetsDir, bundled: BUNDLED_CHARS, thumb });
  pets.seed(argCharacter || loadPetConfig().character);  // first run: one lead pet from the old setting
  registerPetIpc({
    ipcMain, dialog, nativeImage, pets, mutate, petSnapshot, savePetConfig, reloadPetWindows, borderById,
    getParentWindow: () => dashWin || undefined,
    clearThumbs: () => thumbCache.clear(),
    onRolesChanged: () => sendSessionUpdate(Date.now()),
    onProjectsChanged: () => sendSessionUpdate(Date.now()),
    frames: BORDERS,
  });
  try { pets.setRoleSpecies(loadPetConfig().roleSpecies || {}); } catch (e) { console.error('[forge] ignoring stale role map:', e.message); }
  try { pets.setRoleTint(loadPetConfig().roleTint || {}); } catch (e) { console.error('[forge] ignoring stale role filters:', e.message); }
}

const resolveAsset = (filename, opts = {}) => pets.resolveAsset(filename, { border: loadPetConfig().border, ...opts });

function registerCharacterProtocol() {
  // peon-asset://<file>[?char=<species>&env=<environment>] — defaults to the lead pet.
  protocol.handle('peon-asset', (request) => {
    const u = new URL(request.url);
    if (!ASSET_NAMES.has(u.hostname)) return new Response('not found', { status: 404 });
    const opts = { char: u.searchParams.get('char') || undefined, env: u.searchParams.get('env') || undefined };
    if (u.searchParams.get('border')) opts.border = u.searchParams.get('border');   // a tile asking for its project's frame
    const file = resolveAsset(u.hostname, opts);
    if (!fs.existsSync(file)) return new Response('not found', { status: 404 });
    return net.fetch('file://' + file);
  });
}

const leadLook = () => { const l = pets && pets.lead(); return l ? pets.lookOf(l) : null; };

function sendLook(w) {
  const look = leadLook();
  if (look && w && !w.isDestroyed()) w.webContents.send('pet-look', look);
}
function broadcastLook() {
  sendLook(win);
  for (const w of subAgentWindows.values()) sendLook(w);
}

function applyCharacterIcons() {
  if (process.platform === 'darwin') app.dock.setIcon(resolveAsset('dock-icon.png'));
  if (tray && !tray.isDestroyed()) {
    tray.setImage(nativeImage.createFromPath(resolveAsset('dock-icon.png')).resize({ width: 18, height: 18 }));
  }
}

// Art or scene changed: rebuild everything that cached the old look.
function reloadPetWindows() {
  pixooFrameCache.clear();
  pixoo.lastSig = null;
  applyCharacterIcons();
  for (const id of [...subAgentWindows.keys()]) destroySubAgentWindow(id);
  for (const w of [win, gridWin]) if (w && !w.isDestroyed()) w.webContents.reloadIgnoringCache();
  schedulePixooSync(0);
  refreshMenus();
}

const lookSig = (l) => JSON.stringify(l && { id: l.petId, sp: l.species, lay: l.layout, env: l.env });

// Run a roster/species mutation, then refresh whatever the lead pet's visuals depend on.
function mutate(fn) {
  const before = leadLook();
  const result = fn();
  pets.refresh();
  const after = leadLook();
  if (lookSig(before) !== lookSig(after)) reloadPetWindows();
  else if (JSON.stringify(before) !== JSON.stringify(after)) { broadcastLook(); pixoo.lastSig = null; schedulePixooSync(0); }
  sendSessionUpdate(Date.now());
  refreshMenus();
  return result;
}

const petSnapshot = () => ({ ...pets.snapshot(), activeBorder: loadPetConfig().border || 'default' });

const tracker = createSessionTracker();
const sessionCwds = new Map();  // session_id → cwd string
const sessionAgents = new Map();  // session_id → 'claude' | 'codex'
const sessionAnims = new Map();  // session_id → { anim, at } most recent reaction (for grid tiles)
const sessionTitles = new Map();  // session_id → { title, kind: 'custom'|'ai' }  (what the user named the session)
// Live-process knowledge (refreshed every 15s): masters are interactive agents you started; workers are headless.
let masterIds = new Set();
let workerIds = new Set();
let liveReady = false;    // true once the first registry read has landed (session names/folders are known)
let liveIds = new Set();   // every session in Claude's registry (its process is running)
let busyIds = new Set();   // …of which currently mid-turn
const sessionRegistry = new Map();  // session_id → registry entry (name, entrypoint, status…)
let firmState = { available: false, threads: [], error: null };   // The Firm's agents (read-only poll)
let firmUrl = null;
let latestLooks = new Map();   // agent id → pet look, so sub-agent windows can wear their parent's tint
const DEFAULT_WORKER_PATTERNS = ['/.firm/worktrees/'];

function roleOf(id, cwd) {
  if (masterIds.has(id)) return 'master';
  const patterns = loadPetConfig().workerPatterns || DEFAULT_WORKER_PATTERNS;
  if (workerIds.has(id) || (!liveIds.has(id) && cwd && patterns.some((p) => cwd.includes(p)))) return 'worker';
  return 'session';
}

const TITLE_RANK = { custom: 3, ai: 2, derived: 1 };   // a name you chose > the auto title > a derived name
function setSessionTitle(id, title, kind) {
  const cur = sessionTitles.get(id);
  if (cur && TITLE_RANK[cur.kind] > TITLE_RANK[kind]) return;
  sessionTitles.set(id, { title, kind });
}

let sessionUpdateTimer = null;
let firmPoller = null;
// (Re)connect to The Firm per the saved settings. Read-only and optional.
function startFirm() {
  if (firmPoller) { firmPoller.stop(); firmPoller = null; }
  const cfg = loadPetConfig();
  firmState = { available: false, threads: [], error: null };
  firmUrl = cfg.firmUrl || 'http://127.0.0.1:8420';
  if (cfg.firm === false) { scheduleSessionUpdate(); return; }
  try {
    firmPoller = createFirmPoller({
      client: createFirmClient({ baseUrl: firmUrl }),
      onChange: (st) => { firmState = st; scheduleSessionUpdate(); if (dashWin && !dashWin.isDestroyed()) dashWin.webContents.send('firm-state', firmSummary()); },
      onTransition: (st) => console.log(st.available ? `[firm] connected (${st.threads.length} agents)` : `[firm] unreachable: ${st.error}`),
    });
    firmPoller.start();
  } catch (e) {
    firmState = { available: false, threads: [], error: e.message };
    console.error('[firm] disabled:', e.message);
  }
}

ipcMain.handle('firm-set', (_e, { enabled, url }) => {
  const clean = String(url || '').trim();
  if (clean) parseBaseUrl(clean);   // throws a readable error for anything but a localhost http URL
  savePetConfig({ firm: !!enabled, firmUrl: clean || undefined });
  startFirm();
  return firmSummary();
});

function firmSummary() {
  const byRole = {};
  for (const t of firmState.threads) byRole[t.role] = (byRole[t.role] || 0) + 1;
  return { enabled: loadPetConfig().firm !== false, available: firmState.available, url: firmUrl, error: firmState.error, total: firmState.threads.length, byRole };
}
ipcMain.handle('firm-get', () => firmSummary());

function scheduleSessionUpdate() {   // transcripts can carry hundreds of title records: coalesce
  clearTimeout(sessionUpdateTimer);
  sessionUpdateTimer = setTimeout(() => sendSessionUpdate(Date.now()), 150);
}

// peon-ping keys Codex sessions as `codex-<id>`; per-session voice pins must use its key.
const peonKey = (id) => (sessionAgents.get(id) === 'codex' ? `codex-${id}` : id);
const remoteSessionIds = new Set();
const remoteLastEvents = new Map();  // session_id → last event string
const SESSION_PRUNE_MS = 10 * 60 * 1000;  // 10min — prune cold sessions
const HOT_MS  = 30 * 1000;       // 30s  — actively working right now
const WARM_MS = 2 * 60 * 1000;   // 2min — session open but idle

async function readRemoteState(baseUrl) {
  try {
    const res = await net.fetch(`${baseUrl}/state`, { signal: AbortSignal.timeout(150) });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function repositionSubAgentWindows() {
  const { height } = screen.getPrimaryDisplay().workAreaSize;
  let i = 0;
  for (const [, subWin] of subAgentWindows) {
    if (!subWin.isDestroyed()) {
      const mainY = height - SUB_AGENT_BASE_Y_OFFSET;
      subWin.setPosition(20, mainY - (i + 1) * 100);
      i++;
    }
  }
}

// parentSessionId: the agent that spawned it, so the mini pet wears that agent's species and tint.
function createSubAgentWindow(sessionId, parentSessionId) {
  if (subAgentWindows.size >= MAX_SUB_AGENT_WINDOWS) return;
  if (subAgentWindows.has(sessionId)) return;
  const parentLook = parentSessionId ? latestLooks.get(parentSessionId) : null;

  const { height } = screen.getPrimaryDisplay().workAreaSize;
  const idx = subAgentWindows.size;

  const subWin = new BrowserWindow({
    width: 100,
    height: 100,
    x: 20,
    y: (height - SUB_AGENT_BASE_Y_OFFSET) - (idx + 1) * 100,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  subWin.setIgnoreMouseEvents(true);

  subWin.loadFile('renderer/index.html', parentLook ? { query: { char: parentLook.species, env: parentLook.env || '' } } : undefined);

  subWin.webContents.once('did-finish-load', () => {
    subWin.webContents.send('peon-config', { size: 100, subAgent: true });
    if (parentLook) subWin.webContents.send('pet-look', parentLook); else sendLook(subWin);
    subWin.webContents.send('peon-event', { anim: 'waking', event: 'SessionStart' });
    startMouseTrackingForWindow(subWin);
  });

  // Don't quit app when sub-agent window closes
  subWin.on('closed', () => {
    subAgentWindows.delete(sessionId);
    subAgentCreatedAt.delete(sessionId);
    repositionSubAgentWindows();
  });

  if (!petVisible) subWin.hide();

  subAgentWindows.set(sessionId, subWin);
  subAgentCreatedAt.set(sessionId, Date.now());
}

function destroySubAgentWindow(sessionId) {
  const subWin = subAgentWindows.get(sessionId);
  if (subWin && !subWin.isDestroyed()) {
    subWin.destroy();
  }
  subAgentWindows.delete(sessionId);
  subAgentCreatedAt.delete(sessionId);
  repositionSubAgentWindows();
}

function handleSessionEvent({ sessionId, event, cwd, timestamp, agent, title, titleKind }) {
  if (!isValidSessionId(sessionId)) return;
  if (event === 'SessionTitle') { setSessionTitle(sessionId, title, titleKind); scheduleSessionUpdate(); return; }
  if (agent && !sessionAgents.has(sessionId)) console.log(`[session] ${agent} ${sessionId.slice(0, 8)} ${event}`);
  if (agent) sessionAgents.set(sessionId, agent);

  const now = Date.now();

  // SessionCwd: just update the display name, no tracker change
  if (event === 'SessionCwd') {
    if (cwd) {
      sessionCwds.set(sessionId, cwd);
      sendSessionUpdate(now);
    }
    return;
  }

  if (event === 'SessionEnd') {
    tracker.remove(sessionId);
    sessionCwds.delete(sessionId);
    sessionAgents.delete(sessionId);
    sessionAnims.delete(sessionId);
    sessionTitles.delete(sessionId);
  } else if (event === 'SessionSeen') {
    // File existed at startup: register with actual file mtime, no animation, no dedup
    tracker.update(sessionId, timestamp || now);
    if (cwd) sessionCwds.set(sessionId, cwd);
  } else {
    if (event === 'SessionStart') {
      // Deduplicate /resume: if exactly one session was seen <5s ago, replace it
      const existing = tracker.entries();
      const isNew = !existing.some(([id]) => id === sessionId);
      if (isNew && existing.length === 1) {
        const [oldId, oldTime] = existing[0];
        if ((now - oldTime) < 5000) tracker.remove(oldId);
      }
    }
    tracker.update(sessionId, now);
    if (cwd) sessionCwds.set(sessionId, cwd);
  }

  tracker.prune(now - SESSION_PRUNE_MS, (id) => liveIds.has(id));   // live sessions stay, however long they idle
  for (const id of sessionCwds.keys()) {
    if (!tracker.entries().some(([sid]) => sid === id)) { sessionCwds.delete(id); sessionAgents.delete(id); sessionTitles.delete(id); }
  }

  sendSessionUpdate(now);

  const anim = EVENT_TO_ANIM[event];
  if (anim) sessionAnims.set(sessionId, { anim, at: now });
  if (anim && win && !win.isDestroyed()) {
    win.webContents.send('peon-event', { anim, event });
  }
}

let lastSessionSig = '';
function sendSessionUpdate(now) {
  const sessions = buildSessionStates(tracker.entries(), now, HOT_MS, WARM_MS, 200);
  const times = new Map(tracker.entries());
  const rows = sessions.map(s => {
    const cwd = sessionCwds.get(s.id) || null;
    const role = roleOf(s.id, cwd);
    const t = sessionTitles.get(s.id);
    return {
      ...s,
      lastActive: times.get(s.id),
      cwd,
      name: cwd ? path.basename(cwd) : null,
      title: t ? t.title : null,
      titleKind: t ? t.kind : null,
      role,
      status: busyIds.has(s.id) ? 'busy' : liveIds.has(s.id) ? 'idle' : null,
      live: liveIds.has(s.id),
      rank: role === 'master' ? 0 : 1,
      agent: sessionAgents.get(s.id) || 'claude',
      peonKey: peonKey(s.id),
      anim: (sessionAnims.get(s.id) || {}).anim || null,
      animAt: (sessionAnims.get(s.id) || {}).at || 0,
    };
  });
  // Merge in The Firm's agents, then order: roots (masters first, stable) each followed by their children.
  const agents = buildAgents({ sessions: rows, firmThreads: firmState.threads, now }).slice(0, 48);
  const sig = `${agents.length}/${agents.filter((r) => r.hot).length}/${agents.filter((r) => r.warm).length}`;
  if (sig !== lastSessionSig) {   // one line per change: total/hot/warm and who
    lastSessionSig = sig;
    console.log(`[sessions] ${sig} ${agents.map((r) => `${r.isRoot ? (r.role === 'master' ? 'M:' : 'R:') : ' ·'}${(r.title || r.name || '?').slice(0, 16)}${r.hot ? '*' : r.warm ? '~' : '.'}`).join(' ')}`);
  }
  const baseLooks = pets ? pets.assign(agents) : new Map();
  // Project identity (emoji, colour family, frame, environment) and per-type shades.
  const marks = pets ? applyMarks({ agents, looks: baseLooks, resolveProject: (k, n, seed) => (liveReady ? pets.projects.resolve(k, n, seed) : pets.projects.peek(k, n)), firmProjects: firmState.projects || {}, assignments: liveReady ? pets.projects.assignments() : {} }) : new Map();
  const looks = new Map([...marks].map(([id, m]) => [id, m.look]).filter(([, l]) => l));
  latestLooks = looks;
  const payload = {
    sessions: agents.map((r) => ({ ...r, pet: looks.get(r.id) || null, project: (marks.get(r.id) || {}).project || null, mark: (marks.get(r.id) || {}).mark || null })),
    firm: { available: firmState.available, url: firmUrl },
  };
  latestSessions = payload;
  if (gridWin && !gridWin.isDestroyed()) gridWin.webContents.send('grid-sessions', payload);
  syncArmy();
  for (const w of armyWins.values()) if (!w.isDestroyed()) w.webContents.send('grid-sessions', payload);
  if (pixooConfig().enabled) schedulePixooSync();
  if (win && !win.isDestroyed()) win.webContents.send('session-update', payload);
  if (dashWin && !dashWin.isDestroyed()) dashWin.webContents.send('dash-sessions', payload);
}

function syncRemoteSessionsToTracker(state) {
  if (!state || !state.sessions) return;
  const now = Date.now();
  const incoming = state.sessions;

  for (const [sid, entry] of Object.entries(incoming)) {
    if (!isValidSessionId(sid)) continue;
    tracker.update(sid, entry.timestamp * 1000);  // relay uses Unix seconds
    if (entry.cwd) sessionCwds.set(sid, entry.cwd);
    remoteSessionIds.add(sid);
    const anim = EVENT_TO_ANIM[entry.event];
    if (anim && entry.event !== remoteLastEvents.get(sid)) {
      remoteLastEvents.set(sid, entry.event);
      if (win && !win.isDestroyed()) win.webContents.send('peon-event', { anim, event: entry.event });
    }
  }

  for (const sid of [...remoteSessionIds]) {
    if (!incoming[sid]) {
      tracker.remove(sid);
      sessionCwds.delete(sid);
      remoteSessionIds.delete(sid);
      remoteLastEvents.delete(sid);
    }
  }

  sendSessionUpdate(now);
}

function startPolling() {
  const cfg = loadPetConfig();
  const remoteUrl = cfg.remoteUrl || 'http://127.0.0.1:19998';

  const watcher = new JsonlWatcher();

  const codexWatcher = new CodexWatcher();
  const watchers = [watcher, codexWatcher];

  for (const w of watchers) {
    w.on('session-event', handleSessionEvent);
    w.on('subagent-event', ({ sessionId: parentSession, parentToolId, event }) => {
      if (event === 'SubagentStart' && win && !win.isDestroyed()) win.webContents.send('peon-event', { anim: null, event });  // lets pets react to a newcomer
      if (event === 'SubagentStart') createSubAgentWindow(parentToolId, parentSession);
      if (event === 'SubagentStop')  destroySubAgentWindow(parentToolId);
    });
    w.start();
  }

  // Which sessions are alive, and which are masters? Claude's own registry (~/.claude/sessions) lists
  // every live session with its name, idle/busy status and entrypoint ('cli' = you; 'sdk-*' = launched
  // by software like The Firm). Live sessions' transcripts are tracked however long they've been quiet.
  function refreshLive() {
    try {
      const reg = readSessionRegistry();
      masterIds = new Set(reg.filter((r) => r.role === 'master').map((r) => r.sessionId));
      workerIds = new Set(reg.filter((r) => r.role === 'worker').map((r) => r.sessionId));
      liveIds = new Set(reg.map((r) => r.sessionId));
      busyIds = new Set(reg.filter((r) => r.status === 'busy').map((r) => r.sessionId));
      for (const r of reg) {
        const file = transcriptFor(r);
        if (file && watcher.trackFile(file)) console.log(`[live] tracking ${r.role} ${r.name || r.sessionId.slice(0, 8)}`);
        if (r.name) setSessionTitle(r.sessionId, r.name, r.nameSource === 'user' ? 'custom' : 'derived');
        if (r.status === 'busy') tracker.update(r.sessionId, Date.now());
        if (!sessionCwds.has(r.sessionId)) sessionCwds.set(r.sessionId, r.cwd);
        sessionRegistry.set(r.sessionId, r);
      }
      for (const id of [...sessionRegistry.keys()]) if (!liveIds.has(id)) sessionRegistry.delete(id);
      // Codex: no registry, so "recently written main session" stands in for "a live master".
      for (const m of codexMasters(codexWatcher.getMainSessions())) {
        masterIds.add(m.sessionId); liveIds.add(m.sessionId);
        tracker.update(m.sessionId, m.mtime);
        if (m.cwd && !sessionCwds.has(m.sessionId)) sessionCwds.set(m.sessionId, m.cwd);
      }
      liveReady = true;
      sendSessionUpdate(Date.now());
    } catch (e) {
      console.error('[live] registry read failed:', e.message);
    }
  }
  refreshLive();
  setInterval(refreshLive, 4000);

  startFirm();

  // Heartbeat: refresh session hot/warm status so the pet correctly decays.
  // Sessions with pending tools are kept hot so the pet stays awake during long tool runs.
  // Also runs the TTL sweep for sub-agent windows whose SubagentStop never fired.
  setInterval(() => {
    const now = Date.now();
    const expired = [...subAgentCreatedAt.entries()]
      .filter(([sid, createdAt]) => now - createdAt > SUB_AGENT_TTL_MS && !dummySessionIds.has(sid))
      .map(([sid]) => sid);
    for (const sid of expired) destroySubAgentWindow(sid);

    if (tracker.entries().length === 0) return;
    for (const w of watchers) {
      for (const sessionId of w.getActiveSessionIds()) tracker.update(sessionId, now);
    }
    for (const sessionId of busyIds) tracker.update(sessionId, now);
    sendSessionUpdate(now);
  }, 5000);

  // Remote relay sync (less frequent, not time-critical)
  setInterval(async () => {
    syncRemoteSessionsToTracker(await readRemoteState(remoteUrl));
  }, 5000);
}

// --- Pixoo 64 mirror ---
// Pushes the pet's current animation (plus session dots) to a Divoom Pixoo 64 on the LAN.
const pixoo = { client: null, status: 'off', lastSig: null, busy: false, dirty: false, timer: null, lastSentAt: 0, force: false };
const pixooFrameCache = new Map();  // anim → { frames, speedMs }
let petAnim = 'sleeping';

function pixooConfig() {
  const c = loadPetConfig().pixoo || {};
  return {
    enabled: !!c.enabled,
    ip: c.ip || '',
    look: Number.isFinite(c.look) ? c.look : 60,
    brightness: Number.isFinite(c.brightness) ? c.brightness : null,  // null = leave the device alone
    minIntervalSec: cleanInterval(c.minIntervalSec),   // at most one update to the display per this many seconds
  };
}

function setPixooStatus(status) {
  if (status !== pixoo.status) console.log(`[pixoo] ${status}`);
  pixoo.status = status;
  if (dashWin && !dashWin.isDestroyed()) dashWin.webContents.send('pixoo-state', { ...pixooConfig(), status });
}

function pixooAnimFrames(anim) {
  const look = leadLook();
  const key = `${look && look.species}|${look && look.env}|${anim}`;
  if (!pixooFrameCache.has(key)) {
    // Cutout pets are composited onto their environment; baked sheets already contain the scene.
    const bgPath = look && look.layout === 'cutout' ? resolveAsset('bg.png') : null;
    pixooFrameCache.set(key, buildAnimFrames(nativeImage, resolveAsset('sprite-atlas.png'), anim, { bgPath }));
  }
  return pixooFrameCache.get(key);
}

function schedulePixooSync(delayMs = 300) {
  clearTimeout(pixoo.timer);
  pixoo.timer = setTimeout(runPixooSync, delayMs);
}

async function runPixooSync() {
  const { enabled, ip, look, brightness, minIntervalSec } = pixooConfig();
  if (!enabled || !ip) { pixoo.client = null; setPixooStatus('off'); return; }
  if (pixoo.busy) { pixoo.dirty = true; return; }
  pixoo.busy = true;
  try {
    if (!pixoo.client || pixoo.client.ip !== ip) { pixoo.client = new PixooClient(ip); pixoo.lastSig = null; }
    const sessions = latestSessions.sessions || [];
    const lead = leadLook();
    const summary = summarizeAgents(sessions);
    const sig = `${lead && lead.petId}|${lead && lead.tint}|${petAnim}|${look}|${brightness}|${summary.working}/${summary.idle}/${summary.attention}`;
    if (sig !== pixoo.lastSig) {
      // Go easy on the display: hold changes back until the interval is up, then send whatever is current.
      const wait = waitMs({ lastSentAt: pixoo.lastSentAt, now: Date.now(), minIntervalSec, force: pixoo.force });
      if (wait > 0) { schedulePixooSync(wait); return; }
      pixoo.force = false;
      const { frames, speedMs } = pixooAnimFrames(petAnim);
      if (brightness !== null) await pixoo.client.setBrightness(brightness);
      await pixoo.client.showAnimation(frames.map((f) => drawSummary(applyTint(applyLook(f, look), lead && lead.tintRgb, lead ? lead.tintAlpha : 0), summary)), speedMs);
      pixoo.lastSig = sig;
      pixoo.lastSentAt = Date.now();
      console.log(`[pixoo] update sent (limit ${minIntervalSec}s)`);
    }
    setPixooStatus('connected');
  } catch (e) {
    pixoo.lastSig = null;
    setPixooStatus(`error: ${e.message}`);
    schedulePixooSync(Math.max(15000, minIntervalSec * 1000));  // device asleep / wrong IP: retry quietly, no faster than the update interval
  } finally {
    pixoo.busy = false;
    if (pixoo.dirty) { pixoo.dirty = false; schedulePixooSync(); }
  }
}

ipcMain.on('anim-changed', (e, anim) => {
  if (!win || win.isDestroyed() || e.sender !== win.webContents) return;  // ignore sub-agent windows
  if (typeof anim !== 'string' || anim === petAnim) return;
  petAnim = anim;
  schedulePixooSync();
});

ipcMain.handle('pixoo-get', () => ({ ...pixooConfig(), status: pixoo.status }));
ipcMain.handle('pixoo-set', (_e, patch) => {
  const cur = pixooConfig();
  const next = { ...cur };
  if ('ip' in patch) {
    const clean = String(patch.ip || '').trim();
    if (clean && !isValidDeviceIp(clean)) throw new Error('Pixoo address must be a private IPv4 address, e.g. 192.168.1.50');
    next.ip = clean;
  }
  if ('enabled' in patch) next.enabled = !!patch.enabled;
  if ('look' in patch) next.look = Math.min(100, Math.max(0, Math.round(Number(patch.look) || 0)));
  if ('brightness' in patch) next.brightness = Math.min(100, Math.max(0, Math.round(Number(patch.brightness) || 0)));
  if ('minIntervalSec' in patch) next.minIntervalSec = cleanInterval(patch.minIntervalSec);
  if (next.enabled && !next.ip) throw new Error('Enter the Pixoo\'s IP address first (shown in the Divoom app)');
  savePetConfig({ pixoo: next });
  // A change you just made to what the display shows goes out now, not after the interval. Changing only the
  // interval doesn't touch the display.
  const visible = ['enabled', 'ip', 'look', 'brightness'].some((k) => next[k] !== cur[k]);
  if (visible) { pixoo.lastSig = null; pixoo.force = true; }
  setPixooStatus(next.enabled ? (visible ? 'connecting\u2026' : pixoo.status) : 'off');
  schedulePixooSync(visible ? 0 : 300);
  return { ...next, status: pixoo.status };
});

// --- Corner window views: Pet · Grid · Speaker · Presenter ---
const CORNER_VIEWS = ['pet', 'grid', 'speaker', 'presenter', 'chat'];
const CORNER_MIN = { w: 200, h: 200 }, CORNER_MAX = { w: 560, h: 700 };
let cornerView = 'pet';   // restored from the config in initPets() — app.setName() hasn't run yet at module load

// The pet window is normally unfocusable (it never steals keystrokes). The chat view needs the keyboard.
function applyChatFocus() {
  if (!win || win.isDestroyed()) return;
  const chat = cornerView === 'chat';
  win.setFocusable(chat);
  if (chat) win.focus();
}

function setCornerView(v, from) {
  if (!CORNER_VIEWS.includes(v)) return;
  cornerView = v;
  savePetConfig({ cornerView: v });
  applyChatFocus();
  if (win && !win.isDestroyed() && win.webContents !== from) win.webContents.send('corner-view', v);
  if (dashWin && !dashWin.isDestroyed()) dashWin.webContents.send('corner-view', v);
  refreshMenus();
}

// Resize the corner window to fit its content, keeping whichever screen corner it is nearest to
// fixed — so a window parked bottom-left grows up and to the right.
function resizeCorner(w, h) {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const next = computeCornerBounds(b, screen.getDisplayMatching(b).workArea, w, h, { min: CORNER_MIN, max: CORNER_MAX });
  if (next.width !== b.width || next.height !== b.height || next.x !== b.x || next.y !== b.y) win.setBounds(next);
}

// --- Euphonia: the user's personal assistant, chatted with from the pet window ---
let euphonia = null;
registerEuphoniaIpc({
  ipcMain,
  getPetWebContents: () => (win && !win.isDestroyed() ? win.webContents : null),
  getSenders: () => (dashWin && !dashWin.isDestroyed() ? [dashWin.webContents] : []),
  getService: () => (euphonia = euphonia || createEuphonia({ home: process.env.EUPHONIA_HOME || undefined, hubDir: process.env.EUPHONIA_HUB || undefined })),
  peonDir: () => peonSound.peonDir(),
  listPacks: () => peonPacks.listPacks(),
  isMuted: () => soundMuted || peonSound.isMuted(),
  getVolume: () => peonPacks.getPackState().volume,
});

ipcMain.on('corner-set-view', (e, v) => setCornerView(v, e.sender));
ipcMain.handle('corner-get', () => cornerView);
ipcMain.on('corner-resize', (e, size) => { if (win && e.sender === win.webContents && size) resizeCorner(size.w, size.h); });

const cornerMenu = () => ({
  label: 'Corner view',
  submenu: CORNER_VIEWS.map((v) => ({ label: v[0].toUpperCase() + v.slice(1), type: 'radio', checked: v === cornerView, click: () => setCornerView(v) })),
});


// --- Desktop army: one small always-on-top window per root agent ---
const armyWins = new Map();   // agent id → BrowserWindow
let armyOn = false;           // restored from the config in initPets()

function armyRoots() {
  return (latestSessions.sessions || []).filter((a) => a.isRoot !== false && (a.hot || a.warm || a.role === 'master')).map((a) => a.id);
}

function openArmyWindow(id, index) {
  const area = screen.getPrimaryDisplay().workArea;
  const saved = (loadPetConfig().armyPos || {})[id];
  const { x, y } = saved ? clampToArea(saved, area) : armyPosition(index, area);
  const w = new BrowserWindow({
    width: ARMY_SIZE.w, height: ARMY_SIZE.h, x, y,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false, focusable: false,
    webPreferences: { preload: path.join(__dirname, 'grid', 'army-preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  w.setAlwaysOnTop(true, 'floating');
  w.loadFile('grid/army.html', { query: { id } });
  w.on('moved', () => { const b = w.getBounds(); savePetConfig({ armyPos: { ...(loadPetConfig().armyPos || {}), [id]: { x: b.x, y: b.y } } }); });
  w.on('closed', () => { if (armyWins.get(id) === w) armyWins.delete(id); });
  armyWins.set(id, w);
}

function syncArmy() {
  const plan = planArmy(armyOn ? armyRoots() : [], [...armyWins.keys()]);
  for (const id of plan.close) { const w = armyWins.get(id); armyWins.delete(id); if (w && !w.isDestroyed()) w.destroy(); }
  let i = armyWins.size;
  for (const id of plan.open) openArmyWindow(id, i++);
}

function setArmy(on) {
  armyOn = !!on;
  savePetConfig({ army: armyOn });
  syncArmy();
  refreshMenus();
}

const armyMenuItem = () => ({ label: 'Desktop army (one window per agent)', type: 'checkbox', checked: armyOn, click: (item) => setArmy(item.checked) });

// --- Master sound toggle (peon-ping .paused) ---
let soundMuted = peonSound.isMuted();

function broadcastSoundState() {
  if (win && !win.isDestroyed()) win.webContents.send('sound-state', { muted: soundMuted });
  if (dashWin && !dashWin.isDestroyed()) dashWin.webContents.send('sound-state', { muted: soundMuted });
  refreshMenus();
}

async function setSoundMuted(muted) {
  soundMuted = await peonSound.setMuted(muted);
  broadcastSoundState();
}

function openDashboard() {
  if (dashWin && !dashWin.isDestroyed()) { dashWin.show(); dashWin.focus(); return; }
  dashWin = new BrowserWindow({
    width: 720,
    height: 520,
    minWidth: 520,
    minHeight: 320,
    title: 'Peon Pet — Control Panel',
    backgroundColor: '#12121c',
    webPreferences: {
      preload: path.join(__dirname, 'dashboard', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  dashWin.loadFile('dashboard/index.html');
  dashWin.on('closed', () => { dashWin = null; });
}

function openGrid(view) {
  if (gridWin && !gridWin.isDestroyed()) {
    gridWin.show(); gridWin.focus();
    if (typeof view === 'string') gridWin.webContents.send('grid-view', view);
    return;
  }
  gridWin = new BrowserWindow({
    width: 980, height: 700, minWidth: 360, minHeight: 280,
    title: 'Peon Pet — Agents', backgroundColor: '#0e0e16',
    webPreferences: { preload: path.join(__dirname, 'grid', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  gridWin.loadFile('grid/index.html');
  if (typeof view === 'string') gridWin.webContents.once('did-finish-load', () => gridWin.webContents.send('grid-view', view));
  gridWin.on('closed', () => { gridWin = null; });
}
ipcMain.on('open-grid', (_e, view) => openGrid(view));
ipcMain.on('grid-ready', (e) => e.sender.send('grid-sessions', latestSessions));

ipcMain.on('dash-ready', (e) => {
  e.sender.send('dash-sessions', latestSessions);
  e.sender.send('sound-state', { muted: soundMuted });
});
ipcMain.on('open-dashboard', openDashboard);

ipcMain.on('sound-toggle', () => { setSoundMuted(!soundMuted); });

// --- Voice packs ---
ipcMain.handle('packs-get', () => peonPacks.getPackState());

ipcMain.handle('packs-set-session', (_e, sessionId, name) => {
  if (!isValidSessionId(sessionId)) throw new Error('Invalid session');
  if (name) peonPacks.setSessionPacks([peonKey(sessionId)], name);
  else peonPacks.clearSessionPack(peonKey(sessionId));
  return peonPacks.getPackState();
});

ipcMain.handle('packs-set-volume', (_e, v) => { peonPacks.setVolume(v); return peonPacks.getPackState(); });
ipcMain.handle('packs-set-category', (_e, cat, on) => { peonPacks.setCategory(cat, on); return peonPacks.getPackState(); });
ipcMain.handle('packs-set-notifications', (_e, on) => { peonPacks.setDesktopNotifications(on); return peonPacks.getPackState(); });
ipcMain.handle('packs-audition', (_e, name) => { peonPacks.auditionPack(name); });

// Global override: new default_pack, and (optionally) re-pin every open session so it
// takes effect immediately instead of only for sessions that have no pin.
ipcMain.handle('packs-set-global', async (_e, name, applyToSessions) => {
  await peonPacks.setGlobalPack(name);
  if (applyToSessions) {
    const ids = tracker.entries().map(([id]) => peonKey(id));
    const pinned = Object.keys(peonPacks.getPackState().sessionPacks);
    peonPacks.setSessionPacks([...new Set([...ids, ...pinned])], name);
  }
  return peonPacks.getPackState();
});

// Pick up `peon toggle` / `/peon-ping-toggle` done outside the pet.
setInterval(() => {
  const muted = peonSound.isMuted();
  if (muted !== soundMuted) { soundMuted = muted; broadcastSoundState(); }
}, 2000);

// --- Drag state ---
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let ignoringMouse = true;  // tracks last setIgnoreMouseEvents value

ipcMain.on('drag-start', () => {
  if (!win || win.isDestroyed()) return;
  isDragging = true;
  const { x: cx, y: cy } = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  dragOffsetX = cx - wx;
  dragOffsetY = cy - wy;
  if (ignoringMouse) {
    win.setIgnoreMouseEvents(false);
    ignoringMouse = false;
  }
});

ipcMain.on('drag-stop', () => {
  isDragging = false;
});

// Poll cursor position to enable mouse events only when hovering the window.
// This lets the renderer receive mousemove for tooltips while keeping click-through.
// During drag, moves the window to follow the cursor.
function startMouseTrackingForWindow(targetWin) {
  const intervalId = setInterval(() => {
    if (!targetWin || targetWin.isDestroyed()) {
      clearInterval(intervalId);
      return;
    }
    const { x: cx, y: cy } = screen.getCursorScreenPoint();

    if (targetWin === win && isDragging) {
      const nx = cx - dragOffsetX;
      const ny = cy - dragOffsetY;
      const [wx, wy] = targetWin.getPosition();
      if (nx !== wx || ny !== wy) targetWin.setPosition(nx, ny);
      return;
    }

    const [wx, wy] = targetWin.getPosition();
    const [ww, wh] = targetWin.getSize();
    const inside = cx >= wx && cx <= wx + ww && cy >= wy && cy <= wy + wh;
    if (targetWin === win) {
      if (inside !== !ignoringMouse) {
        targetWin.setIgnoreMouseEvents(!inside);
        ignoringMouse = !inside;
      }
    } else {
      targetWin.setIgnoreMouseEvents(!inside);
    }
  }, 50);
}

function togglePet() {
  if (!win || win.isDestroyed()) return;
  const windows = [win, ...[...subAgentWindows.values()].filter((w) => !w.isDestroyed())];
  for (const w of windows) { if (petVisible) w.hide(); else w.show(); }
  petVisible = !petVisible;
  refreshMenus();
}

function refreshMenus() {
  if (process.platform === 'darwin') app.dock.setMenu(buildDockMenu());
  if (tray && !tray.isDestroyed()) tray.setTitle(soundMuted ? '\u{1F507}' : '');
}

function buildDockMenu() {
  return Menu.buildFromTemplate([
    { label: soundMuted ? 'Unmute Sounds' : 'Mute Sounds', click() { setSoundMuted(!soundMuted); } },
    { label: 'Open Control Panel', click: openDashboard },
    cornerMenu(),
    armyMenuItem(),
    { label: 'Open Agent Dashboard (big window)', click: () => openGrid() },
    { label: petVisible ? 'Hide Pet' : 'Show Pet', click: togglePet },
    { type: 'separator' },
    { label: 'Quit', click() { app.quit(); } },
  ]);
}

// --- Menu bar item ---
let tray = null;

function runMenuAction(fn) {
  Promise.resolve().then(fn).catch((e) => console.error('[menu]', e.message));
}

function buildTrayMenu() {
  const st = peonPacks.getPackState();
  const label = (name) => (st.packs.find((p) => p.name === name) || {}).display || name;
  const quick = [...new Set([st.defaultPack, ...st.rotation])].filter((n) => st.packs.some((p) => p.name === n));
  const px = pixooConfig();
  return Menu.buildFromTemplate([
    { label: 'Open Control Panel', click: openDashboard },
    cornerMenu(),
    armyMenuItem(),
    { label: 'Agent Dashboard (big window)', submenu: [
      { label: 'Grid', click: () => openGrid('grid') },
      { label: 'Speaker', click: () => openGrid('speaker') },
      { label: 'Presenter', click: () => openGrid('presenter') },
    ] },
    { type: 'separator' },
    { label: soundMuted ? 'Resume Sounds' : 'Silence All Sounds', click() { setSoundMuted(!soundMuted); } },
    {
      label: `Voice: ${label(st.defaultPack)}`,
      submenu: [
        ...quick.map((name) => ({
          label: label(name),
          type: 'radio',
          checked: name === st.defaultPack,
          click: () => runMenuAction(async () => {
            await peonPacks.setGlobalPack(name);
            const ids = new Set([...tracker.entries().map(([id]) => peonKey(id)), ...Object.keys(st.sessionPacks)]);
            peonPacks.setSessionPacks([...ids], name);
          }),
        })),
        { type: 'separator' },
        { label: 'More voices\u2026', click: openDashboard },
      ],
    },
    {
      label: `Volume: ${Math.round(st.volume * 100)}%`,
      submenu: [0, 25, 50, 75, 100].map((pct) => ({
        label: pct === 0 ? '0% (silent)' : `${pct}%`,
        type: 'radio',
        checked: Math.round(st.volume * 100) === pct,
        click: () => runMenuAction(() => peonPacks.setVolume(pct / 100)),
      })),
    },
    { type: 'separator' },
    {
      label: px.enabled ? `Pixoo 64: ${pixoo.status}` : 'Pixoo 64: off',
      click: openDashboard,
    },
    { label: petVisible ? 'Hide Desktop Pet' : 'Show Desktop Pet', click: togglePet },
    { type: 'separator' },
    { label: 'Quit Peon Pet', click() { app.quit(); } },
  ]);
}

function createTray() {
  try {
    const icon = nativeImage.createFromPath(resolveAsset('dock-icon.png')).resize({ width: 18, height: 18 });
    tray = new Tray(icon);
  } catch (e) {
    console.error('[tray] disabled:', e.message);
    return;
  }
  tray.setToolTip('Peon Pet');
  const pop = () => tray.popUpContextMenu(buildTrayMenu());
  tray.on('click', pop);
  tray.on('right-click', pop);
  refreshMenus();
}

const { WIN_SIZE, WIN_MARGIN, cornerPosition, restoreBounds } = require('./lib/window-position');
const { planArmy, armyPosition, clampToArea, ARMY_SIZE } = require('./lib/army');

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const cfg = loadPetConfig();
  const { x, y } = cornerPosition(cfg.corner, width, height);
  // Reopen where it was last left (dragged, or resized by a view change), if that spot is still on a display.
  const restored = restoreBounds(cfg.winBounds, screen.getAllDisplays().map((d) => d.workArea), { min: CORNER_MIN, max: CORNER_MAX });

  win = new BrowserWindow({
    width: restored ? restored.width : WIN_SIZE,
    height: restored ? restored.height : WIN_SIZE,
    x: restored ? restored.x : x,
    y: restored ? restored.y : y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Remember where it sits (debounced: a drag fires many moves).
  let saveBoundsTimer = null;
  const rememberBounds = () => {
    clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => { if (win && !win.isDestroyed()) savePetConfig({ winBounds: win.getBounds() }); }, 400);
  };
  win.on('move', rememberBounds);
  win.on('resize', rememberBounds);

  win.setIgnoreMouseEvents(true);

  win.loadFile('renderer/index.html');

  if (process.platform === 'darwin') {
    app.dock.setIcon(resolveAsset('dock-icon.png'));
    app.dock.setMenu(buildDockMenu());
  }

  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  // Reset drag if renderer reloads or crashes
  win.webContents.on('did-finish-load', () => {
    isDragging = false;
    win.webContents.send('sound-state', { muted: soundMuted });
    sendLook(win);
    win.webContents.send('corner-view', cornerView);
    applyChatFocus();
    win.webContents.send('frame-style', { id: loadPetConfig().border || 'default' });
  });

  // Clean up sub-agent windows when main window closes
  win.on('closed', () => {
    for (const subWin of subAgentWindows.values()) {
      if (!subWin.isDestroyed()) subWin.destroy();
    }
    subAgentWindows.clear();
  });

  // Start polling once window is ready
  win.webContents.once('did-finish-load', () => {
    startPolling();
    startMouseTrackingForWindow(win);
    if (pixooConfig().enabled) schedulePixooSync(0);

    // Dev-only: spawn dummy sub-agents for visual testing
    if (process.argv.includes('--spawn-test')) {
      const dummyIds = ['dummy-1', 'dummy-2', 'dummy-3'];
      for (const id of dummyIds) {
        dummySessionIds.add(id);
        createSubAgentWindow(id);
      }
      setTimeout(() => {
        for (const id of dummyIds) {
          dummySessionIds.delete(id);
          destroySubAgentWindow(id);
        }
      }, 3000);
    }
  });
}

// --- Hot reload: pick up code changes without a manual restart ---
const RELOAD_EXIT_CODE = 75;  // non-zero so launchd's KeepAlive.SuccessfulExit=false restarts us
const underLaunchd = process.env.XPC_SERVICE_NAME === 'com.peonpet.app';

function restartApp() {
  if (underLaunchd) app.exit(RELOAD_EXIT_CODE);
  else { app.relaunch(); app.exit(0); }
}

function startHotReload() {
  if (process.argv.includes('--no-reload')) return;
  try {
    watchApp(__dirname, (kind, file) => {
      console.log(`[hot-reload] ${file} changed → ${kind}`);
      if (kind === 'app') return restartApp();
      // Sub-agent windows get their config once at load; they're transient, so drop them.
      for (const id of [...subAgentWindows.keys()]) destroySubAgentWindow(id);
      for (const w of [win, dashWin, gridWin]) {
        if (w && !w.isDestroyed()) w.webContents.reloadIgnoringCache();
      }
    });
  } catch (e) {
    console.error('[hot-reload] disabled:', e.message);
  }
}

app.setName('Peon Pet');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    initPets();
    registerCharacterProtocol();
    createWindow();
    createTray();
    startHotReload();
  });
  app.on('window-all-closed', () => app.quit());
}
