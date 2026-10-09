'use strict';
// Where may the assistant's browser go? A PreToolUse hook on `browser_navigate` (any MCP server) that denies a URL whose
// host is not on the owner's list. The list lives in Euphonia's config.json (browserHosts), which the model cannot write.
// Default: this machine and Affirm. Entries: an exact host ("localhost", "127.0.0.1", "[::1]"), or "*.example.com" which
// also matches the apex. http(s) only; about:blank is fine. This guards the one tool that takes a URL; clicks, typing
// and scripts that could lead elsewhere are write-class and need a write grant.
// Runs standalone (node or Electron as node): `browser-guard.js --hosts a,b,c` reads the hook JSON on stdin.

const DEFAULT_BROWSER_HOSTS = ['localhost', '127.0.0.1', '[::1]', '*.affirm.com'];
const HOST_RE = /^(\*\.)?[A-Za-z0-9][A-Za-z0-9.-]{0,252}$|^\[[0-9A-Fa-f:.]{2,45}\]$/;

const validHost = (h) => typeof h === 'string' && HOST_RE.test(h);

// → { ok: true } | { ok: false, reason }
function urlAllowed(url, hosts = DEFAULT_BROWSER_HOSTS) {
  const s = String(url == null ? '' : url).trim();
  if (s === 'about:blank') return { ok: true };
  let u;
  try { u = new URL(s); } catch { return { ok: false, reason: `not a valid URL: ${s.slice(0, 120)}` }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: `only http(s) pages; got ${u.protocol}` };
  const host = u.hostname.toLowerCase();
  for (const raw of hosts) {
    if (!validHost(raw)) continue;
    const h = raw.toLowerCase();
    if (h.startsWith('*.')) { const apex = h.slice(2); if (host === apex || host.endsWith(`.${apex}`)) return { ok: true }; }
    else if (host === h) return { ok: true };
  }
  return { ok: false, reason: `${host} is not an allowed host (allowed: ${hosts.join(', ')}). The owner widens the list in Euphonia's config.json (browserHosts).` };
}

// The hook's stdin JSON → stdout JSON (deny) or nothing (allow). Pure, so tests can call it.
function decide(input, hosts) {
  const url = input && input.tool_input && input.tool_input.url;
  const v = urlAllowed(url, hosts);
  if (v.ok) return null;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Browser blocked: ${v.reason}` } };
}

// The settings JSON for `claude --settings`, wiring this file as the hook. `node` is whatever runs it: under Electron, the
// app binary as node.
function hookSettings({ hosts = DEFAULT_BROWSER_HOSTS, node = process.execPath, script = __filename, electron = !!process.versions.electron } = {}) {
  const clean = hosts.filter(validHost);
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const command = `${electron ? 'ELECTRON_RUN_AS_NODE=1 ' : ''}${q(node)} ${q(script)} --hosts ${q(clean.join(','))}`;
  return { hooks: { PreToolUse: [{ matcher: 'mcp__.*__browser_navigate$', hooks: [{ type: 'command', command, timeout: 30 }] }] } };
}

// Exit codes follow the hook contract: 0 = decided (deny JSON on stdout, or nothing = allow), 2 = block the call. Anything that
// cannot decide (unreadable input, a thrown error) blocks: a guard that fails must fail closed.
function main(argv, stdin, stdout) {
  const i = argv.indexOf('--hosts');
  const hosts = i >= 0 && argv[i + 1] ? argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_BROWSER_HOSTS;
  let input;
  try { input = JSON.parse(stdin || '{}'); } catch { return 2; }
  if (!input || typeof input !== 'object') return 2;
  const out = decide(input, hosts);
  if (out) stdout.write(JSON.stringify(out));
  return 0;
}

if (require.main === module) {
  process.on('uncaughtException', () => { try { process.stderr.write('browser guard failed; the navigation was blocked\n'); } catch { /* */ } process.exit(2); });
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { buf += d; });
  process.stdin.on('end', () => process.exit(main(process.argv.slice(2), buf, process.stdout)));
}

module.exports = { urlAllowed, decide, hookSettings, validHost, DEFAULT_BROWSER_HOSTS, HOST_RE };
