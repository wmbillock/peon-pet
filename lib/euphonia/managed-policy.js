'use strict';
// What the machine's managed Claude Code settings say about MCP tools. Read only, names only. A tool the policy lists
// under `ask` needs a person at a prompt: in persistent mode that prompt reaches the owner as an approval card, in per-turn
// mode nobody can answer it. `deny` is unusable outright. Knowing this keeps her access block truthful.
// (--restricted makes the CLI ignore the user's own settings files, so only the managed file matters here.)
const fs = require('fs');

function managedSettingsFile(platform = process.platform) {
  return platform === 'darwin' ? '/Library/Application Support/ClaudeCode/managed-settings.json'
    : platform === 'win32' ? 'C:\\Program Files\\ClaudeCode\\managed-settings.json' : '/etc/claude-code/managed-settings.json';
}

const TOOL_RULE = /^mcp__([A-Za-z0-9](?:[A-Za-z0-9.-]|_(?!_))*)__([A-Za-z0-9][A-Za-z0-9_.-]*)$/;   // server, then tool (SERVER_RE grammar)
const SERVER_RULE = /^mcp__([A-Za-z0-9](?:[A-Za-z0-9.-]|_(?!_))*)(?:__\*)?$/;                  // a whole-server rule

// → { ask, deny, known: { server: [tool] }, servers: Set<server>, file, error } — ask/deny hold `mcp__server__tool` and
// whole-server rules. `known` is every tool name the policy mentions (allow, ask or deny), by server: a catalog of names
// that exists before the server has ever connected in her session (slow starters such as Playwright are still "pending"
// when the CLI reports its tool list). `servers` is every server any rule names, so an ungranted server the policy
// allows can be denied by name even before it is discovered.
function readManagedPolicy({ platform = process.platform, readFile = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  const file = managedSettingsFile(platform);
  const out = { ask: new Set(), deny: new Set(), known: {}, servers: new Set(), file, error: null };
  let text;
  try { text = readFile(file); } catch (e) { if (!e || e.code !== 'ENOENT') out.error = e.message; return out; }
  try {
    const p = (JSON.parse(text) || {}).permissions || {};
    for (const k of ['allow', 'ask', 'deny']) {
      for (const r of (Array.isArray(p[k]) ? p[k] : [])) {
        if (typeof r !== 'string' || !/^mcp__/.test(r)) continue;
        if (k !== 'allow') out[k].add(r);
        const m = TOOL_RULE.exec(r);
        if (m) { (out.known[m[1]] = out.known[m[1]] || new Set()).add(m[2]); out.servers.add(m[1]); }
        else { const w = SERVER_RULE.exec(r); if (w) out.servers.add(w[1]); }
      }
    }
    for (const [srv, set] of Object.entries(out.known)) out.known[srv] = [...set].sort();
  } catch (e) { out.error = `could not parse ${file}: ${e.message}`; }
  return out;
}

// Does a rule set hold this full tool name? Exact, or a server-wide rule `mcp__server` / `mcp__server__*`.
function heldBy(set, full, server) {
  return set.has(full) || set.has(`mcp__${server}`) || set.has(`mcp__${server}__*`);
}

module.exports = { readManagedPolicy, heldBy, managedSettingsFile };
