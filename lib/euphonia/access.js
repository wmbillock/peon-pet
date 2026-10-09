'use strict';
// Turns active grants + the learned tool catalog into the per-turn tool rules and the "Current access" text.
const { classifyTool } = require('./tool-class');
const { heldBy } = require('./managed-policy');

const stamp = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// catalog: { servers: { name: { status, tools: [bareToolName] } } } learned from the CLI's own init event.
// configured: server names found in config files. Names are used verbatim in `mcp__<server>__<tool>` rules.
// managed: from managed-policy.readManagedPolicy. A tool the policy holds under `deny` is denied whatever the grant says. A
// tool held under `ask` needs a person: with approvals=true (persistent mode) and a grant at the level the tool needs it is
// neither allowed nor denied, the CLI asks and the owner clicks a card; otherwise it is denied and told to her with the real
// remedy (a write grant, or nothing she can do). Nothing here loosens the policy; it only stops promising her a tool the CLI would refuse.
function computeMcpAccess({ grants = [], catalog = { servers: {} }, configured = [], managed = null, approvals = false }) {
  const servers = catalog.servers || {};
  const allow = [], deny = [], summary = [], approve = [];
  const granted = new Map(grants.map((g) => [g.server, g]));

  for (const g of grants) {
    const learned = (servers[g.server] && servers[g.server].tools) || [];
    const fromPolicy = (managed && managed.known && managed.known[g.server]) || [];
    const tools = [...new Set([...learned, ...fromPolicy])].sort();   // names the CLI reported, plus names the machine's policy lists
    const heldDeny = [], heldAsk = [], needsWriteGrant = [];   // three different causes, three different remedies
    for (const t of tools) {
      const cls = classifyTool(t);
      const full = `mcp__${g.server}__${t}`;
      const levelOk = cls === 'read' || g.level === 'write';
      if (managed && heldBy(managed.deny, full, g.server)) { heldDeny.push(t); deny.push(full); continue; }
      if (managed && heldBy(managed.ask, full, g.server)) {
        if (approvals && levelOk) { approve.push(full); continue; }   // the owner approves each call on a card
        (levelOk ? heldAsk : needsWriteGrant).push(t); deny.push(full); continue;
      }
      if (levelOk) allow.push(full);
      else deny.push(full);   // belt and braces: a read grant explicitly denies the server's write-class tools
    }
    const prefix = `mcp__${g.server}__`;
    const status = servers[g.server] && servers[g.server].status;
    summary.push({ server: g.server, level: g.level, expires_at: g.expires_at, discovered: tools.length > 0 || status === 'connected',
      names: allow.filter((x) => x.startsWith(prefix)).map((x) => x.slice(prefix.length)),
      held: [...heldDeny, ...heldAsk, ...needsWriteGrant], heldDeny, heldAsk, needsWriteGrant,
      approve: approve.filter((x) => x.startsWith(prefix)).map((x) => x.slice(prefix.length)) });
  }
  // Every server we know of without a grant is denied by name, which beats any broader allow (including enterprise
  // managed allow rules). With no grants at all the broad wildcard stays as well.
  const known = new Set([...configured, ...Object.keys(servers), ...((managed && managed.servers) || [])]);   // a server the policy allows but nothing has discovered yet is still denied by name
  for (const s of known) if (!granted.has(s)) deny.push(`mcp__${s}`);
  if (!grants.length) deny.push('mcp__*');
  return { allow, deny, summary, approve };
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
    const note = s.discovered ? '' : ' (this server has not reported its tools yet; if a tool you need is missing, say so and try the next route)';
    const few = (xs) => `${xs.slice(0, 12).join(', ')}${xs.length > 12 ? `, +${xs.length - 12} more` : ''}`;
    const tools = (s.names || []).length ? ` Tools you may call: ${few(s.names)}.` : '';
    const ap = (s.approve || []).length ? ` Callable with the owner's click on an approval card (call it; the card shows the owner the exact input, and the click is the approval): ${few(s.approve)}.` : '';
    // Three kinds of "not now", each with its real remedy, so she asks for the right thing instead of guessing.
    const heldDeny = (s.heldDeny || []).length ? ` Denied by this machine's managed policy for everyone (nothing the owner can grant; do not call): ${few(s.heldDeny)}.` : '';
    const heldAsk = (s.heldAsk || []).length ? ` Held by the managed policy for a person's approval at a prompt this session cannot show (do not call; route through The Firm's Management or a brief for Claude Code): ${few(s.heldAsk)}.` : '';
    const needW = (s.needsWriteGrant || []).length ? ` Need a WRITE grant on ${s.server} before they can be card-approved (do not call; ask the owner for write access in Euphonia > Tool access): ${few(s.needsWriteGrant)}.` : '';
    lines.push(`- ${s.server}: ${s.level}${s.level === 'write' ? ' (read and write)' : ''}, ${until}${note}${tools}${ap}${heldDeny}${heldAsk}${needW}`);
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
