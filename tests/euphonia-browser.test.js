const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { urlAllowed, decide, hookSettings, DEFAULT_BROWSER_HOSTS } = require('../lib/euphonia/browser-guard');
const { classifyTool } = require('../lib/euphonia/tool-class');
const { computeMcpAccess } = require('../lib/euphonia/access');
const { buildToolPolicy, isToolAllowed } = require('../lib/euphonia/authority');
const { buildArgs, createEuphonia } = require('../lib/euphonia/service');
const { childPath } = require('../lib/euphonia/find-claude');

const GUARD = path.join(__dirname, '..', 'lib', 'euphonia', 'browser-guard.js');

test('browser tools: looking is read, acting is write', () => {
  const read = ['browser_navigate', 'browser_navigate_back', 'browser_snapshot', 'browser_take_screenshot', 'browser_console_messages', 'browser_network_requests', 'browser_wait_for', 'browser_resize'];
  const write = ['browser_click', 'browser_type', 'browser_fill_form', 'browser_select_option', 'browser_press_key', 'browser_drag', 'browser_hover', 'browser_file_upload',
    'browser_handle_dialog', 'browser_evaluate', 'browser_run_code', 'browser_tabs', 'browser_install', 'browser_close', 'browser_something_new'];
  for (const n of read) expect([n, classifyTool(n)]).toEqual([n, 'read']);
  for (const n of write) expect([n, classifyTool(n)]).toEqual([n, 'write']);
  expect(classifyTool('mcp__playwright__browser_snapshot')).toBe('read');
  expect(classifyTool('mcp__playwright-local-verify__browser_click')).toBe('write');
});

test('a read grant on playwright allows exactly the looking tools; clicking stays denied', () => {
  const catalog = { servers: { playwright: { status: 'connected', tools: ['browser_navigate', 'browser_snapshot', 'browser_take_screenshot', 'browser_click', 'browser_type', 'browser_evaluate'] } } };
  const mcp = computeMcpAccess({ grants: [{ server: 'playwright', level: 'read' }], catalog, configured: ['playwright', 'jira'] });
  const policy = buildToolPolicy({ kbDir: '/kb', mcp });
  for (const t of ['browser_navigate', 'browser_snapshot', 'browser_take_screenshot']) expect(isToolAllowed(policy, `mcp__playwright__${t}`)).toBe(true);
  for (const t of ['browser_click', 'browser_type', 'browser_evaluate']) expect(isToolAllowed(policy, `mcp__playwright__${t}`)).toBe(false);
  expect(isToolAllowed(policy, 'mcp__jira__getJiraIssue')).toBe(false);
});

test('host guard: this machine and Affirm by default; anything else, any other scheme, denied', () => {
  const ok = ['http://127.0.0.1:8420/#settings', 'http://localhost:3000/', 'https://affirm.com/x', 'https://go.affirm.com/', 'https://affirm.enterprise.slack.com'.replace('slack.com', 'affirm.com'), 'about:blank'];
  for (const u of ok) expect([u, urlAllowed(u).ok]).toEqual([u, true]);
  const bad = ['https://example.com', 'https://notaffirm.com', 'https://affirm.com.evil.io/', 'file:///etc/passwd', 'ftp://localhost/', 'javascript:alert(1)', '', 'not a url', 'http://[::1]:1/'.replace('[::1]', '10.0.0.1')];
  for (const u of bad) expect([u, urlAllowed(u).ok]).toEqual([u, false]);
  expect(urlAllowed('http://[::1]:8420/').ok).toBe(true);
  expect(urlAllowed('https://example.com', ['*.example.com']).ok).toBe(true);
  expect(urlAllowed('https://example.com', ['bogus host!', 'example.com']).ok).toBe(true);   // junk entries are skipped, not fatal
});

