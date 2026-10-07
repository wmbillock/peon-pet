'use strict';
// Euphonia core: transport-independent. The pet window is one view onto it; Slack can be another.
// Each user message runs the Claude Code CLI non-interactively and resumes ONE long-lived session.
// Events (subscribe): start | delta | tool | done | error, each tagged with the turn id.
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
const { SERVER: BRIDGE_SERVER } = require('./bridge/tools');
const { createActionEngine } = require('./actions');
const { createTools, createRunner } = require('./bridge/tools');
const { createFirmHttp } = require('./bridge/firm-http');
const { createGhRunner } = require('./bridge/gh');
const { createAudit } = require('./bridge/audit');
const { applyCosmetics } = require('./bridge/cosmetics');

const SPECIES_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DEFAULT_CONFIG = { name: 'Euphonia', soundPack: DEFAULT_PACK, species: DEFAULT_SPECIES, border: 'neon-cyan', openChatOnLaunch: false, model: null, restricted: true };
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
function buildArgs({ policy, prompt, sessionId, model, restricted }) {   // --system-prompt-snapshot off: the access block is re-rendered every turn, not recorded once
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--append-system-prompt', prompt, '--system-prompt-snapshot', 'off',
    '--permission-mode', policy.permissionMode,
    '--tools', policy.tools.join(','),
    '--allowedTools', policy.allowedTools.join(','),
    '--disallowedTools', policy.disallowedTools.join(','),
    '--disable-slash-commands'];   // no --strict-mcp-config: refused where an enterprise MCP config exists
  for (const d of policy.addDirs) args.push('--add-dir', d);
  if (restricted) args.push('--restricted');
  if (model) args.push('--model', model);
  if (sessionId) args.push('--resume', sessionId);
  return args;
}

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
  claudeBin = 'claude',
  spawnImpl = spawn,
  now = () => new Date(),
  timeoutMs = TURN_TIMEOUT_MS,
  promptTemplate,
  discover = discoverMcpServers,
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
  };
  const kbDir = path.join(home, 'kb');
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  seedKb(kbDir, { user, now: now() });

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
    const mcp = computeMcpAccess({ grants: active.filter((g) => g.server !== BRIDGE_SERVER), catalog: readCatalog(), configured: real });
    const cap = active.find((g) => g.server === BRIDGE_SERVER);
    if (cap) mcp.summary.push({ server: BRIDGE_SERVER, level: cap.level, expires_at: cap.expires_at, action: true, names: engineNames(cap.level) });
    return { active, mcp };
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
    defs, run, grants, audit, cardsFile: files.cards, now: () => now().getTime(), emit: (ev) => emit(ev),
    sendFollowUp: (text, { hops }) => { try { send(text, { origin: 'tool', hops }); } catch { /* an empty result is not worth a turn */ } },
  });
  const engineNames = (level) => defs.filter((d) => level === 'write' || d.class === 'read').map((d) => (d.class === 'write' ? `${d.name} (needs the user's approval card)` : d.name));
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
    append({ ts: now().toISOString(), role: 'system', origin: 'user', text: 'new conversation' });   // marks where the visible conversation restarts
    return true;
  }

  function runTurn(turnId, text) {
    return new Promise((resolve) => {
      const cfg = getConfig();
      const prior = getSession();
      const access = accessNow();
      const policy = buildToolPolicy({ hubDir: fs.existsSync(hubDir) ? hubDir : null, kbDir, mcp: access.mcp });
      const template = promptTemplate || fs.readFileSync(PROMPT_FILE, 'utf8');
      const prompt = renderPrompt(template, { user, name: cfg.name, kb: kbDir, hub: hubDir, access: renderAccessBlock(access.mcp.summary) });
      const args = buildArgs({ policy, prompt, sessionId: prior && prior.id, model: cfg.model, restricted: cfg.restricted !== false,  });

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
        child = spawnImpl(claudeBin, args, { cwd: home, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (err) { return finish({ type: 'error', message: `Could not start claude: ${err.message}` }); }

      timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish({ type: 'error', message: 'Timed out waiting for the assistant' }); }, timeoutMs);
      child.on('error', (err) => finish({ type: 'error', message: err.code === 'ENOENT' ? 'The claude CLI was not found on PATH' : `claude failed: ${err.message}` }));
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
          return finish({ type: 'error', message: explainCliError(String(why)).slice(0, 600) });
        }
        const rawFull = reply || result.text || '';
        const parsed = bridge ? engine.parse(rawFull) : { display: rawFull, actions: [], errors: [], blocks: 0 };
        const full = parsed.display;
        const id = result.sessionId || sessionId;
        const ts = now().toISOString();
        try {
          writeJsonAtomic(files.session, {
            id, created_at: (prior && prior.created_at) || ts, updated_at: ts, turns: ((prior && prior.turns) || 0) + 1,
          });
          append({ ts, turnId, role: 'assistant', origin: 'agent', text: full });
        } catch (err) { return finish({ type: 'error', message: `Saved nothing: ${err.message}` }); }
        finish({ type: 'done', text: full, sessionId: id, stripped: parsed.blocks > 0 });
        if (parsed.blocks > 0) {
          const meta = turnMeta.get(turnId) || { hops: 0 };
          const work = engine.process({ turnId, parsed, hops: meta.hops }).catch((err) => emit({ type: 'notice', turnId, text: `Action failed: ${err.message}` })).finally(() => inflight.delete(work));
          inflight.add(work);
        }
      });
      try { child.stdin.end(text); } catch { /* the close handler reports it */ }
    });
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
    idle: async () => { do { await tail; await Promise.all([...inflight]); } while (inflight.size || unfinished.length); }, grants, discoverServers, accessSummary: () => accessNow().mcp.summary, pendingTurns: () => ({ running: unfinished[0] || null, queued: unfinished.slice(1) }), getReadMarker, setReadMarker, getConfig, setConfig, getSession,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    paths: { home, kbDir, ...files, hubDir },
  };
}

module.exports = { createEuphonia, buildArgs, explainCliError, renderPrompt, DEFAULT_CONFIG };
