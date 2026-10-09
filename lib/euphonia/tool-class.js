'use strict';
// One conservative classifier for MCP tool names. A tool is READ only if its name carries a read verb
// and no write verb; anything else, and anything unknown, is WRITE.
const READ_VERBS = new Set(['get', 'list', 'search', 'read', 'fetch', 'query', 'describe', 'find', 'lookup', 'view', 'check', 'analyze', 'preview', 'watch']);
// One grammar for MCP server names everywhere (grants, policy rules, splitting full names): no `__` inside, so a full
// `mcp__<server>__<tool>` name splits without ambiguity, and no leading punctuation.
const SERVER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]|_(?!_)){0,63}$/;
// Verbs that make a name a write even when it also contains a read verb ("add_list_record", "get_or_create").
const WRITE_VERBS = new Set([
  'send', 'post', 'create', 'add', 'update', 'edit', 'delete', 'remove', 'write', 'set', 'put', 'patch', 'merge', 'close', 'reopen', 'move', 'rename',
  'transition', 'assign', 'comment', 'draft', 'schedule', 'upload', 'publish', 'push', 'trigger', 'start', 'cancel', 'stop', 'run', 'execute', 'invoke',
  'spawn', 'approve', 'reject', 'resolve', 'unblock', 'retry', 'rerun', 'deploy', 'install', 'tune', 'apply', 'submit', 'save', 'duplicate', 'link',
  'unlink', 'archive', 'restore', 'revoke', 'grant', 'invite', 'share', 'react', 'convert', 'download', 'authenticate', 'complete', 'continue', 'wait',
  // compound names ("search_and_replace", "mark_read", "fetch_and_store") carry a write verb that must win over the read verb
  'mark', 'replace', 'insert', 'append', 'store', 'acknowledge', 'ack', 'snooze', 'mute', 'escalate', 'notify', 'page', 'enable', 'disable', 'toggle',
  'reset', 'clear', 'purge', 'kill', 'terminate', 'restart', 'destroy', 'drop', 'truncate', 'pin', 'star', 'follow', 'subscribe', 'join', 'leave', 'lock',
  'unlock', 'claim', 'release', 'import', 'sync', 'refresh', 'generate', 'clone', 'fork', 'tag', 'label', 'flag', 'vote', 'pay', 'refund', 'transfer',
  'login', 'logout', 'register', 'provision', 'launch', 'exec', 'eval', 'dispatch', 'reply', 'respond', 'answer', 'forward', 'modify', 'change',
  'configure', 'activate', 'deactivate', 'copy', 'sign', 'seer',   // seer: Sentry's paid analysis run is an action, not a read
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

// Browser (Playwright MCP) tools carry no verb the table understands, so they are named explicitly. Read = looking
// (navigate is a GET to a URL the host-guard hook has allowed; that hook, not this list, is what keeps it harmless):
// go to a page, read it, picture it, read its console and network log, wait. Everything else (click, type, fill, select,
// press, drag, upload, dialogs, evaluate/run_code, tabs, install, close) changes the page or runs code: write.
const BROWSER_READ = new Set(['browser_navigate', 'browser_navigate_back', 'browser_snapshot', 'browser_take_screenshot',
  'browser_console_messages', 'browser_network_requests', 'browser_wait_for', 'browser_resize']);

function tokens(name) {
  return String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

// → 'read' | 'write'. Accepts a bare tool name or a full mcp__server__tool name (pass knownServers for the latter when a
// server name could contain a verb; with the SERVER_RE grammar a plain split is otherwise unambiguous).
function classifyTool(name, knownServers = []) {
  const bare = /^mcp__/.test(String(name)) ? splitMcpName(name, knownServers).tool : String(name);
  if (/^browser_/.test(bare)) return BROWSER_READ.has(bare) ? 'read' : 'write';
  const t = tokens(bare);
  if (t.some((x) => WRITE_VERBS.has(x))) return 'write';
  return t.some((x) => READ_VERBS.has(x)) ? 'read' : 'write';
}

module.exports = { classifyTool, splitMcpName, READ_VERBS, WRITE_VERBS, BROWSER_READ, SERVER_RE };
