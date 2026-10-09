'use strict';
// Which MCP servers are configured? Read-only, no provider call, no authentication. Names only: server
// definitions (URLs, tokens, env) are never read into the result.
// `claude mcp list` is deliberately not used: it health-checks every server, which is slow and touches the network.
const fs = require('fs');
const os = require('os');
const path = require('path');

function sources({ home, cwd, platform }) {
  const managed = platform === 'darwin' ? '/Library/Application Support/ClaudeCode/managed-mcp.json'
    : platform === 'win32' ? 'C:\\Program Files\\ClaudeCode\\managed-mcp.json' : '/etc/claude-code/managed-mcp.json';
  return [
    { kind: 'managed', file: managed, pick: (d) => d.mcpServers },
    { kind: 'user', file: path.join(home, '.claude.json'), pick: (d) => ({ ...(d.mcpServers || {}), ...(((d.projects || {})[cwd] || {}).mcpServers || {}) }) },
    { kind: 'project', file: path.join(cwd, '.mcp.json'), pick: (d) => d.mcpServers },
  ];
}

// → { servers: [{ name, sources: [kind], status: string|null }], errors: [{ source, message }], checked: [file] }
// A missing file is normal. An unreadable or malformed file is an error, reported, never silently empty.
function discoverMcpServers({ cwd, home = os.homedir(), platform = process.platform, readFile = (f) => fs.readFileSync(f, 'utf8'), seen = {} } = {}) {
  const found = new Map();
  const errors = [], checked = [];
  const add = (name, kind) => { const e = found.get(name) || { name, sources: [], status: null }; if (!e.sources.includes(kind)) e.sources.push(kind); found.set(name, e); };
  for (const s of sources({ home, cwd, platform })) {
    checked.push(s.file);
    let text;
    try { text = readFile(s.file); } catch (e) {
      if (e && e.code === 'ENOENT') continue;
      errors.push({ source: s.kind, message: `${s.file}: ${e.message}` });
      continue;
    }
    try {
      const names = Object.keys(s.pick(JSON.parse(text)) || {});
      names.forEach((n) => add(n, s.kind));
    } catch (e) { errors.push({ source: s.kind, message: `${s.file}: could not parse (${e.message})` }); }
  }
  // Servers the CLI itself reported on a past turn (init event), e.g. connectors that are not in a file.
  for (const [name, info] of Object.entries(seen)) { add(name, 'seen'); found.get(name).status = (info && info.status) || null; }
  const servers = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (!servers.length && !errors.length) errors.push({ source: 'all', message: `No MCP configuration found (looked in: ${checked.join(', ')})` });
  return { servers, errors, checked };
}

module.exports = { discoverMcpServers };
