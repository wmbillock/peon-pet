'use strict';
// Euphonia core: transport-independent. The pet window is one view onto it; Slack can be another.
// Each user message runs the Claude Code CLI non-interactively and resumes ONE long-lived session.
// Events (subscribe): start | delta | tool | done | error, each tagged with the turn id.
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
const { BRIDGE_SERVER, BRIDGE_TOOLS } = require('./bridge/names');
const { hookSettings, validHost, DEFAULT_BROWSER_HOSTS } = require('./browser-guard');
const BRIDGE_MAIN = path.join(__dirname, 'bridge', 'main.js');

const SPECIES_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DEFAULT_CONFIG = { name: 'Euphonia', soundPack: DEFAULT_PACK, species: DEFAULT_SPECIES, border: 'neon-cyan', openChatOnLaunch: false, model: null, restricted: true, browserHosts: DEFAULT_BROWSER_HOSTS };
const PROMPT_FILE = path.join(__dirname, 'prompt.md');
const TURN_TIMEOUT_MS = 5 * 60 * 1000;

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function defaultUser() { try { return os.userInfo().username; } catch { return 'user'; } }

function renderPrompt(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, k) => (k in vars ? vars[k] : ''));
}

// The exact argv for one turn. Pure, so tests can read it.
function buildArgs({ policy, prompt, sessionId, model, restricted, mcpConfig, settings, live = false, name = null }) {   // --system-prompt-snapshot off: the access block is re-rendered every turn, not recorded once
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--append-system-prompt', prompt, '--system-prompt-snapshot', 'off',
    '--permission-mode', policy.permissionMode,
    '--tools', policy.tools.join(','),
    '--allowedTools', policy.allowedTools.join(','),
    '--disallowedTools', policy.disallowedTools.join(','),
    '--disable-slash-commands'];   // no --strict-mcp-config: refused where an enterprise MCP config exists
  if (mcpConfig) args.push('--mcp-config', mcpConfig);   // the euphonia-bridge server; its tools are still denied unless the owner grants them
  if (settings) args.push('--settings', JSON.stringify(settings));   // the browser host guard hook; --settings applies even under --restricted
  for (const d of policy.addDirs) args.push('--add-dir', d);
  if (restricted) args.push('--restricted');
  if (model) args.push('--model', model);
  if (live) args.push('--input-format', 'stream-json');   // one long-lived process; each message is a JSON line on stdin
  if (live && policy.permissionMode !== 'dontAsk') args.push('--permission-prompt-tool', 'stdio');   // permission prompts come to the app: approval cards
  if (name) args.push('--name', name);                   // how her session shows up in Claude Code's session lists
  if (sessionId) args.push('--resume', sessionId);
  return args;
}

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

