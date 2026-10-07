const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { parseMcpList, probeMcpList } = require('../lib/euphonia/mcp-list');
const { createEuphonia } = require('../lib/euphonia/service');
const { fakeClaude, okReply } = require('./helpers/fake-claude');

// Captured from `claude mcp list` (v2.1.289) on 2026-10-07; the pagerduty command is shell text with its own dashes.
const FIXTURE = [
  'Checking MCP server health…', '',
  'buildkite: https://mcp.buildkite.com/mcp/readonly (HTTP) - ✓ Connected',
  'lucid: https://mcp.lucid.app/mcp (HTTP) - ! Needs authentication',
  "pagerduty: sh -c MCP_SECRET_TOKEN=$(op read 'op://Private/PagerDuty MCP Token/credential' 2>/dev/null); [ -z \"$MCP_SECRET_TOKEN\" ] && exit 1; export MCP_SECRET_HEADER=\"Token token=$MCP_SECRET_TOKEN\"; exec npx -y mcp-remote@0.1.38 https://mcp.pagerduty.com/mcp --header 'Authorization:${MCP_SECRET_HEADER}' 2>/tmp/pagerduty-mcp.log - ✗ Failed to connect — CONNECTION_CLOSED: Connection closed",
  'playwright: sh -c npx --prefix=/tmp @playwright/mcp@0.0.68 --isolated 2>/tmp/playwright-mcp.log - ✓ Connected',
  'jira: https://mcp.atlassian.com/v1/mcp (HTTP) - ✓ Connected', '',
  'MCP config diagnostics ⚠', '',
  'For help configuring MCP servers, see: https://code.claude.com/docs/en/mcp', '',
  '[Contains warnings] Enterprise config (managed by your organization)',
  'Location: /Library/Application Support/ClaudeCode/managed-mcp.json',
  ' └─ [Warning] [pagerduty] mcpServers.pagerduty: Missing environment variables: MCP_SECRET_HEADER',
].join('\n');

test('parse: connected, failed and needs-auth lines; shell text in the command does not confuse it; diagnostics are skipped', () => {
  const r = parseMcpList(FIXTURE);
  expect(r.count).toBe(5);
  expect(Object.fromEntries(Object.entries(r.servers).map(([k, v]) => [k, v.status]))).toEqual({ buildkite: 'connected', lucid: 'needs-auth', pagerduty: 'failed', playwright: 'connected', jira: 'connected' });
  expect(r.servers.pagerduty.detail).toBe('Failed to connect — CONNECTION_CLOSED: Connection closed');
  expect(r.servers.lucid.detail).toBe('Needs authentication');
  expect(parseMcpList('')).toEqual({ servers: {}, count: 0 });
  expect(parseMcpList('Location: /x - y\nnot a status - line').count).toBe(0);
});

// A fake `claude mcp list` child: prints `out`, exits `code` after `delayMs`; never exits when `hang` is set.
function fakeList({ out = FIXTURE, code = 0, delayMs = 0, hang = false } = {}) {
  const spawned = [];
  const spawnImpl = (cmd, args, opts) => {
    const c = new EventEmitter(); c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.killed = false;
    spawned.push({ cmd, args, opts, child: c });
    c.kill = () => { c.killed = true; setImmediate(() => c.emit('close', null)); };
    if (!hang) setTimeout(() => { c.stdout.write(out); c.stdout.end(); c.emit('close', code); }, delayMs);
    return c;
  };
  return { spawnImpl, spawned };
}

