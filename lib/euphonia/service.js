'use strict';
// Euphonia core: transport-independent. The pet window is one view onto it; Slack can be another.
// ONE long-lived Claude Code CLI process carries the conversation (stream-json in and out, stdin held open); each
// user message is one line on its stdin and the `result` event ends the turn. The process is restarted (with
// --resume) when what it was started with must change: the tool allowlist (grants), the static system prompt, the
// model, or the session. If the CLI rejects the streaming input flag, or the process has died, a turn falls back to
// the older shape: one `claude -p` per message with the text on stdin.
// Events (subscribe): start | delta | tool | done | error | notice | card | denied | user-tool, each tagged with the turn id.
const { findClaude, childPath } = require('./find-claude');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { buildToolPolicy } = require('./authority');
const { createStreamParser } = require('./stream');
const { seedKb } = require('./kb');
const { DEFAULT_PACK, PACK_RE } = require('./voice');
const { DEFAULT_SPECIES } = require('./launch');
const { createGrantStore } = require('./grants');
const { computeMcpAccess, renderAccessBlock } = require('./access');
const { classifyTool, splitMcpName } = require('./tool-class');
const { discoverMcpServers } = require('./mcp-discovery');
const { readManagedPolicy } = require('./managed-policy');
const { hookSettings, validHost, DEFAULT_BROWSER_HOSTS } = require('./browser-guard');
const { SERVER: BRIDGE_SERVER } = require('./bridge/tools');
const { createActionEngine, renderReceipts } = require('./actions');
const { createTools, createRunner } = require('./bridge/tools');
const { createFirmHttp } = require('./bridge/firm-http');
const { createGhRunner } = require('./bridge/gh');
const { createAudit } = require('./bridge/audit');
const { applyCosmetics } = require('./bridge/cosmetics');

const SPECIES_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DEFAULT_CONFIG = { name: 'Euphonia', soundPack: DEFAULT_PACK, species: DEFAULT_SPECIES, border: 'neon-cyan', openChatOnLaunch: false, model: null, restricted: true, browserHosts: DEFAULT_BROWSER_HOSTS, displayName: null, pronouns: null, transport: 'persistent' };
const PROMPT_FILE = path.join(__dirname, 'prompt.md');
const TURN_TIMEOUT_MS = 5 * 60 * 1000;
const INIT_WAIT_MS = 4000;        // how long the first turn of a process waits for the CLI's init event before sending
const STOP_WAIT_MS = 3000;        // graceful end of stdin before the process is killed
const IDENTITY_MAX = 12000;       // characters of kb/identity.md appended to the system prompt
const OWNER_FALLBACK = 'the owner';
const TRANSPORTS = ['persistent', 'per-turn'];

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// The OS login is used ONLY to pick the home directory. The person is addressed by displayName (config.json), never by the login.
function defaultUser() { try { return os.userInfo().username; } catch { return 'user'; } }

function renderPrompt(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, k) => (k in vars ? vars[k] : ''));
}

// The exact argv for one CLI process. Pure, so tests can read it. `persistent` adds the streaming-input flag; the user message
// never travels in argv (stdin in both shapes), so variadic flags cannot swallow it and a message starting with `-` is harmless.
function buildArgs({ policy, prompt, sessionId, model, restricted, settings, persistent = false }) {   // --system-prompt-snapshot off: the prompt is rendered on every request, so a restarted process carries the current text
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
  if (persistent) args.push('--input-format', 'stream-json');
  args.push('--append-system-prompt', prompt, '--system-prompt-snapshot', 'off',
    '--permission-mode', policy.permissionMode,
    '--tools', policy.tools.join(','),
    '--allowedTools', policy.allowedTools.join(','),
    '--disallowedTools', policy.disallowedTools.join(','),
    '--disable-slash-commands');   // no --strict-mcp-config: refused where an enterprise MCP config exists
  if (settings) args.push('--settings', JSON.stringify(settings));   // the browser host guard hook; --settings applies even under --restricted
  for (const d of policy.addDirs) args.push('--add-dir', d);
  if (restricted) args.push('--restricted');
  if (model) args.push('--model', model);
  if (sessionId) args.push('--resume', sessionId);
  return args;
}