function createEuphonia({
  home,
  hubDir = path.join(os.homedir(), 'Claude'),
  user = defaultUser(),
  claudeBin = null,   // null: find it at spawn time (launchd's PATH is minimal)
  spawnImpl = spawn,
  now = () => new Date(),
  timeoutMs = TURN_TIMEOUT_MS,
  promptTemplate,
  discover = discoverMcpServers,
  managedPolicy = readManagedPolicy,   // () => { ask, deny } from the machine's managed settings; tests pass a stub
  firmUrl,
  assetsDir,
  userDataDir,
  peonDir,
  bridge = true,
  persistent = false,   // true: Euphonia is ONE long-lived claude process (MCP servers connect once and stay up); false: a process per turn
} = {}) {
  if (!home) home = path.join(os.homedir(), '.euphonia', user);
  const files = {
    session: path.join(home, 'session.json'),
    transcript: path.join(home, 'transcript.jsonl'),
    config: path.join(home, 'config.json'),
    read: path.join(home, 'read.json'),
    grants: path.join(home, 'grants.json'),
    catalog: path.join(home, 'tools-seen.json'),
    bridgeConfig: path.join(home, 'mcp-bridge.json'),
  };
  const kbDir = path.join(home, 'kb');
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  seedKb(kbDir, { user, now: now() });

  const grants = createGrantStore({ file: files.grants, now });

  // Tools and MCP servers the CLI itself reported on past turns. Learned from the init event, so no extra provider call.
  const readCatalog = () => {
    const c = readJson(files.catalog, null);
    const cat = c && c.servers ? c : { servers: {} };
    if (bridge) cat.servers[BRIDGE_SERVER] = { status: 'built-in', tools: [...BRIDGE_TOOLS] };   // known statically, not learned
    return cat;
  };
  // The bridge is launched by the CLI from a generated --mcp-config. Under Electron the app binary runs it as plain node.
  function writeBridgeConfig() {
    const args = [BRIDGE_MAIN, '--home', home];
    const opt = (k, v) => { if (v) args.push(`--${k}`, String(v)); };
    opt('firm-url', typeof firmUrl === 'function' ? firmUrl() : firmUrl); opt('assets-dir', assetsDir); opt('user-data-dir', userDataDir); opt('peon-dir', peonDir);
    const server = { command: process.execPath, args, ...(process.versions.electron ? { env: { ELECTRON_RUN_AS_NODE: '1' } } : {}) };
    writeJsonAtomic(files.bridgeConfig, { mcpServers: { [BRIDGE_SERVER]: server } });
    return files.bridgeConfig;
  }
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
  // Server list for the dashboard and the per-server denies: configured in files, plus those the CLI reported.
  const discoverServers = () => {
    const found = discover({ cwd: home, seen: readCatalog().servers });
    if (bridge && !found.servers.some((x) => x.name === BRIDGE_SERVER)) found.servers = [...found.servers, { name: BRIDGE_SERVER, sources: ['built-in'], status: null }].sort((a, b) => a.name.localeCompare(b.name));
    return found;
  };
  // Everything the model is told and allowed this turn, recomputed from the active grants every time.
  function accessNow() {
    const active = grants.list();
    const found = discoverServers();
    let managed = null;
    try { managed = managedPolicy(); } catch { /* unreadable policy: compute as before; the CLI still enforces it */ }
    const mcp = computeMcpAccess({ grants: active, catalog: readCatalog(), configured: found.servers.map((x) => x.name), managed, approvals: persistent });
    return { active, mcp };
  }

  const listeners = new Set();
  const emit = (ev) => { for (const fn of [...listeners]) { try { fn(ev); } catch { /* a bad listener must not break the turn */ } } };
  let counter = 0;
  let tail = Promise.resolve();
  const unfinished = [];   // turn ids accepted but not yet finished, oldest first: [running, ...queued]

  const getConfig = () => ({ ...DEFAULT_CONFIG, ...readJson(files.config, {}) });
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

  // Start over without deleting anything: the old session file is kept beside the new one.
  function resetSession() {   // (defined after `append`)
    if (!fs.existsSync(files.session)) return false;
    fs.renameSync(files.session, path.join(home, `session.${now().getTime()}.old.json`));
    stopLive('new conversation');   // the live process holds the old conversation; the next message starts a new one
    append({ ts: now().toISOString(), role: 'system', origin: 'user', text: 'new conversation' });   // marks where the visible conversation restarts
    return true;
  }

  // Some machines have an enterprise MCP config, and then the CLI refuses a --mcp-config handed to it per turn. Once
  // that happens the bridge is dropped (chat works, Firm and GitHub tools do not) instead of failing every message.
  let bridgeBlocked = false;
  const BRIDGE_NOT_LOADED = 'NOTE: your bridge tools are NOT loaded on this machine (the managed MCP policy refuses them). Do not try to call them. Read The Firm\'s live state from firm/STATUS.md and firm/inbox.json in your kb instead (the app refreshes them). To hand Management something, use a management draft block as described below.';
  const MCP_REFUSED = /dynamically configure MCP servers|enterprise MCP config/i;

  function runTurn(turnId, text, { skipBridge = false } = {}) {
    return new Promise((resolve) => {
      const cfg = getConfig();
      const prior = getSession();
      const access = accessNow();
      const policy = buildToolPolicy({ hubDir: fs.existsSync(hubDir) ? hubDir : null, kbDir, mcp: access.mcp });
      const template = promptTemplate || fs.readFileSync(PROMPT_FILE, 'utf8');
      const prompt = renderPrompt(template, { user, name: cfg.name, kb: kbDir, hub: hubDir, access: renderAccessBlock(access.mcp.summary), bridge: bridge && (bridgeBlocked || skipBridge) ? BRIDGE_NOT_LOADED : '' });
      const hosts = Array.isArray(cfg.browserHosts) && cfg.browserHosts.some(validHost) ? cfg.browserHosts : DEFAULT_BROWSER_HOSTS;
      const args = buildArgs({ policy, prompt, sessionId: prior && prior.id, model: cfg.model, restricted: cfg.restricted !== false,
        mcpConfig: bridge && !bridgeBlocked && !skipBridge ? writeBridgeConfig() : null, settings: hookSettings({ hosts }) });

      emit({ type: 'start', turnId, resumed: !!(prior && prior.id) });
      let finished = false;
      let reply = '';
      let sessionId = prior && prior.id ? prior.id : null;
      let result = null;
      let stderr = '';
      let timer = null;
      const finish = (ev) => { if (finished) return; finished = true; clearTimeout(timer); const i = unfinished.indexOf(turnId); if (i >= 0) unfinished.splice(i, 1); emit({ ...ev, turnId }); resolve(); };

      const parser = createStreamParser((e) => {
        if (e.kind === 'session') sessionId = e.id;
        else if (e.kind === 'delta') { reply += e.text; emit({ type: 'delta', turnId, text: e.text }); }
        else if (e.kind === 'break') { reply += '\n\n'; emit({ type: 'delta', turnId, text: '\n\n' }); }
        else if (e.kind === 'tool') emit({ type: 'tool', turnId, name: e.name });
        else if (e.kind === 'init') { try { learnCatalog(e); } catch { /* the catalog is a convenience */ } }
        else if (e.kind === 'result') result = e;
      });

      let child;
      try {
        const bin = claudeBin || findClaude() || 'claude';
        child = spawnImpl(bin, args, { cwd: home, env: childEnv(bin), stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (err) { return finish({ type: 'error', message: `Could not start claude: ${err.message}` }); }

      timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish({ type: 'error', message: 'Timed out waiting for the assistant' }); }, timeoutMs);
      child.on('error', (err) => finish({ type: 'error', message: err.code === 'ENOENT' ? 'The claude CLI was not found (looked on PATH, ~/.local/bin, ~/.claude/local, Homebrew and nvm; set PEON_PET_CLAUDE_BIN to its full path)' : `claude failed: ${err.message}` }));
      child.stdout.on('data', (d) => parser.push(d.toString('utf8')));
      child.stderr.on('data', (d) => { stderr = (stderr + d.toString('utf8')).slice(-2000); });
      child.on('close', (code) => {
        parser.end();
        if (result && result.denials) {
          const names = Object.keys(readCatalog().servers);
          for (const tool of new Set(result.denials)) {
            const { server } = splitMcpName(tool, names);
            emit({ type: 'denied', turnId, tool, server, level: server ? classifyTool(tool) : null });
          }
        }
        if (finished) return;
        if (code !== 0 || !result || result.isError) {
          const why = (result && result.isError && result.text) || stderr.trim().split('\n').pop() || `claude exited with code ${code}`;
          if (bridge && !bridgeBlocked && !skipBridge && MCP_REFUSED.test(String(why))) {
            bridgeBlocked = true;   // remember for the rest of this run; the retry carries no --mcp-config
            finished = true; clearTimeout(timer);
            return resolve(runTurn(turnId, text, { skipBridge: true }));
          }
          return finish({ type: 'error', message: explainCliError(String(why)).slice(0, 600) });
        }
        const full = reply || result.text || '';
        const id = result.sessionId || sessionId;
        const ts = now().toISOString();
        try {
          writeJsonAtomic(files.session, {
            id, created_at: (prior && prior.created_at) || ts, updated_at: ts, turns: ((prior && prior.turns) || 0) + 1,
          });
          append({ ts, turnId, role: 'assistant', origin: 'agent', text: full });
        } catch (err) { return finish({ type: 'error', message: `Saved nothing: ${err.message}` }); }
        finish({ type: 'done', text: full, sessionId: id });
      });
      try { child.stdin.end(text); } catch { /* the close handler reports it */ }
    });
  }

  // ---- Persistent mode -------------------------------------------------------------------------------------------
  // One `claude -p --input-format stream-json` process holds her session. Started at launch (start()), so the MCP servers
  // connect while she is idle; a per-turn process answered before slow servers (Playwright) were up. The process is
  // replaced only when what it was started with changes (grants, prompt, model, browser hosts), and then it resumes the
  // same conversation by id, so her context is continuous either way.
  let live = null;   // { child, key, onEvent, stderr, dead }
  let approvable = new Set();   // full tool names the owner may approve per call (policy ask + a grant at the needed level)
  const approvals = new Map();  // id -> { tool, input, respond, timer, turnId }
  let approvalSeq = 0;
  const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
  const auditApproval = (rec) => { try { fs.appendFileSync(path.join(home, 'approvals.jsonl'), JSON.stringify({ ts: now().toISOString(), ...rec }) + '\n', { mode: 0o600 }); } catch { /* best effort */ } };
  let currentTurnId = null;

  // The CLI asks its host before running a tool that no rule allows or denies (here: the managed policy's `ask`).
  // Only a tool in `approvable` reaches the owner as a card; everything else is refused at once, as dontAsk would.
  function onControl(l, e) {
    const reply = (response) => { try { l.child.stdin.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: e.requestId, response } }) + '\n'); } catch { /* process gone */ } };
    const req = e.request || {};
    if (req.subtype !== 'can_use_tool') {
      try { l.child.stdin.write(JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: e.requestId, error: `unsupported request: ${req.subtype}` } }) + '\n'); } catch { /* gone */ }
      return;
    }
    const tool = String(req.tool_name || '');
    const input = req.input && typeof req.input === 'object' ? req.input : {};
    if (!approvable.has(tool)) {
      auditApproval({ tool, decision: 'refused', reason: 'not approvable' });
      return reply({ behavior: 'deny', message: `${tool} is not allowed in this session. The owner changes access in the dashboard under Euphonia > Tool access.` });
    }
    const id = `a${now().getTime()}-${++approvalSeq}`;
    const names = Object.keys(readCatalog().servers);
    const { server } = splitMcpName(tool, names);
    const finish = (allow, why) => {
      const a = approvals.get(id); if (!a) return false;
      approvals.delete(id); clearTimeout(a.timer);
      auditApproval({ id, tool, decision: allow ? 'approved' : 'denied', by: why, input });
      reply(allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: why === 'owner' ? 'The owner denied this call.' : 'No approval arrived in time; the call was not made.' });
      emit({ type: 'approval-closed', id, approved: !!allow, by: why });
      return true;
    };
    const timer = setTimeout(() => finish(false, 'timeout'), APPROVAL_TIMEOUT_MS);
    if (timer.unref) timer.unref();
    approvals.set(id, { tool, input, finish, timer });
    auditApproval({ id, tool, decision: 'asked', input });
    emit({ type: 'approval', id, turnId: currentTurnId, tool, server, level: classifyTool(tool), input: JSON.stringify(input, null, 2).slice(0, 4000) });
  }
  // Only the owner, through the chat window (ipc checks the sender), answers. Returns false for an unknown or closed card.
  function answerApproval(id, allow) { const a = approvals.get(String(id)); return a ? a.finish(!!allow, 'owner') : false; }
  const pendingApprovals = () => [...approvals.entries()].map(([id, a]) => ({ id, tool: a.tool, input: JSON.stringify(a.input, null, 2).slice(0, 4000) }));
  function liveSpec({ skipBridge = false } = {}) {
    const cfg = getConfig();
    const access = accessNow();
    const policy = buildToolPolicy({ hubDir: fs.existsSync(hubDir) ? hubDir : null, kbDir, mcp: access.mcp });
    const template = promptTemplate || fs.readFileSync(PROMPT_FILE, 'utf8');
    const prompt = renderPrompt(template, { user, name: cfg.name, kb: kbDir, hub: hubDir, access: renderAccessBlock(access.mcp.summary), bridge: bridge && (bridgeBlocked || skipBridge) ? BRIDGE_NOT_LOADED : '' });
    const hosts = Array.isArray(cfg.browserHosts) && cfg.browserHosts.some(validHost) ? cfg.browserHosts : DEFAULT_BROWSER_HOSTS;
    const useBridge = bridge && !bridgeBlocked && !skipBridge;
    // Permission prompts go to the app (approval cards) instead of being refused. The allow and deny rules are unchanged, so
    // a prompt only happens for a tool neither allows nor denies; onControl approves nothing by itself.
    policy.permissionMode = 'default';
    const base = { policy, prompt, model: cfg.model, restricted: cfg.restricted !== false, settings: hookSettings({ hosts }), live: true, name: `${cfg.name} (${user})` };
    approvable = new Set(access.mcp.approve || []);
    const key = JSON.stringify(buildArgs({ ...base, mcpConfig: useBridge ? files.bridgeConfig : null }));   // no session id: resuming is not a change
    return { base, key, useBridge };
  }
  function stopLive(why) {
    if (!live) return;
    const l = live; live = null; l.dead = true;
    try { l.child.stdin.end(); } catch { /* gone */ }
    const t = setTimeout(() => { try { l.child.kill(); } catch { /* gone */ } }, 3000); if (t.unref) t.unref();
    const cb = l.onExit; l.onExit = null; if (cb) cb(why || 'stopped');
  }
  function ensureLive(opts = {}) {
    const spec = liveSpec(opts);
    if (live && !live.dead && live.key === spec.key) return live;
    stopLive('restarting with new settings');
    const prior = getSession();
    const args = buildArgs({ ...spec.base, mcpConfig: spec.useBridge ? writeBridgeConfig() : null, sessionId: prior && prior.id });
    const bin = claudeBin || findClaude() || 'claude';
    const child = spawnImpl(bin, args, { cwd: home, env: childEnv(bin), stdio: ['pipe', 'pipe', 'pipe'] });
    const l = { child, key: spec.key, onEvent: null, onExit: null, stderr: '', dead: false, parser: null };
    const feed = (e) => { if (e.kind === 'control') return onControl(l, e); if (e.kind === 'init') { try { learnCatalog(e); } catch { /* convenience */ } } if (l.onEvent) l.onEvent(e); };
    l.newParser = () => { l.parser = createStreamParser(feed); };
    l.newParser();
    child.stdout.on('data', (d) => l.parser.push(d.toString('utf8')));
    child.stderr.on('data', (d) => { l.stderr = (l.stderr + d.toString('utf8')).slice(-2000); });
    const died = (why) => { for (const a of [...approvals.values()]) a.finish(false, 'process ended');
      if (l.dead && !l.onExit) return; l.dead = true; if (live === l) live = null; const cb = l.onExit; l.onExit = null; if (cb) cb(why); };
    child.on('error', (err) => died(err.code === 'ENOENT' ? 'The claude CLI was not found (set PEON_PET_CLAUDE_BIN to its full path)' : `claude failed: ${err.message}`));
    child.on('close', (code) => { try { l.parser.end(); } catch { /* */ } died(l.stderr.trim().split('\n').pop() || `claude exited with code ${code}`); });
    live = l;
    return l;
  }

  function runTurnLive(turnId, text, { skipBridge = false } = {}) {
    return new Promise((resolve) => {
      let l;
      try { l = ensureLive({ skipBridge }); } catch (err) { emit({ type: 'error', turnId, message: `Could not start claude: ${err.message}` }); const i = unfinished.indexOf(turnId); if (i >= 0) unfinished.splice(i, 1); return resolve(); }
      const prior = getSession();
      emit({ type: 'start', turnId, resumed: !!(prior && prior.id) });
      let finished = false, reply = '', sessionId = prior && prior.id ? prior.id : null;
      const finish = (ev) => { if (finished) return; finished = true; clearTimeout(timer); l.onEvent = null; l.onExit = null; const i = unfinished.indexOf(turnId); if (i >= 0) unfinished.splice(i, 1); emit({ ...ev, turnId }); resolve(); };
      let timer = null;
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => { if (approvals.size) return arm(); stopLive('timed out'); finish({ type: 'error', message: 'Timed out waiting for the assistant' }); }, timeoutMs); };
      arm();   // an open approval card holds the clock: the owner may take a while to read it
      l.newParser();   // fresh per-turn parser state (partial-text tracking) on the same process
      currentTurnId = turnId;
      l.onEvent = (e) => {
        if (e.kind === 'session') sessionId = e.id;
        else if (e.kind === 'delta') { reply += e.text; emit({ type: 'delta', turnId, text: e.text }); }
        else if (e.kind === 'break') { if (reply) { reply += '\n\n'; emit({ type: 'delta', turnId, text: '\n\n' }); } }
        else if (e.kind === 'tool') emit({ type: 'tool', turnId, name: e.name });
        else if (e.kind === 'result') {
          const names = Object.keys(readCatalog().servers);
          for (const tool of new Set(e.denials || [])) { const { server } = splitMcpName(tool, names); emit({ type: 'denied', turnId, tool, server, level: server ? classifyTool(tool) : null }); }
          if (e.isError) return finish({ type: 'error', message: explainCliError(String(e.text || 'the assistant reported an error')).slice(0, 600) });
          const full = reply || e.text || '';
          const id = e.sessionId || sessionId;
          const ts = now().toISOString();
          try {
            writeJsonAtomic(files.session, { id, created_at: (prior && prior.created_at) || ts, updated_at: ts, turns: ((prior && prior.turns) || 0) + 1 });
            append({ ts, turnId, role: 'assistant', origin: 'agent', text: full });
          } catch (err) { return finish({ type: 'error', message: `Saved nothing: ${err.message}` }); }
          finish({ type: 'done', text: full, sessionId: id });
        }
      };
      l.onExit = (why) => {
        if (finished) return;
        if (bridge && !bridgeBlocked && !skipBridge && MCP_REFUSED.test(String(why))) {
          bridgeBlocked = true; finished = true; clearTimeout(timer);
          return resolve(runTurnLive(turnId, text, { skipBridge: true }));
        }
        finish({ type: 'error', message: explainCliError(String(why)).slice(0, 600) });
      };
      try { l.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n'); }
      catch (err) { finish({ type: 'error', message: `Could not reach the assistant: ${err.message}` }); }
    });
  }

  // Start (or refresh) her process ahead of the first message, so servers are connected by the time you type.
  // Called at launch and after a grant change. A start-up refusal (enterprise MCP config vs the bridge) is retried without it.
  function start() {
    if (!persistent) return false;
    try {
      const l = ensureLive();
      if (!l.onExit) l.onExit = (why) => { if (bridge && !bridgeBlocked && MCP_REFUSED.test(String(why))) { bridgeBlocked = true; try { ensureLive(); } catch { /* next send retries */ } } };
      return true;
    } catch { return false; }
  }
  const shutdown = () => stopLive('shutdown');
  const status = () => ({ persistent, running: !!(live && !live.dead), pid: live && !live.dead ? live.child.pid : null });

  // A server's tool names are only learned when a turn runs with that server allowed, so a fresh grant would allow nothing
  // until she had chatted once. After granting, learn them now in a throwaway sibling home (same grants, no bridge,
  // its own transcript) and merge the names into her catalog. One short turn; her chat history is untouched.
  async function learnTools() {
    const scratch = `${home}.learn`;
    fs.mkdirSync(scratch, { recursive: true, mode: 0o700 });
    writeJsonAtomic(path.join(scratch, 'grants.json'), { version: 1, grants: grants.list() });
    const probe = createEuphonia({ home: scratch, hubDir, user, claudeBin, spawnImpl, now, timeoutMs, promptTemplate, discover, managedPolicy, firmUrl, assetsDir, userDataDir, peonDir, bridge: false });
    await probe.send('Just say ready.').done;
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
  function send(text, { origin = 'user' } = {}) {
    const body = String(text == null ? '' : text).trim();
    if (!body) throw new Error('Empty message');
    const turnId = `t${now().getTime()}-${++counter}`;
    append({ ts: now().toISOString(), turnId, role: 'user', origin, text: body });
    unfinished.push(turnId);
    const done = (tail = tail.then(() => (persistent ? runTurnLive(turnId, body) : runTurn(turnId, body))));
    return { turnId, done };
  }

  return {
    send, start, shutdown, status, answerApproval, pendingApprovals, history, resetSession, grants, discoverServers, learnTools, accessSummary: () => accessNow().mcp.summary, pendingTurns: () => ({ running: unfinished[0] || null, queued: unfinished.slice(1) }), getReadMarker, setReadMarker, getConfig, setConfig, getSession,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    paths: { home, kbDir, ...files, hubDir },
  };
}

module.exports = { createEuphonia, buildArgs, childEnv, explainCliError, renderPrompt, DEFAULT_CONFIG, MCP_STARTUP_MS };