test('probe: spawns `claude mcp list` with the child env, resolves the parsed servers; a timeout kills it and fails open', async () => {
  const f = fakeList();
  const r = await probeMcpList({ spawnImpl: f.spawnImpl, bin: '/x/claude', env: { PATH: '/p', MCP_TIMEOUT: '120000' }, cwd: '/home' });
  expect(f.spawned[0]).toMatchObject({ cmd: '/x/claude', args: ['mcp', 'list'], opts: { cwd: '/home', env: { PATH: '/p', MCP_TIMEOUT: '120000' } } });
  expect(r.ok).toBe(true); expect(Object.keys(r.servers)).toHaveLength(5);
  const h = fakeList({ hang: true });
  const t = await probeMcpList({ spawnImpl: h.spawnImpl, timeoutMs: 20 });
  expect(t).toMatchObject({ ok: false, error: expect.stringMatching(/did not finish within 0 s/) });
  expect(h.spawned[0].child.killed).toBe(true);
  expect(await probeMcpList({ spawnImpl: fakeList({ out: 'nothing useful', code: 1 }).spawnImpl })).toMatchObject({ ok: false, error: expect.stringMatching(/exited 1/) });
  expect(await probeMcpList({ spawnImpl: () => { throw new Error('ENOENT'); } })).toMatchObject({ ok: false, error: expect.stringMatching(/could not start/) });
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mcpl-'));
const mk = (listFake, extra = {}) => {
  const cli = fakeClaude((c) => okReply(c, 's', ['x']));
  const home = tmp();
  const e = createEuphonia({ home, hubDir: path.join(home, 'hub'), user: 'u', spawnImpl: cli.spawnImpl, probeSpawnImpl: listFake.spawnImpl, mcpProbe: true, probeTimeoutMs: 50, initWaitMs: 0, stopWaitMs: 20,
    discover: () => ({ servers: [{ name: 'jira' }, { name: 'playwright' }, { name: 'lucid' }, { name: 'pagerduty' }, { name: 'slack' }], errors: [] }), managedPolicy: () => ({ ask: new Set(), deny: new Set() }), ...extra });
  return { e, cli, home };
};

test('at launch the probe writes mcp-status.json with source mcp-list, and the FIRST turn header shows that state for granted servers, labelled by source and age', async () => {
  const { e, cli } = mk(fakeList());
  for (const server of ['jira', 'playwright', 'lucid', 'pagerduty', 'slack']) e.grants.grant({ server, level: 'read', duration: '1h' });
  await e.refreshMcpStatus();                                  // the launch probe (already running) resolves
  const st = JSON.parse(fs.readFileSync(e.paths.mcpStatus, 'utf8'));
  expect(st.source).toBe('mcp-list');
  expect(typeof st.updated).toBe('string');
  expect(st.servers.jira).toMatchObject({ status: 'connected', tools: 0 });
  await e.send('hello').done;
  const h = cli.calls[0].full;
  expect(h).not.toMatch(/connection state unknown/);
  expect(h).toMatch(/lucid: held: still connecting \(CLI reported "needs-auth" \(from `claude mcp list` under a minute ago\)\)/);
  expect(h).toMatch(/pagerduty: held: still connecting \(CLI reported "failed": Failed to connect — CONNECTION_CLOSED: Connection closed \(from `claude mcp list` under a minute ago\)\)/);
  expect(h).toMatch(/jira: connected \(from `claude mcp list` under a minute ago\) but no tools catalogued yet/);
  expect(h).toMatch(/slack: held: not reported by the CLI \(from `claude mcp list`/);   // granted, but not in the list
  // a later init from a turn overwrites it with source init
  const cli2 = fakeClaude((c) => okReply(c, 's', ['x'], { init: { tools: ['Read', 'mcp__jira__getJiraIssue'], mcp_servers: [{ name: 'jira', status: 'connected' }, { name: 'lucid', status: 'needs-auth' }] } }));
  const again = createEuphonia({ home: e.paths.home, hubDir: e.paths.hubDir, user: 'u', spawnImpl: cli2.spawnImpl, initWaitMs: 0, discover: () => ({ servers: [], errors: [] }), managedPolicy: () => ({ ask: new Set(), deny: new Set() }) });
  await again.send('x').done;
  expect(JSON.parse(fs.readFileSync(e.paths.mcpStatus, 'utf8'))).toMatchObject({ source: 'init', servers: { jira: { status: 'connected', tools: 1 } } });
  await e.shutdown(); await again.shutdown();
});

test('a probe that times out or fails leaves the previous file untouched and the header says so; a restart after a grant change re-probes', async () => {
  const hang = fakeList({ hang: true });
  const { e, cli } = mk(hang);
  fs.writeFileSync(e.paths.mcpStatus, JSON.stringify({ updated: new Date(Date.now() - 3 * 3600e3).toISOString(), launch: 'old', source: 'mcp-list', servers: { jira: { status: 'failed', detail: 'Failed to connect', tools: 0 } } }));
  const before = fs.readFileSync(e.paths.mcpStatus, 'utf8');
  e.grants.grant({ server: 'jira', level: 'read', duration: '1h' });
  await e.refreshMcpStatus();                                  // the launch probe times out (50 ms cap in this test)
  expect(fs.readFileSync(e.paths.mcpStatus, 'utf8')).toBe(before);
  await e.send('hello').done;
  const h = cli.calls[0].full;
  expect(h).toMatch(/jira: held: still connecting \(CLI reported "failed": Failed to connect \(from `claude mcp list` 3 h ago, as of the previous launch\)\)/);
  expect(h).toMatch(/MCP check: claude mcp list did not finish within 0 s \(under a minute ago\); the state above is the last one known\./);
  expect(hang.spawned).toHaveLength(1);
  e.grants.grant({ server: 'playwright', level: 'read', duration: '1h' });   // the allowlist changes: her process restarts and the probe runs again
  await e.send('again').done;
  expect(hang.spawned).toHaveLength(2);
  await e.shutdown();
});

test('under a test fake the probe is off unless asked, so no suite spawns `claude mcp list` by accident', () => {
  const cli = fakeClaude(() => {});
  const home = tmp();
  createEuphonia({ home, hubDir: path.join(home, 'hub'), user: 'u', spawnImpl: cli.spawnImpl, discover: () => ({ servers: [], errors: [] }) });
  expect(cli.procs).toHaveLength(0);
});
