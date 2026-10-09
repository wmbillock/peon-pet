'use strict';
// What the machine's managed Claude Code settings say about MCP tools. Read only, names only. A tool the policy lists
// under `ask` needs a person at a prompt, and Euphonia's session never prompts (dontAsk), so such a tool is unusable for
// her however the owner grants it; `deny` is unusable outright. Knowing this keeps her access block truthful instead of
// letting her try a call that the CLI refuses.
const fs = require('fs');

function managedSettingsFile(platform = process.platform) {
  return platform === 'darwin' ? '/Library/Application Support/ClaudeCode/managed-settings.json'
    : platform === 'win32' ? 'C:\\Program Files\\ClaudeCode\\managed-settings.json' : '/etc/claude-code/managed-settings.json';
}

const TOOL_RULE = /^mcp__([A-Za-z0-9][A-Za-z0-9_.-]*?)__([A-Za-z0-9][A-Za-z0-9_.-]*)$/;   // server names here carry no "__"

// → { ask: Set<rule>, deny: Set<rule>, known: { server: [tool] }, file, error } — rules are the `mcp__server__tool` names.
// `known` is every tool name the policy mentions (allow, ask or deny), by server: a catalog of names that exists before
// the server has ever connected in her session. Slow starters (Playwright) are still "pending" when the CLI reports its
// tool list, so this is how their names reach her allowlist at all.
function readManagedPolicy({ platform = process.platform, readFile = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  const file = managedSettingsFile(platform);
  const out = { ask: new Set(), deny: new Set(), known: {}, file, error: null };
  let text;
  try { text = readFile(file); } catch (e) { if (!e || e.code !== 'ENOENT') out.error = e.message; return out; }
  try {
    const p = (JSON.parse(text) || {}).permissions || {};
    for (const k of ['allow', 'ask', 'deny']) {
      for (const r of (Array.isArray(p[k]) ? p[k] : [])) {
        if (typeof r !== 'string' || !/^mcp__/.test(r)) continue;
        if (k !== 'allow') out[k].add(r);
        const m = TOOL_RULE.exec(r);
        if (m && m[2] !== '*') (out.known[m[1]] = out.known[m[1]] || new Set()).add(m[2]);
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
