'use strict';
// One conservative classifier for MCP tool names. A tool is READ only if its name carries a read verb
// and no write verb; anything else, and anything unknown, is WRITE.
const READ_VERBS = new Set(['get', 'list', 'search', 'read', 'fetch', 'query', 'describe', 'find', 'lookup', 'view', 'check', 'analyze', 'preview']);
// Verbs that make a name a write even when it also contains a read verb ("add_list_record", "get_or_create").
const WRITE_VERBS = new Set([
  'send', 'post', 'create', 'add', 'update', 'edit', 'delete', 'remove', 'write', 'set', 'put', 'patch', 'merge', 'close', 'reopen', 'move', 'rename',
  'transition', 'assign', 'comment', 'draft', 'schedule', 'upload', 'publish', 'push', 'trigger', 'start', 'cancel', 'stop', 'run', 'execute', 'invoke',
  'spawn', 'approve', 'reject', 'resolve', 'unblock', 'retry', 'rerun', 'deploy', 'install', 'tune', 'apply', 'submit', 'save', 'duplicate', 'link',
  'unlink', 'archive', 'restore', 'revoke', 'grant', 'invite', 'share', 'react', 'convert', 'download', 'authenticate', 'complete', 'continue', 'wait',
]);

// "mcp__slack__slack_send_message" -> { server: 'slack', tool: 'slack_send_message' }; bare names have no server.
function splitMcpName(full, knownServers = []) {
  const m = /^mcp__(.+)$/.exec(String(full));
  if (!m) return { server: null, tool: String(full) };
  const rest = m[1];
  const known = [...knownServers].sort((a, b) => b.length - a.length).find((s) => rest.startsWith(`${s}__`));
  if (known) return { server: known, tool: rest.slice(known.length + 2) };
  const i = rest.indexOf('__');
  return i < 0 ? { server: rest, tool: '' } : { server: rest.slice(0, i), tool: rest.slice(i + 2) };
}

function tokens(name) {
  return String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

// → 'read' | 'write'. Accepts a bare tool name or a full mcp__server__tool name.
function classifyTool(name) {
  const bare = /^mcp__/.test(String(name)) ? splitMcpName(name).tool : String(name);
  const t = tokens(bare);
  if (t.some((x) => WRITE_VERBS.has(x))) return 'write';
  return t.some((x) => READ_VERBS.has(x)) ? 'read' : 'write';
}

module.exports = { classifyTool, splitMcpName, READ_VERBS, WRITE_VERBS };