// One user turn as the CLI's stream-json input expects it.
const userLine = (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n';

// Environment for the CLI child. PATH: see find-claude. MCP_TIMEOUT: the CLI gives each MCP server 30 s to start; with
// twenty managed servers starting at once on a busy machine, the npx-launched ones (Playwright) miss that and show
// "timed out after 30000ms". Two minutes, unless the launcher already set a value.
function childEnv(bin, env = process.env) {
  return { ...env, PATH: childPath(bin, env), MCP_TIMEOUT: env.MCP_TIMEOUT || String(MCP_STARTUP_MS) };
}
const MCP_STARTUP_MS = 120000;

// Make a rejected flag diagnosable from the chat banner: the CLI's own words plus the flag and the next step.
function explainCliError(msg) {
  const flag = (msg.match(/(--[a-z][a-z-]+)/) || [])[1];
  if (!flag || !/cannot use|unknown option|invalid|not allowed|refus|unsupported|requires/i.test(msg)) return msg;
  const next = flag === '--restricted' ? ' Next: set "restricted": false in Euphonia\'s config.json and retry.'
    : ` Next: the CLI rejected ${flag}; report this message so the flag can be removed from lib/euphonia/service.js buildArgs.`;
  return `${msg} [flag: ${flag}]${next}`;
}
// Did the CLI refuse the streaming-input shape itself? Then fall back to one process per turn.
const STREAM_INPUT_REFUSED = /--input-format|input-format|stream-json/i;

// The per-turn header the app puts at the top of every message to the model: the live access block, MCP connection
// state for granted servers, recent send receipts. Kept out of the system prompt so the long-lived process need not restart
// when any of it changes.
function renderTurnHeader({ access, mcpNotes = [], receipts = '', text }) {
  const parts = ['[Current access for this turn, written by the app; the whole truth about your tools now]', access];
  if (mcpNotes.length) parts.push(...mcpNotes.map((n) => `- ${n}`));
  if (receipts) parts.push('', '[Recent sends through your approval cards, last 24 h, from the app\'s receipt log]', receipts);
  parts.push('', '[Message]', text);
  return parts.join('\n');
}

function createEuphonia({
  home,
  hubDir = path.join(os.homedir(), 'Claude'),
  user = defaultUser(),
  claudeBin = null,   // null: find it at spawn time (launchd's PATH is minimal)
  spawnImpl = spawn,
  now = () => new Date(),
  timeoutMs = TURN_TIMEOUT_MS,
  initWaitMs = INIT_WAIT_MS,
  stopWaitMs = STOP_WAIT_MS,
  promptTemplate,
  discover = discoverMcpServers,
  managedPolicy = readManagedPolicy,   // () => { ask, deny } from the machine's managed settings; tests pass a stub
  firmUrl,
  assetsDir,
  userDataDir,
  peonDir,
  bridge = true,
  actionDeps = null,   // tests inject { firm, ghRun, cosmetics }
} = {}) {
  if (!home) home = path.join(os.homedir(), '.euphonia', user);
  const files = {
    session: path.join(home, 'session.json'),
    transcript: path.join(home, 'transcript.jsonl'),
    config: path.join(home, 'config.json'),
    read: path.join(home, 'read.json'),
    grants: path.join(home, 'grants.json'),
    catalog: path.join(home, 'tools-seen.json'),
    cards: path.join(home, 'cards.json'),
    audit: path.join(home, 'bridge-audit.jsonl'),
    mcpStatus: path.join(home, 'mcp-status.json'),
  };
  const kbDir = path.join(home, 'kb');
  const identityFile = path.join(kbDir, 'identity.md');
  const sentFile = path.join(kbDir, 'firm', 'sent.jsonl');
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });

  const getConfig = () => ({ ...DEFAULT_CONFIG, ...readJson(files.config, {}) });
  const ownerName = (cfg = getConfig()) => (cfg.displayName && String(cfg.displayName).trim()) || OWNER_FALLBACK;
  seedKb(kbDir, { user: ownerName(), now: now() });

  const grants = createGrantStore({ file: files.grants, now });

  // Tools and MCP servers the CLI itself reported on past turns. Learned from the init event, so no extra provider call.
  const readCatalog = () => {
    const c = readJson(files.catalog, null);
    const cat = c && c.servers ? c : { servers: {} };
    return cat;
  };
  function learnCatalog(init) {
    const names = init.mcpServers.map((m) => m.name);
    const cat = readCatalog();
    for (const m of init.mcpServers) cat.servers[m.name] = { status: m.status, tools: (cat.servers[m.name] && cat.servers[m.name].tools) || [] };
    const byServer = {};
    for (const t of init.tools.filter((x) => x.startsWith('mcp__'))) {
      const { server, tool } = splitMcpName(t, names);
      if (server && tool) (byServer[server] = byServer[server] || []).push(tool);
    }
    for (const [srv, tools] of Object.entries(byServer)) cat.servers[srv] = { ...(cat.servers[srv] || {}), tools: [...new Set(tools)].sort() };
    cat.updated = now().toISOString();
    writeJsonAtomic(files.catalog, cat);
  }
  // Connection state of every MCP server at the CLI's last init, per process. `launch` is this app run; a record from an
  // earlier run is still shown, marked as such, until the current process reports.
  const launchId = `${now().getTime()}-${process.pid}`;
  const readMcpStatus = () => readJson(files.mcpStatus, null);
  function recordMcpStatus(init, procNo) {
    const servers = {};
    for (const m of init.mcpServers) servers[m.name] = { status: m.status || 'unknown', tools: init.tools.filter((t) => t.startsWith(`mcp__${m.name}__`)).length };
    writeJsonAtomic(files.mcpStatus, { updated: now().toISOString(), launch: launchId, process: procNo, servers });
  }
  // Server list for the dashboard and the per-server denies: configured in files, plus those the CLI reported.
  const discoverServers = () => {
    const found = discover({ cwd: home, seen: readCatalog().servers });
    found.servers = found.servers.filter((x) => x.name !== BRIDGE_SERVER);
    // euphonia-bridge is a capability the APP performs for her (actions.js), not an MCP server; it gets a row so grants stay per capability.
    if (bridge) found.servers = [...found.servers, { name: BRIDGE_SERVER, sources: ['built-in action'], status: null }].sort((x, y) => x.name.localeCompare(y.name));
    return found;
  };
  // Everything the model is told and allowed this turn, recomputed from the active grants every time.
  function accessNow() {
    const active = grants.list();
    const found = discoverServers();
    const real = found.servers.map((x) => x.name).filter((n) => n !== BRIDGE_SERVER);
    let managed = null;
    try { managed = managedPolicy(); } catch { /* unreadable policy: compute as before; the CLI still enforces it */ }
    const mcp = computeMcpAccess({ grants: active.filter((g) => g.server !== BRIDGE_SERVER), catalog: readCatalog(), configured: real, managed });
    const cap = active.find((g) => g.server === BRIDGE_SERVER);
    if (cap) mcp.summary.push({ server: BRIDGE_SERVER, level: cap.level, expires_at: cap.expires_at, action: true, names: engineNames(cap.level) });
    return { active, mcp };
  }
  // Granted servers that the CLI did not report as connected: said in the header so she reports it instead of guessing.
  function mcpNotes(summary) {
    const st = readMcpStatus();
    const notes = [];
    for (const s of summary) {
      if (s.action) continue;
      const rec = st && st.servers && st.servers[s.server];
      if (!st) { notes.push(`${s.server}: held: connection state unknown (the CLI has not reported its MCP servers since launch); say so if a call fails.`); continue; }
      const stale = st.launch !== launchId ? ' (as of the previous launch; this process has not reported yet)' : '';
      if (!rec) notes.push(`${s.server}: held: not reported by the CLI at its last start${stale}; its tools are not callable until it appears.`);
      else if (rec.status !== 'connected') notes.push(`${s.server}: held: still connecting (CLI reported "${rec.status}"${stale}); a call now will fail, say so rather than guessing.`);
      else if (!rec.tools) notes.push(`${s.server}: connected but no tools catalogued yet${stale}; ask again after this reply if a tool is missing.`);
    }
    return notes;
  }

  const listeners = new Set();
  const emit = (ev) => { for (const fn of [...listeners]) { try { fn(ev); } catch { /* a bad listener must not break the turn */ } } };
  let counter = 0;
  let tail = Promise.resolve();
  const turnMeta = new Map();   // turnId -> { origin, hops }
  const inflight = new Set();   // action handling still running (read executions, follow-ups)

  // Actions the app performs for her. Dependencies are lazy so a bad Firm URL only fails the call that needs it.
  const lazy = (make) => { let v; return new Proxy({}, { get: (_t, k) => (...a) => (v = v || make())[k](...a) }); };
  const deps = actionDeps || {
    firm: lazy(() => createFirmHttp({ baseUrl: typeof firmUrl === 'function' ? firmUrl() : firmUrl || undefined })),
    ghRun: createGhRunner(),
    cosmetics: (patch) => applyCosmetics({ patch, configFile: files.config, peonDir: peonDir || path.join(os.homedir(), '.claude', 'hooks', 'peon-ping'), assetsDir, userDataDir }),
  };
  const defs = createTools(deps);
  const audit = createAudit({ file: files.audit, now });
  const run = createRunner({ defs, readGrants: () => grants.list(), audit, now: () => now().getTime() });
  const engine = createActionEngine({
    defs, run, grants, audit, cardsFile: files.cards, sentFile, now: () => now().getTime(), emit: (ev) => emit(ev),
    sendFollowUp: (text, { hops }) => { try { send(text, { origin: 'tool', hops }); } catch { /* an empty result is not worth a turn */ } },
  });
  const engineNames = (level) => defs.filter((d) => level === 'write' || d.class === 'read').map((d) => (d.class === 'write' ? `${d.name} (needs the user's approval card)` : d.name));
  const unfinished = [];   // turn ids accepted but not yet finished, oldest first: [running, ...queued]

  const shortText = (v, max) => { const s = String(v == null ? '' : v).replace(/[\r\n\0]/g, ' ').trim().slice(0, max); return s || null; };
  function setConfig(patch = {}) {
    const next = getConfig();
    if ('soundPack' in patch) {
      if (patch.soundPack === null || patch.soundPack === '') next.soundPack = null;   // no voice
      else if (!PACK_RE.test(String(patch.soundPack))) throw new Error('Invalid sound pack name');
      else next.soundPack = String(patch.soundPack);
    }
    if ('name' in patch) {
      const n = String(patch.name == null ? '' : patch.name).trim().slice(0, 32);
      if (!n) throw new Error('Name cannot be empty');
      next.name = n;
    }
    if ('displayName' in patch) next.displayName = shortText(patch.displayName, 64);   // how she addresses the owner; empty = "the owner"
    if ('pronouns' in patch) next.pronouns = shortText(patch.pronouns, 32);
    if ('species' in patch) {
      if (!SPECIES_RE.test(String(patch.species))) throw new Error('Invalid species');
      next.species = String(patch.species);
    }
    if ('border' in patch) {
      if (!/^[a-z0-9-]{1,32}$/.test(String(patch.border))) throw new Error('Invalid border');
      next.border = String(patch.border);
    }
    if ('openChatOnLaunch' in patch) next.openChatOnLaunch = !!patch.openChatOnLaunch;
    if ('model' in patch) next.model = patch.model ? String(patch.model) : null;
    if ('transport' in patch) { if (!TRANSPORTS.includes(patch.transport)) throw new Error(`transport must be one of ${TRANSPORTS.join(', ')}`); next.transport = patch.transport; }
    if ('browserHosts' in patch) {
      const hosts = Array.isArray(patch.browserHosts) ? patch.browserHosts.map((h) => String(h).trim()).filter(Boolean) : null;
      if (!hosts || hosts.length > 50 || !hosts.every(validHost)) throw new Error('browserHosts must be a list of hosts (e.g. localhost, 127.0.0.1, *.affirm.com)');
      next.browserHosts = [...new Set(hosts)];
    }
    writeJsonAtomic(files.config, next);
    return next;
  }
  // Last assistant message the user has seen in the chat window; persisted so a relaunch neither shows a stale dot nor loses a real one.
  const getReadMarker = () => readJson(files.read, null);
  const setReadMarker = (m) => { if (m && m.ts) writeJsonAtomic(files.read, { ts: String(m.ts), id: m.id || null }); };
  const getSession = () => readJson(files.session, null);
  const append = (rec) => fs.appendFileSync(files.transcript, JSON.stringify(rec) + '\n', { mode: 0o600 });

  function history(limit = 50) {
    let text = '';
    try { text = fs.readFileSync(files.transcript, 'utf8'); } catch { return []; }
    const out = [];
    for (const l of text.split('\n')) { if (!l) continue; try { out.push(JSON.parse(l)); } catch { /* skip a torn line */ } }
    return out.slice(-limit);
  }

  // The static system prompt: the template, then kb/identity.md verbatim when it exists (the owner edits personality there).
  function systemPrompt(cfg) {
    const template = promptTemplate || fs.readFileSync(PROMPT_FILE, 'utf8');
    const owner = ownerName(cfg);
    const pronouns = cfg.pronouns ? String(cfg.pronouns) : '';
    let prompt = renderPrompt(template, {
      user: owner, pronouns, pronouns_note: pronouns ? ` (pronouns: ${pronouns})` : '', name: cfg.name, kb: kbDir, hub: hubDir,
      access: 'The app writes the live "Current access" block at the top of EVERY message you receive; read it there. It is the whole truth about your tools for that turn.',
    });
    let identity = null;
    try { identity = fs.readFileSync(identityFile, 'utf8'); } catch { /* none yet */ }
    if (identity && identity.trim()) prompt += `\n\n## Identity and personality (from ${identityFile}, edited by ${owner}; follow it)\n${identity.trim().slice(0, IDENTITY_MAX)}\n`;
    return prompt;
  }

  // Start over without deleting anything: the old session file is kept beside the new one. The live process ends with it.
  function resetSession() {   // (defined after `append`)
    if (!fs.existsSync(files.session)) return false;
    fs.renameSync(files.session, path.join(home, `session.${now().getTime()}.old.json`));
    append({ ts: now().toISOString(), role: 'system', origin: 'user', text: 'new conversation' });   // marks where the visible conversation restarts
    stopProc().catch(() => {});
    return true;
  }

  // ---- the CLI process ----
  // proc: { child, key, no, persistent, exited, code, stderr, buf, turn, initSeen, waitInit }
  let proc = null;
  let procCount = 0;
  let streamInputOk = true;   // flipped off for this app run when the CLI rejects --input-format
  const transportOf = (cfg) => (cfg.transport === 'per-turn' || !streamInputOk ? 'per-turn' : 'persistent');

  function spawnProc({ args, key, persistent }) {
    const no = ++procCount;
    const bin = claudeBin || findClaude() || 'claude';
    const child = spawnImpl(bin, args, { cwd: home, env: childEnv(bin), stdio: ['pipe', 'pipe', 'pipe'] });
    const p = { child, key, no, persistent, exited: false, code: null, stderr: '', buf: '', turn: null, initSeen: false, waitInit: null, initResolve: null, onExit: new Set() };
    p.waitInit = new Promise((r) => { p.initResolve = r; });
    const idle = createStreamParser((e) => onProcEvent(p, e));   // init/session events that arrive between turns
    const onLine = (line) => {
      const t = p.turn;
      if (t) t.parser.push(line + '\n'); else idle.push(line + '\n');
    };
    child.on('error', (err) => { p.exited = true; p.error = err; p.initResolve(); for (const fn of [...p.onExit]) fn({ error: err }); });
    child.stdout.on('data', (d) => {
      p.buf += d.toString('utf8');
      let i;
      while ((i = p.buf.indexOf('\n')) >= 0) { onLine(p.buf.slice(0, i)); p.buf = p.buf.slice(i + 1); }
    });
    child.stderr.on('data', (d) => { p.stderr = (p.stderr + d.toString('utf8')).slice(-2000); });
    child.on('close', (code) => {
      if (p.buf.trim()) { onLine(p.buf); p.buf = ''; }
      p.exited = true; p.code = code; p.initResolve();
      if (proc === p) proc = null;
      for (const fn of [...p.onExit]) fn({ code });
    });
    return p;
  }
  function onProcEvent(p, e) {
    if (e.kind === 'init') {
      p.initSeen = true;
      try { learnCatalog(e); } catch { /* the catalog is a convenience */ }
      try { recordMcpStatus(e, p.no); } catch { /* status is a convenience */ }
      p.initResolve();
    }
    if (e.kind === 'session' && e.id) p.sessionId = e.id;
  }
  // End the live process: close its stdin and give it a moment, then kill. Resolves when it has gone.
  function stopProc(p = proc) {
    if (!p || p.exited) { if (proc === p) proc = null; return Promise.resolve(); }
    if (proc === p) proc = null;
    return new Promise((resolve) => {
      let done = false;
      const fin = () => { if (done) return; done = true; clearTimeout(t); resolve(); };
      p.onExit.add(fin);
      const t = setTimeout(() => { try { p.child.kill(); } catch { /* gone */ } setTimeout(fin, 50); }, stopWaitMs);
      try { p.child.stdin.end(); } catch { fin(); }
    });
  }

  function runTurn(turnId, text, { forcePerTurn = false } = {}) {
    return new Promise((resolve) => {
      const cfg = getConfig();
      const prior = getSession();
      const access = accessNow();
      const policy = buildToolPolicy({ hubDir: fs.existsSync(hubDir) ? hubDir : null, kbDir, mcp: access.mcp });
      const prompt = systemPrompt(cfg);
      const hosts = Array.isArray(cfg.browserHosts) && cfg.browserHosts.some(validHost) ? cfg.browserHosts : DEFAULT_BROWSER_HOSTS;
      const persistent = !forcePerTurn && transportOf(cfg) === 'persistent';
      const args = buildArgs({ policy, prompt, sessionId: prior && prior.id, model: cfg.model, restricted: cfg.restricted !== false, settings: hookSettings({ hosts }), persistent });
      const key = JSON.stringify(args);   // everything the process was started with; a difference means restart

      emit({ type: 'start', turnId, resumed: !!(prior && prior.id) });
      let finished = false;
      let reply = '';
      let sessionId = prior && prior.id ? prior.id : null;
      let result = null;
      let timer = null;
      let p = null;
      let firstTurnOfProc = false;
      const finish = (ev) => { if (finished) return; finished = true; clearTimeout(timer); if (p && p.turn && p.turn.id === turnId) p.turn = null; const i = unfinished.indexOf(turnId); if (i >= 0) unfinished.splice(i, 1); emit({ ...ev, turnId }); resolve(); };

      const parser = createStreamParser((e) => {
        if (e.kind === 'init' || e.kind === 'session') onProcEvent(p, e);
        if (e.kind === 'session') sessionId = e.id;
        else if (e.kind === 'delta') { reply += e.text; emit({ type: 'delta', turnId, text: e.text }); }
        else if (e.kind === 'break') { reply += '\n\n'; emit({ type: 'delta', turnId, text: '\n\n' }); }
        else if (e.kind === 'tool') emit({ type: 'tool', turnId, name: e.name });
        else if (e.kind === 'result') { result = e; if (p && p.persistent) complete(); }
      });

      // The turn's outcome, once a result is in (persistent) or the process has closed (per-turn).
      function complete(code = 0) {
        if (result && result.denials) {
          const names = Object.keys(readCatalog().servers);
          for (const tool of new Set(result.denials)) {
            const { server } = splitMcpName(tool, names);
            emit({ type: 'denied', turnId, tool, server, level: server ? classifyTool(tool) : null });
          }
        }
        if (finished) return;
        if (code !== 0 || !result || result.isError) {
          const why = (result && result.isError && result.text) || (p && p.stderr.trim().split('\n').pop()) || `claude exited with code ${code}`;
          // The CLI refused the streaming shape on this process's first turn: remember it for this run and redo the turn per-turn.
          if (p && p.persistent && firstTurnOfProc && !result && STREAM_INPUT_REFUSED.test(String(why))) {
            streamInputOk = false;
            finished = true; clearTimeout(timer); p.turn = null;
            emit({ type: 'notice', turnId, text: 'The CLI does not accept streaming input here; using one process per message instead.' });
            return resolve(runTurn(turnId, text, { forcePerTurn: true }));
          }
          return finish({ type: 'error', message: explainCliError(String(why)).slice(0, 600) });
        }
        const rawFull = reply || result.text || '';
        const parsed = bridge ? engine.parse(rawFull) : { display: rawFull, actions: [], errors: [], blocks: 0 };
        const full = parsed.display;
        const id = result.sessionId || sessionId || (p && p.sessionId) || null;
        const ts = now().toISOString();
        try {
          writeJsonAtomic(files.session, {
            id, created_at: (prior && prior.created_at) || ts, updated_at: ts, turns: ((prior && prior.turns) || 0) + 1,
          });
          append({ ts, turnId, role: 'assistant', origin: 'agent', text: full });
        } catch (err) { return finish({ type: 'error', message: `Saved nothing: ${err.message}` }); }
        if (p && p.persistent && !prior) p.key = JSON.stringify(buildArgs({ policy, prompt, sessionId: id, model: cfg.model, restricted: cfg.restricted !== false, settings: hookSettings({ hosts }), persistent: true }));   // the session now exists: the live process matches a `--resume <id>` key
        finish({ type: 'done', text: full, sessionId: id, stripped: parsed.blocks > 0 });
        if (parsed.blocks > 0) {
          const meta = turnMeta.get(turnId) || { hops: 0 };
          const work = engine.process({ turnId, parsed, hops: meta.hops }).catch((err) => emit({ type: 'notice', turnId, text: `Action failed: ${err.message}` })).finally(() => inflight.delete(work));
          inflight.add(work);
        }
      }

      (async () => {
        try {
          if (persistent) {
            if (proc && (proc.exited || proc.key !== key)) await stopProc(proc);
            if (!proc) {
              p = spawnProc({ args, key, persistent: true });
              proc = p;
              firstTurnOfProc = true;
              if (initWaitMs > 0) await Promise.race([p.waitInit, new Promise((r) => setTimeout(r, initWaitMs))]);   // the MCP status for the header, when the CLI reports it in time
            } else p = proc;
          } else {
            p = spawnProc({ args, key, persistent: false });
            firstTurnOfProc = true;
          }
        } catch (err) { return finish({ type: 'error', message: `Could not start claude: ${err.message}` }); }
        if (p.exited) {
          const why = p.error ? (p.error.code === 'ENOENT' ? 'The claude CLI was not found (looked on PATH, ~/.local/bin, ~/.claude/local, Homebrew and nvm; set PEON_PET_CLAUDE_BIN to its full path)' : `claude failed: ${p.error.message}`) : null;
          if (why) return finish({ type: 'error', message: why });
          return complete(p.code == null ? 1 : p.code);
        }
        p.turn = { id: turnId, parser };
        timer = setTimeout(() => { try { p.child.kill(); } catch { /* gone */ } if (proc === p) proc = null; finish({ type: 'error', message: 'Timed out waiting for the assistant' }); }, timeoutMs);
        p.onExit.add(({ code, error }) => {
          if (finished) return;
          if (error) return finish({ type: 'error', message: error.code === 'ENOENT' ? 'The claude CLI was not found (looked on PATH, ~/.local/bin, ~/.claude/local, Homebrew and nvm; set PEON_PET_CLAUDE_BIN to its full path)' : `claude failed: ${error.message}` });
          if (p.persistent && !result) return complete(code == null || code === 0 ? 1 : code);   // died mid-turn
          complete(code == null ? 0 : code);
        });
        const header = renderTurnHeader({ access: renderAccessBlock(access.mcp.summary), mcpNotes: mcpNotes(access.mcp.summary), receipts: renderReceipts(sentFile, { now: now().getTime() }), text });
        try {
          if (p.persistent) p.child.stdin.write(userLine(header));
          else p.child.stdin.end(header);
        } catch { /* the exit handler reports it */ }
      })();
    });
  }

  // A server's tool names are only learned when a turn runs with that server allowed, so a fresh grant would allow nothing
  // until she had chatted once. After granting, learn them now in a throwaway sibling home (same grants, no bridge,
  // its own transcript) and merge the names into her catalog. One short turn; her chat history is untouched.
  async function learnTools() {
    const scratch = `${home}.learn`;
    fs.mkdirSync(scratch, { recursive: true, mode: 0o700 });
    writeJsonAtomic(path.join(scratch, 'grants.json'), { version: 1, grants: grants.list() });
    const probe = createEuphonia({ home: scratch, hubDir, user, claudeBin, spawnImpl, now, timeoutMs, initWaitMs, stopWaitMs, promptTemplate, discover, managedPolicy, firmUrl, assetsDir, userDataDir, peonDir, bridge: false, actionDeps });
    try { await probe.send('Just say ready.').done; } finally { await probe.shutdown(); }
    const learned = readJson(probe.paths.catalog, { servers: {} }).servers || {};
    const cat = readCatalog();
    const counts = {};
    for (const [name, v] of Object.entries(learned)) {
      if (!v || !Array.isArray(v.tools) || !v.tools.length) continue;
      cat.servers[name] = { ...(cat.servers[name] || {}), status: v.status, tools: v.tools };
      counts[name] = v.tools.length;
    }
    cat.updated = now().toISOString();
    writeJsonAtomic(files.catalog, cat);
    return counts;
  }

  // origin: "user" means a person typed it in the pet UI. Nothing else may carry that origin.
  function send(text, { origin = 'user', hops = 0 } = {}) {
    const body = String(text == null ? '' : text).trim();
    if (!body) throw new Error('Empty message');
    const turnId = `t${now().getTime()}-${++counter}`;
    append({ ts: now().toISOString(), turnId, role: 'user', origin, text: body });
    unfinished.push(turnId);
    turnMeta.set(turnId, { origin, hops });
    if (origin === 'tool') emit({ type: 'user-tool', turnId, text: body });
    const done = (tail = tail.then(() => runTurn(turnId, body)));
    return { turnId, done };
  }

  return {
    send, history, resetSession, decideCard: (req) => { const w = engine.decide(req).finally(() => inflight.delete(w)); inflight.add(w); return w; }, cards: () => engine.list(),
    idle: async () => { do { await tail; await Promise.all([...inflight]); } while (inflight.size || unfinished.length); }, grants, discoverServers, learnTools, accessSummary: () => accessNow().mcp.summary, pendingTurns: () => ({ running: unfinished[0] || null, queued: unfinished.slice(1) }), getReadMarker, setReadMarker, getConfig, setConfig, getSession,
    shutdown: () => stopProc(), process: () => (proc ? { no: proc.no, persistent: proc.persistent, initSeen: proc.initSeen, exited: proc.exited } : null), mcpStatus: readMcpStatus, receipts: (opts) => renderReceipts(sentFile, { now: now().getTime(), ...opts }),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    paths: { home, kbDir, ...files, hubDir, identity: identityFile, sent: sentFile },
  };
}

module.exports = { createEuphonia, buildArgs, childEnv, explainCliError, renderPrompt, renderTurnHeader, userLine, DEFAULT_CONFIG, MCP_STARTUP_MS, OWNER_FALLBACK };