test('hook decision: deny carries the reason; allow is silent; a navigate without a url is denied', () => {
  expect(decide({ tool_name: 'mcp__playwright__browser_navigate', tool_input: { url: 'http://127.0.0.1:8420/' } })).toBeNull();
  const d = decide({ tool_name: 'mcp__playwright__browser_navigate', tool_input: { url: 'https://example.com/' } });
  expect(d.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
  expect(d.hookSpecificOutput.permissionDecisionReason).toMatch(/example\.com is not an allowed host/);
  expect(decide({ tool_name: 'mcp__playwright__browser_navigate', tool_input: {} }).hookSpecificOutput.permissionDecision).toBe('deny');
});

test('the hook script runs standalone the way the CLI runs it: stdin JSON in, deny JSON out, exit 0', () => {
  const run = (input, hosts) => execFileSync(process.execPath, [GUARD, '--hosts', hosts.join(',')], { input: JSON.stringify(input), encoding: 'utf8' });
  expect(run({ tool_input: { url: 'http://localhost:8420/' } }, DEFAULT_BROWSER_HOSTS)).toBe('');
  const out = JSON.parse(run({ tool_input: { url: 'https://example.com/' } }, DEFAULT_BROWSER_HOSTS));
  expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  expect(run({ tool_input: { url: 'https://example.com/' } }, ['*.example.com'])).toBe('');
});

test('hookSettings wires the script as a PreToolUse hook on browser_navigate for any server, hosts quoted for sh', () => {
  const s = hookSettings({ hosts: ['localhost', '*.affirm.com', "bad'host"], node: '/n/node', script: '/s/guard.js', electron: false });
  const h = s.hooks.PreToolUse[0];
  expect(new RegExp(h.matcher).test('mcp__playwright__browser_navigate')).toBe(true);
  expect(new RegExp(h.matcher).test('mcp__playwright-local-verify__browser_navigate')).toBe(true);
  expect(new RegExp(h.matcher).test('mcp__playwright__browser_navigate_back')).toBe(false);
  expect(h.hooks[0].command).toBe("'/n/node' '/s/guard.js' --hosts 'localhost,*.affirm.com'");   // the invalid host was dropped
  expect(hookSettings({ hosts: ['localhost'], node: '/E', script: '/g', electron: true }).hooks.PreToolUse[0].hooks[0].command).toMatch(/^ELECTRON_RUN_AS_NODE=1 /);
});

test('every turn passes the guard via --settings, and browserHosts in config is validated', () => {
  const policy = buildToolPolicy({ kbDir: '/kb' });
  const args = buildArgs({ policy, prompt: 'p', settings: hookSettings({ hosts: ['localhost'], node: '/n', script: '/g', electron: false }) });
  const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
  expect(settings.hooks.PreToolUse[0].hooks[0].command).toContain("--hosts 'localhost'");
  expect(args).not.toContain('--strict-mcp-config');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'euph-b-'));
  const e = createEuphonia({ home: path.join(tmp, 'home'), hubDir: path.join(tmp, 'hub'), user: 'u', spawnImpl: () => { throw new Error('no'); }, discover: () => ({ servers: [], errors: [] }) });
  expect(e.getConfig().browserHosts).toEqual(DEFAULT_BROWSER_HOSTS);
  expect(e.setConfig({ browserHosts: ['localhost', '*.affirm.com', 'the-firm.local'] }).browserHosts).toEqual(['localhost', '*.affirm.com', 'the-firm.local']);
  expect(() => e.setConfig({ browserHosts: ['ok.host', 'not a host'] })).toThrow(/browserHosts/);
  expect(() => e.setConfig({ browserHosts: 'localhost' })).toThrow(/browserHosts/);
});

test("the child's PATH carries nvm's node bins, so a managed server started with npx can launch under launchd", () => {
  const p = childPath('/Users/me/.local/bin/claude', { PATH: '/usr/bin' }, '/Users/me', () => ['v18.0.0', 'v22.1.0']).split(path.delimiter);
  expect(p).toContain('/Users/me/.nvm/versions/node/v22.1.0/bin');
  expect(p.indexOf('/Users/me/.nvm/versions/node/v22.1.0/bin')).toBeLessThan(p.indexOf('/Users/me/.nvm/versions/node/v18.0.0/bin'));
  expect(p.indexOf('/Users/me/.nvm/versions/node/v22.1.0/bin')).toBeLessThan(p.indexOf('/usr/bin'));
  expect(childPath('/x/claude', { PATH: '/usr/bin' }, '/nohome', () => { throw new Error('ENOENT'); })).toBe('/x:/nohome/.local/bin:/nohome/.claude/local:/nohome/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin');
});

test('the CLI child gets a two-minute MCP startup window unless the launcher set one', () => {
  const { childEnv, MCP_STARTUP_MS } = require('../lib/euphonia/service');
  expect(childEnv('/x/claude', { PATH: '/usr/bin' }).MCP_TIMEOUT).toBe(String(MCP_STARTUP_MS));
  expect(childEnv('/x/claude', { PATH: '/usr/bin', MCP_TIMEOUT: '5000' }).MCP_TIMEOUT).toBe('5000');
  expect(childEnv('/x/claude', { PATH: '/usr/bin' }).PATH.split(':')[0]).toBe('/x');
});

test('the guard fails closed: unreadable input or a crash blocks the navigation (exit 2) instead of allowing it', () => {
  const { spawnSync } = require('child_process');
  const bad = spawnSync(process.execPath, [GUARD, '--hosts', 'localhost'], { input: '{not json', encoding: 'utf8' });
  expect(bad.status).toBe(2);
  const notObj = spawnSync(process.execPath, [GUARD, '--hosts', 'localhost'], { input: '"string"', encoding: 'utf8' });
  expect(notObj.status).toBe(2);
  const ok = spawnSync(process.execPath, [GUARD, '--hosts', 'localhost'], { input: JSON.stringify({ tool_input: { url: 'http://localhost/' } }), encoding: 'utf8' });
  expect(ok.status).toBe(0); expect(ok.stdout).toBe('');
});
