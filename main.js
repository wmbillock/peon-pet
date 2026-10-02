const { app, BrowserWindow, screen, Menu, Tray, nativeImage, protocol, net, ipcMain } = require('electron');
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
const { listCharacters, isKnownCharacter } = require('./lib/characters');
const { watchApp } = require('./lib/hot-reload');
const { PixooClient, isValidDeviceIp, applyLook, drawDots } = require('./lib/pixoo');
const { buildAnimFrames } = require('./lib/pixoo-frames');

let win;
let petVisible = true;
let dashWin = null;
let latestSessions = { sessions: [] };
const subAgentWindows = new Map(); // session_id → BrowserWindow
const subAgentCreatedAt = new Map(); // session_id → creation timestamp (ms)
const dummySessionIds = new Set(); // dev-only: protected from sync cleanup
const MAX_SUB_AGENT_WINDOWS = 5;
const SUB_AGENT_BASE_Y_OFFSET = 170; // px from bottom of work area to main pet
const SUB_AGENT_TTL_MS = 10 * 60 * 1000; // 10 min — destroy stale windows if SubagentStop never fired

// --- Character system ---
// Per-character asset maps: canonical name → bundled filename
const BUNDLED_CHARS = {
  orc: {
    'sprite-atlas.png': 'orc-sprite-atlas.png',
    'borders.png':      'orc-borders.png',
    'bg.png':           'bg-pixel.png',
    'dock-icon.png':    'orc-dock-icon.png',
  },
  capybara: {
    'sprite-atlas.png': 'capybara-sprite-atlas.png',
    'borders.png':      'capybara-borders.png',
    'dock-icon.png':    'capybara-dock-icon.png',
  },
  'hello-kitty': {
    'sprite-atlas.png': 'hello-kitty-sprite-atlas.png',
    'borders.png':      'hello-kitty-borders.png',
    'dock-icon.png':    'hello-kitty-dock-icon.png',
  },
};

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

let activeChar = 'orc';
const bundledAssetsDir = path.join(__dirname, 'renderer', 'assets');
const customCharRoot = () => path.join(app.getPath('userData'), 'characters');

// 1. User-installed character dir, 2. bundled map: char-specific → orc fallback → filename as-is
function resolveAsset(filename) {
  const custom = path.join(customCharRoot(), activeChar, filename);
  if (fs.existsSync(custom)) return custom;
  const charMap = BUNDLED_CHARS[activeChar] || {};
  return path.join(bundledAssetsDir, charMap[filename] || BUNDLED_CHARS.orc[filename] || filename);
}

function registerCharacterProtocol() {
  activeChar = argCharacter || loadPetConfig().character || 'orc';
  protocol.handle('peon-asset', (request) => {
    const filename = new URL(request.url).hostname;
    return net.fetch('file://' + resolveAsset(filename));
  });
}

function characterList() { return listCharacters(Object.keys(BUNDLED_CHARS), customCharRoot()); }

function charThumb(name) {
  const prev = activeChar;
  activeChar = name;
  try { return nativeImage.createFromPath(resolveAsset('dock-icon.png')).resize({ width: 56, height: 56 }).toDataURL(); }
  catch { return null; }
  finally { activeChar = prev; }
}

function applyCharacterIcons() {
  if (process.platform === 'darwin') app.dock.setIcon(resolveAsset('dock-icon.png'));
  if (tray && !tray.isDestroyed()) {
    tray.setImage(nativeImage.createFromPath(resolveAsset('dock-icon.png')).resize({ width: 18, height: 18 }));
  }
}

ipcMain.handle('chars-get', () => ({
  active: activeChar,
  chars: characterList().map((c) => ({ ...c, thumb: charThumb(c.name) })),
}));

// Live-switch the pet: no restart needed.
ipcMain.handle('chars-set', (_e, name) => {
  if (!isKnownCharacter(name, characterList())) throw new Error(`Unknown pet: ${name}`);
  activeChar = name;
  savePetConfig({ character: name });
  pixooFrameCache.clear();
  pixoo.lastSig = null;
  applyCharacterIcons();
  for (const id of [...subAgentWindows.keys()]) destroySubAgentWindow(id);
  if (win && !win.isDestroyed()) win.webContents.reloadIgnoringCache();
  schedulePixooSync(0);
  return name;
});

const tracker = createSessionTracker();
const sessionCwds = new Map();  // session_id → cwd string
const sessionAgents = new Map();  // session_id → 'claude' | 'codex'

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

