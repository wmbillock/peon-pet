'use strict';
// Turns active grants + the learned tool catalog into the per-turn tool rules and the "Current access" text.
const { classifyTool } = require('./tool-class');

const stamp = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// catalog: { servers: { name: { status, tools: [bareToolName] } } } learned from the CLI's own init event.
// configured: server names found in config files. Names are used verbatim in `mcp__<server>__<tool>` rules.
function computeMcpAccess({ grants = [], catalog = { servers: {} }, configured = [] }) {
  const servers = catalog.servers || {};
  const allow = [], deny = [], summary = [];
  const granted = new Map(grants.map((g) => [g.server, g]));

  for (const g of grants) {
    const tools = (servers[g.server] && servers[g.server].tools) || [];
    let r = 0, w = 0;
    for (const t of tools) {
      const cls = classifyTool(t);
      const full = `mcp__${g.server}__${t}`;
      if (cls === 'read' || g.level === 'write') { allow.push(full); cls === 'read' ? r++ : w++; }
      else deny.push(full);   // belt and braces: a read grant explicitly denies the server's write-class tools
    }
    const prefix = `mcp__${g.server}__`;
    summary.push({ server: g.server, level: g.level, expires_at: g.expires_at, allowedTools: r + w, discovered: tools.length > 0,
      names: allow.filter((x) => x.startsWith(prefix)).map((x) => x.slice(prefix.length)) });
  }
  // Every server we know of without a grant is denied by name, which beats any broader allow (including enterprise
  // managed allow rules). With no grants at all the broad wildcard stays as well.
  const known = new Set([...configured, ...Object.keys(servers)]);
  for (const s of known) if (!granted.has(s)) deny.push(`mcp__${s}`);
  if (!grants.length) deny.push('mcp__*');
  return { allow, deny, summary };
}

// The block injected into the system prompt on every turn.
function renderAccessBlock(summary) {
  const lines = ['- Built in: read the hub (read only); read and write only your own knowledge base.'];
  if (!summary.length) lines.push('- External tools and actions: none. No MCP server and no euphonia-bridge action is granted.');
  for (const s of summary) {
    if (s.action) {
      const until = s.expires_at ? `until ${stamp(s.expires_at)}` : 'blanket, until the owner revokes it';
      lines.push(`- ${s.server} (actions the app performs for you, not an MCP server): ${s.level}, ${until}. Actions you may request: ${s.names.join(', ')}.`);
      continue;
    }
    const until = s.expires_at ? `until ${stamp(s.expires_at)}` : 'blanket, until the owner revokes it';
    const note = s.discovered ? '' : ' (this server\'s tool list is learned on its first turn; if a tool is missing, ask again after this reply)';
    const shown = (s.names || []).slice(0, 12);
    const tools = shown.length ? ` Tools you may call: ${shown.join(', ')}${s.names.length > shown.length ? `, +${s.names.length - shown.length} more` : ''}.` : '';
    lines.push(`- ${s.server}: ${s.level}${s.level === 'write' ? ' (read and write)' : ''}, ${until}${note}${tools}`);
  }
  lines.push('- No other tools. Everything else is denied, and you cannot change this.');
  return lines.join('\n');
}

// One-line form for the chat header indicator: "read: slack, jira · write: notion".
function renderAccessLine(grants) {
  const by = (lv) => grants.filter((g) => g.level === lv).map((g) => g.server);
  const parts = [];
  if (by('read').length) parts.push(`read: ${by('read').join(', ')}`);
  if (by('write').length) parts.push(`write: ${by('write').join(', ')}`);
  return parts.length ? parts.join(' \u00b7 ') : 'none';
}

module.exports = { computeMcpAccess, renderAccessBlock, renderAccessLine };