function createSubAgentWindow(sessionId) {
  if (subAgentWindows.size >= MAX_SUB_AGENT_WINDOWS) return;
  if (subAgentWindows.has(sessionId)) return;

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

  subWin.loadFile('renderer/index.html');

  subWin.webContents.once('did-finish-load', () => {
    subWin.webContents.send('peon-config', { size: 100, subAgent: true });
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

function handleSessionEvent({ sessionId, event, cwd, timestamp, agent }) {
  if (!isValidSessionId(sessionId)) return;
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

  tracker.prune(now - SESSION_PRUNE_MS);
  for (const id of sessionCwds.keys()) {
    if (!tracker.entries().some(([sid]) => sid === id)) { sessionCwds.delete(id); sessionAgents.delete(id); }
  }

  sendSessionUpdate(now);

  const anim = EVENT_TO_ANIM[event];
  if (anim && win && !win.isDestroyed()) {
    win.webContents.send('peon-event', { anim, event });
  }
}

function sendSessionUpdate(now) {
  const sessions = buildSessionStates(tracker.entries(), now, HOT_MS, WARM_MS, 10);
  const times = new Map(tracker.entries());
  const payload = {
    sessions: sessions.map(s => ({
      ...s,
      lastActive: times.get(s.id),
      cwd: sessionCwds.get(s.id) || null,
      name: sessionCwds.get(s.id) ? path.basename(sessionCwds.get(s.id)) : null,
      agent: sessionAgents.get(s.id) || 'claude',
      peonKey: peonKey(s.id),
    })),
  };
  latestSessions = payload;
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
    w.on('subagent-event', ({ parentToolId, event }) => {
      if (event === 'SubagentStart') createSubAgentWindow(parentToolId);
      if (event === 'SubagentStop')  destroySubAgentWindow(parentToolId);
    });
    w.start();
  }

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
    sendSessionUpdate(now);
  }, 5000);

  // Remote relay sync (less frequent, not time-critical)
  setInterval(async () => {
    syncRemoteSessionsToTracker(await readRemoteState(remoteUrl));
  }, 5000);
}

// --- Pixoo 64 mirror ---
// Pushes the pet's current animation (plus session dots) to a Divoom Pixoo 64 on the LAN.
const pixoo = { client: null, status: 'off', lastSig: null, busy: false, dirty: false, timer: null };
const pixooFrameCache = new Map();  // anim → { frames, speedMs }
let petAnim = 'sleeping';

function pixooConfig() {
  const c = loadPetConfig().pixoo || {};
  return {
    enabled: !!c.enabled,
    ip: c.ip || '',
    look: Number.isFinite(c.look) ? c.look : 60,
    brightness: Number.isFinite(c.brightness) ? c.brightness : null,  // null = leave the device alone
  };
}

function setPixooStatus(status) {
  if (status !== pixoo.status) console.log(`[pixoo] ${status}`);
  pixoo.status = status;
  if (dashWin && !dashWin.isDestroyed()) dashWin.webContents.send('pixoo-state', { ...pixooConfig(), status });
}

function pixooAnimFrames(anim) {
  if (!pixooFrameCache.has(anim)) {
    pixooFrameCache.set(anim, buildAnimFrames(nativeImage, resolveAsset('sprite-atlas.png'), anim));
  }
  return pixooFrameCache.get(anim);
}

function schedulePixooSync(delayMs = 300) {
  clearTimeout(pixoo.timer);
  pixoo.timer = setTimeout(runPixooSync, delayMs);
}

async function runPixooSync() {
  const { enabled, ip, look, brightness } = pixooConfig();
  if (!enabled || !ip) { pixoo.client = null; setPixooStatus('off'); return; }
  if (pixoo.busy) { pixoo.dirty = true; return; }
  pixoo.busy = true;
  try {
    if (!pixoo.client || pixoo.client.ip !== ip) { pixoo.client = new PixooClient(ip); pixoo.lastSig = null; }
    const sessions = latestSessions.sessions || [];
    const sig = `${petAnim}|${look}|${brightness}|${sessions.map((s) => (s.hot ? 2 : s.warm ? 1 : 0)).join('')}`;
    if (sig !== pixoo.lastSig) {
      const { frames, speedMs } = pixooAnimFrames(petAnim);
      if (brightness !== null) await pixoo.client.setBrightness(brightness);
      await pixoo.client.showAnimation(frames.map((f) => drawDots(applyLook(f, look), sessions)), speedMs);
      pixoo.lastSig = sig;
    }
    setPixooStatus('connected');
  } catch (e) {
    pixoo.lastSig = null;
    setPixooStatus(`error: ${e.message}`);
    schedulePixooSync(15000);  // device asleep / wrong IP: retry quietly
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
  if (next.enabled && !next.ip) throw new Error('Enter the Pixoo\'s IP address first (shown in the Divoom app)');
  savePetConfig({ pixoo: next });
  pixoo.lastSig = null;
  setPixooStatus(next.enabled ? 'connecting\u2026' : 'off');
  schedulePixooSync(0);
  return { ...next, status: pixoo.status };
});

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

const { WIN_SIZE, WIN_MARGIN, cornerPosition } = require('./lib/window-position');

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const cfg = loadPetConfig();
  const { x, y } = cornerPosition(cfg.corner, width, height);

  win = new BrowserWindow({
    width: WIN_SIZE,
    height: WIN_SIZE,
    x,
    y,
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
      for (const w of [win, dashWin]) {
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
    registerCharacterProtocol();
    createWindow();
    createTray();
    startHotReload();
  });
  app.on('window-all-closed', () => app.quit());
}
