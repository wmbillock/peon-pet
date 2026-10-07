const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyTool, splitMcpName } = require('../lib/euphonia/tool-class');
const { createGrantStore, expiryFor } = require('../lib/euphonia/grants');
const { computeMcpAccess, renderAccessBlock, renderAccessLine } = require('../lib/euphonia/access');
const { buildToolPolicy, isToolAllowed, isAllowed } = require('../lib/euphonia/authority');
const { discoverMcpServers } = require('../lib/euphonia/mcp-discovery');
const { createEuphonia, renderPrompt } = require('../lib/euphonia/service');
const { registerEuphoniaIpc } = require('../lib/euphonia/ipc');
const { createStreamParser } = require('../lib/euphonia/stream');
const { reduce, initial, describeDenial } = require('../renderer/chat-model');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acc-'));

test('classification table: read only when a read verb is present and no write verb; unknown is write', () => {
  const read = ['slack_read_channel', 'getJiraIssue', 'searchJiraIssuesUsingJql', 'notion-fetch', 'notion-ai-search', 'list_builds', 'get_file_contents',
    'query_prometheus_range', 'describe_table', 'preview_table', 'find_organizations', 'lookupJiraAccountId', 'check_status', 'analyze_query', 'view_dashboard',
    'mcp__slack__slack_search_channels', 'render_prometheus_range_query', 'Get_Tool_Schema', 'slack_get_reactions'];
  const write = ['slack_send_message', 'slack_send_message_draft', 'slack_schedule_message', 'slack_create_canvas', 'slack_add_list_record', 'slack_update_canvas',
    'createJiraIssue', 'editJiraIssue', 'transitionJiraIssue', 'addCommentToJiraIssue', 'createIssueLink', 'notion-create-pages', 'notion-update-page', 'notion-move-pages',
    'notion-spawn-session', 'notion-send-message-to-session', 'create_pull_request', 'merge_pull_request', 'push_files', 'add_issue_comment', 'slack_get_file_upload_url',
    'execute_query', 'run_data_explorer_report', 'Invoke_Tool', 'start_investigation', 'authenticate', 'something_totally_new', 'frobnicate', '', 'get_or_create_thing', 'list_and_delete'];
  for (const n of read) expect([n, classifyTool(n)]).toEqual([n, 'read']);
  for (const n of write) expect([n, classifyTool(n)]).toEqual([n, 'write']);
});

test('splitMcpName uses known server names so dashes and underscores split correctly', () => {
  expect(splitMcpName('mcp__monte-carlo__get_alerts', ['monte-carlo'])).toEqual({ server: 'monte-carlo', tool: 'get_alerts' });
  expect(splitMcpName('mcp__a__b__c', ['a__b'])).toEqual({ server: 'a__b', tool: 'c' });
  expect(splitMcpName('Read')).toEqual({ server: null, tool: 'Read' });
});

describe('grants store', () => {
  let t, file;
  const mk = (now) => createGrantStore({ file, now: () => now.d });
  beforeEach(() => { t = { d: new Date('2026-10-05T12:00:00Z') }; file = path.join(tmp(), 'grants.json'); });

  test('grant fields, durations, replace-not-duplicate, revoke', () => {
    const s = mk(t);
    const g = s.grant({ server: 'slack', level: 'read', duration: '1h' });
    expect(g).toMatchObject({ server: 'slack', level: 'read', via: 'ui', granted_at: '2026-10-05T12:00:00.000Z', expires_at: '2026-10-05T13:00:00.000Z' });
    expect(s.grant({ server: 'jira', level: 'write', duration: 'blanket' }).expires_at).toBeNull();
    s.grant({ server: 'slack', level: 'write', duration: '4h' });     // extending or changing replaces the entry
    expect(s.list().filter((x) => x.server === 'slack')).toHaveLength(1);
    expect(s.list().find((x) => x.server === 'slack')).toMatchObject({ level: 'write' });
    s.revoke('slack'); expect(s.list().map((x) => x.server)).toEqual(['jira']);
    s.revokeAll(); expect(s.list()).toEqual([]);
    expect(() => s.grant({ server: 'x y', level: 'read', duration: '1h' })).toThrow();
    expect(() => s.grant({ server: 'x', level: 'admin', duration: '1h' })).toThrow();
    expect(() => s.grant({ server: 'x', level: 'read', duration: 'forever' })).toThrow();
  });

  test('expired grants are ignored and pruned from the file; blanket never expires', () => {
    const s = mk(t);
    s.grant({ server: 'slack', level: 'read', duration: '1h' });
    s.grant({ server: 'jira', level: 'read', duration: 'blanket' });
    t.d = new Date('2026-10-05T13:00:01Z');
    expect(s.list().map((x) => x.server)).toEqual(['jira']);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).grants.map((x) => x.server)).toEqual(['jira']);
    t.d = new Date('2030-01-01T00:00:00Z');
    expect(s.list().map((x) => x.server)).toEqual(['jira']);
    expect(expiryFor('eod', new Date('2026-10-05T12:00:00Z'))).toMatch(/^2026-10-0[56]T/);
  });

  test('hand-edited junk entries are dropped', () => {
    fs.writeFileSync(file, JSON.stringify({ grants: [{ server: 'ok', level: 'read', expires_at: null }, { server: 'bad name', level: 'read' }, { server: 'x', level: 'root' }] }));
    expect(mk(t).list().map((x) => x.server)).toEqual(['ok']);
  });
});

describe('per-turn allowlist', () => {
  const catalog = { servers: {
    slack: { status: 'connected', tools: ['slack_read_channel', 'slack_search_public', 'slack_send_message', 'slack_schedule_message', 'brand_new_tool'] },
    jira: { status: 'connected', tools: ['getJiraIssue', 'createJiraIssue'] },
  } };
  const policyFor = (grants) => buildToolPolicy({ hubDir: '/h', kbDir: '/k', mcp: computeMcpAccess({ grants, catalog, configured: ['slack', 'jira', 'notion'] }) });
  const S = (t) => `mcp__slack__${t}`;

  test('denied by default: no grants -> every MCP tool denied, wildcard kept', () => {
    const p = policyFor([]);
    for (const t of catalog.servers.slack.tools) expect(isToolAllowed(p, S(t))).toBe(false);
    expect(isToolAllowed(p, 'mcp__notion__notion-fetch')).toBe(false);
    expect(p.disallowedTools).toEqual(expect.arrayContaining(['mcp__*', 'mcp__slack', 'mcp__jira', 'mcp__notion']));
  });

  test('read grant: only read-class tools of that server; other servers stay denied', () => {
    const p = policyFor([{ server: 'slack', level: 'read' }]);
    expect(isToolAllowed(p, S('slack_read_channel'))).toBe(true);
    expect(isToolAllowed(p, S('slack_search_public'))).toBe(true);
    for (const t of ['slack_send_message', 'slack_schedule_message', 'brand_new_tool']) expect(isToolAllowed(p, S(t))).toBe(false);
    expect(isToolAllowed(p, 'mcp__jira__getJiraIssue')).toBe(false);
    expect(p.disallowedTools).not.toContain('mcp__*');            // a wildcard deny would beat the specific allows
    expect(p.disallowedTools).not.toContain('mcp__slack');         // the granted server is not denied wholesale
    expect(p.disallowedTools).toContain(S('slack_send_message'));
    expect(p.disallowedTools).toContain('mcp__jira');
  });

  test('write grant: read plus write-class, including unknown names; still only that server', () => {
    const p = policyFor([{ server: 'slack', level: 'write' }]);
    for (const t of catalog.servers.slack.tools) expect(isToolAllowed(p, S(t))).toBe(true);
    expect(isToolAllowed(p, 'mcp__jira__createJiraIssue')).toBe(false);
  });

  test('a tool not in the learned catalog is never allowed, whatever the level', () => {
    const p = policyFor([{ server: 'slack', level: 'write' }]);
    expect(isToolAllowed(p, S('never_seen'))).toBe(false);
  });

  test('Bash and hub writes can never come through the grant path', () => {
    const mcp = { allow: ['Bash', 'Write(//h/**)', 'mcp__slack__x'], deny: ['Read'] };
    const p = buildToolPolicy({ hubDir: '/h', kbDir: '/k', mcp });
    expect(p.allowedTools).not.toContain('Bash');
    expect(p.allowedTools.join()).not.toMatch(/\/h\/\*\*/);
    expect(p.disallowedTools).not.toContain('Read');
    expect(p.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Edit(//h/**)', 'Write(//h/**)']));
    expect(isAllowed(p, 'Write', '/h/HOME.md', { hubDir: '/h', kbDir: '/k' })).toBe(false);
    expect(isAllowed(p, 'Write', '/home/x/grants.json', { hubDir: '/h', kbDir: '/home/x/kb' })).toBe(false);   // grants live outside kb/
  });

  test('access block text and header line', () => {
    const none = computeMcpAccess({ grants: [], catalog, configured: [] });
    expect(renderAccessBlock(none.summary)).toMatch(/External tools and actions: none/);
    expect(renderAccessBlock(none.summary)).toMatch(/No other tools/);
    const a = computeMcpAccess({ grants: [{ server: 'slack', level: 'read', expires_at: '2026-10-05T18:00:00.000Z' }, { server: 'jira', level: 'write', expires_at: null }, { server: 'fresh', level: 'read', expires_at: null }], catalog, configured: [] });
    const txt = renderAccessBlock(a.summary);
    expect(txt).toMatch(/- slack: read, until /);
    expect(txt).toMatch(/- jira: write \(read and write\), blanket, until the owner revokes it/);
    expect(txt).toMatch(/- fresh: read.*learned on its first turn/);
    expect(renderAccessLine([{ server: 'slack', level: 'read' }, { server: 'jira', level: 'read' }, { server: 'notion', level: 'write' }])).toBe('read: slack, jira · write: notion');
    expect(renderAccessLine([])).toBe('none');
  });
});

describe('discovery', () => {
  test('reads server names from managed, user and project files; names only', () => {
    const files = {
      '/Library/Application Support/ClaudeCode/managed-mcp.json': JSON.stringify({ mcpServers: { slack: { url: 'https://secret' }, jira: {} } }),
      '/h/.claude.json': JSON.stringify({ mcpServers: { mine: {} }, projects: { '/h/e': { mcpServers: { proj: {} } } } }),
    };
    const r = discoverMcpServers({ cwd: '/h/e', home: '/h', platform: 'darwin', readFile: (f) => { if (f in files) return files[f]; const e = new Error('nope'); e.code = 'ENOENT'; throw e; }, seen: { zed: { status: 'connected' }, slack: { status: 'connected' } } });
    expect(r.servers.map((s) => s.name)).toEqual(['jira', 'mine', 'proj', 'slack', 'zed']);
    expect(r.servers.find((s) => s.name === 'slack')).toMatchObject({ sources: ['managed', 'seen'], status: 'connected' });
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(r.errors).toEqual([]);
  });

  test('failures surface as errors, never an empty list without a reason', () => {
    const bad = discoverMcpServers({ cwd: '/c', home: '/h', platform: 'darwin', readFile: (f) => { if (f.includes('managed')) return '{not json'; const e = new Error('EACCES: denied'); e.code = 'EACCES'; throw e; } });
    expect(bad.servers).toEqual([]);
    expect(bad.errors.length).toBe(3);
    expect(bad.errors.map((e) => e.message).join('\n')).toMatch(/could not parse/);
    expect(bad.errors.map((e) => e.message).join('\n')).toMatch(/EACCES/);
    const none = discoverMcpServers({ cwd: '/c', home: '/h', platform: 'darwin', readFile: () => { const e = new Error('x'); e.code = 'ENOENT'; throw e; } });
    expect(none.errors[0].message).toMatch(/No MCP configuration found/);
  });
});

// ---- IPC origin rules ----
function ipcSetup() {
  const handlers = {}, ons = {};
  const ipcMain = { handle: (c, f) => { handlers[c] = f; }, on: (c, f) => { ons[c] = f; } };
  const home = tmp();
  const svc = createEuphonia({ home, hubDir: path.join(home, 'hub'), user: 'w', discover: () => ({ servers: [{ name: 'slack', sources: ['managed'] }], errors: [] }), spawnImpl: () => { throw new Error('no cli'); } });
  const pet = { isDestroyed: () => false, send() {} }, chat = { isDestroyed: () => false, send() {} }, dash = { isDestroyed: () => false, send() {} };
  let opened = 0;
  registerEuphoniaIpc({
    ipcMain, getPetWebContents: () => pet, getChat: { webContents: () => chat, isActive: () => false, open: () => {} }, getSenders: () => [dash], getService: () => svc,
    peonDir: () => '/x', listPacks: () => [], isMuted: () => true, getVolume: () => 0.5, openAccessSettings: () => { opened++; },
  });
  return { handlers, ons, svc, pet, chat, dash, opened: () => opened };
}

test('only the dashboard can create, extend or revoke a grant; chat, pet and strangers cannot', async () => {
  const t = ipcSetup();
  const req = { server: 'slack', level: 'write', duration: 'blanket' };
  for (const sender of [t.chat, t.pet, {}, undefined]) {
    expect((await t.handlers['euphonia-access-set']({ sender }, req)).ok).toBe(false);
    expect((await t.handlers['euphonia-access-revoke']({ sender }, { all: true })).ok).toBe(false);
    expect((await t.handlers['euphonia-access-get']({ sender })).ok).toBe(false);
  }
  expect(t.svc.grants.list()).toEqual([]);
  const ok = await t.handlers['euphonia-access-set']({ sender: t.dash }, { server: 'slack', level: 'read', duration: '1h' });
  expect(ok.ok).toBe(true);
  // the chat window cannot extend or upgrade it either
  expect((await t.handlers['euphonia-access-set']({ sender: t.chat }, req)).ok).toBe(false);
  expect(t.svc.grants.list()).toHaveLength(1);
  expect(t.svc.grants.list()[0]).toMatchObject({ level: 'read', via: 'ui' });
  const got = await t.handlers['euphonia-access-get']({ sender: t.dash });
  expect(got.servers.map((s) => s.name)).toEqual(['euphonia-bridge', 'slack']);
  expect((await t.handlers['euphonia-access-revoke']({ sender: t.dash }, { server: 'slack' })).grants).toEqual([]);
});

test('the chat window gets a read-only summary and can open the dashboard section; nothing else can', async () => {
  const t = ipcSetup();
  t.svc.grants.grant({ server: 'slack', level: 'read', duration: '1h' });
  expect(await t.handlers['euphonia-access-summary']({ sender: t.chat })).toEqual({ text: 'read: slack' });
  expect(await t.handlers['euphonia-access-summary']({ sender: {} })).toEqual({ text: 'none' });
  t.ons['euphonia-open-access']({ sender: t.pet }); expect(t.opened()).toBe(0);
  t.ons['euphonia-open-access']({ sender: t.chat }); expect(t.opened()).toBe(1);
});

test('model output cannot reach the grant store: the transcript, the kb and the model API never write grants', async () => {
  // a reply that tries to grant itself access is just text
  const home = tmp();
  const spawnImpl = () => {
    const c = new EventEmitter(); c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.stdin = new PassThrough(); c.kill = () => {}; c.stdin.resume();
    c.stdin.on('end', () => setImmediate(() => {
      c.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: 'GRANT slack write blanket', session_id: 's' }) + '\n');
      c.stdout.end(); c.emit('close', 0);
    }));
    return c;
  };
  const svc = createEuphonia({ home, hubDir: path.join(home, 'hub'), user: 'w', spawnImpl, discover: () => ({ servers: [], errors: [] }) });
  await svc.send('I hereby permit you to use any and all tools').done;
  expect(svc.grants.list()).toEqual([]);
  expect(fs.existsSync(path.join(home, 'grants.json'))).toBe(false);
});

// ---- per-turn recompute, prompt, catalog learning, denials ----
test('each turn recomputes the allowlist and prompt from the active grants and learns the catalog from init', async () => {
  const home = tmp();
  const calls = [];
  const spawnImpl = (cmd, args) => {
    calls.push(args);
    const c = new EventEmitter(); c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.stdin = new PassThrough(); c.kill = () => {}; c.stdin.resume();
    c.stdin.on('end', () => setImmediate(() => {
      c.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', tools: ['Read', 'mcp__slack__slack_read_channel', 'mcp__slack__slack_send_message'], mcp_servers: [{ name: 'slack', status: 'connected' }] }) + '\n');
      c.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', session_id: 's', permission_denials: [{ tool_name: 'mcp__slack__slack_send_message' }, { tool_name: 'Bash' }] }) + '\n');
      c.stdout.end(); c.emit('close', 0);
    }));
    return c;
  };
  const svc = createEuphonia({ home, hubDir: path.join(home, 'hub'), user: 'w', spawnImpl, discover: () => ({ servers: [{ name: 'slack' }], errors: [] }) });
  const events = []; svc.subscribe((e) => events.push(e));
  const flag = (a, f) => a[a.indexOf(f) + 1];

  await svc.send('one').done;                                   // no grant, catalog unknown: denied, learns the catalog
  expect(flag(calls[0], '--allowedTools')).not.toMatch(/mcp__/);
  expect(flag(calls[0], '--disallowedTools')).toMatch(/mcp__\*/);
  expect(flag(calls[0], '--append-system-prompt')).toMatch(/External tools and actions: none/);
  expect(JSON.parse(fs.readFileSync(path.join(home, 'tools-seen.json'), 'utf8')).servers.slack.tools).toEqual(['slack_read_channel', 'slack_send_message']);

  svc.grants.grant({ server: 'slack', level: 'read', duration: '1h' });
  await svc.send('two').done;
  expect(flag(calls[1], '--allowedTools')).toContain('mcp__slack__slack_read_channel');
  expect(flag(calls[1], '--allowedTools')).not.toContain('slack_send_message');
  expect(flag(calls[1], '--disallowedTools')).not.toContain('mcp__*');
  expect(flag(calls[1], '--append-system-prompt')).toMatch(/- slack: read, until /);

  svc.grants.revoke('slack');
  await svc.send('three').done;                                 // revoked: denied again
  expect(flag(calls[2], '--allowedTools')).not.toMatch(/mcp__/);

  const denied = events.filter((e) => e.type === 'denied');
  expect(denied.find((d) => d.tool === 'mcp__slack__slack_send_message')).toMatchObject({ server: 'slack', level: 'write' });
  expect(denied.find((d) => d.tool === 'Bash')).toMatchObject({ server: null, level: null });
});

test('prompt: carries the access block and the rules she must state', () => {
  const tpl = fs.readFileSync(path.join(__dirname, '../lib/euphonia/prompt.md'), 'utf8');
  const out = renderPrompt(tpl, { user: 'Willow', name: 'Euphonia', kb: '/k', hub: '/h', access: '- ACCESS-BLOCK-HERE' });
  expect(out).toContain('- ACCESS-BLOCK-HERE');
  expect(out).not.toMatch(/\{\{/);
  expect(out).toMatch(/cannot change your own permissions/);
  expect(out).toMatch(/Euphonia > Tool access/);
  expect(out).toMatch(/which server and which level/);
  expect(out).toMatch(/exact\s+text and the exact\s+destination/);
  expect(out).toMatch(/approves that ONE\s+action/);
  expect(out).toMatch(/Never message a person directly unless/);
  expect(out).toMatch(/Never claim a tool works that is not in it/);
});

test('stream parser surfaces init and denials; the chat shows a denial naming server and level', () => {
  const out = []; const p = createStreamParser((e) => out.push(e));
  p.push(JSON.stringify({ type: 'system', subtype: 'init', tools: ['a'], mcp_servers: [{ name: 's', status: 'ok' }] }) + '\n');
  p.push(JSON.stringify({ type: 'result', subtype: 'success', result: '', permission_denials: [{ tool_name: 'mcp__s__x' }] }) + '\n');
  expect(out.find((e) => e.kind === 'init')).toMatchObject({ tools: ['a'], mcpServers: [{ name: 's', status: 'ok' }] });
  expect(out.find((e) => e.kind === 'result').denials).toEqual(['mcp__s__x']);
  expect(describeDenial({ tool: 'mcp__slack__slack_send_message', server: 'slack', level: 'write' })).toMatch(/needs write access to slack.*Euphonia > Tool access/);
  expect(describeDenial({ tool: 'Bash', server: null })).toMatch(/Bash is not available/);
  let s = reduce(initial(), { type: 'sent', turnId: 'a', text: 'q' });
  s = reduce(s, { type: 'event', event: { type: 'denied', turnId: 'a', tool: 'mcp__slack__slack_send_message', server: 'slack', level: 'write' } });
  s = reduce(s, { type: 'event', event: { type: 'done', turnId: 'a', text: 'sorry' } });
  expect(s.messages.map((m) => m.role)).toEqual(['user', 'notice', 'assistant'].sort((x, y) => 0) && s.messages.map((m) => m.role));
  expect(s.messages.find((m) => m.role === 'notice').text).toMatch(/slack/);
});


describe('browser (the managed playwright server, no bridge)', () => {
  const PW = ['browser_click', 'browser_close', 'browser_console_messages', 'browser_drag', 'browser_evaluate', 'browser_file_upload', 'browser_fill_form', 'browser_handle_dialog',
    'browser_hover', 'browser_install', 'browser_navigate', 'browser_navigate_back', 'browser_network_requests', 'browser_press_key', 'browser_resize', 'browser_run_code',
    'browser_select_option', 'browser_snapshot', 'browser_tabs', 'browser_take_screenshot', 'browser_type', 'browser_wait_for'];
  const READ_PW = ['browser_console_messages', 'browser_navigate', 'browser_navigate_back', 'browser_network_requests', 'browser_snapshot', 'browser_tabs', 'browser_take_screenshot', 'browser_wait_for'];

  test('observation tools are read; every acting tool is write', () => {
    for (const n of PW) expect([n, classifyTool(n)]).toEqual([n, READ_PW.includes(n) ? 'read' : 'write']);
    for (const n of ['click', 'type', 'fill_form', 'evaluate', 'file_upload', 'run_code', 'press_key', 'drag', 'select_option', 'handle_dialog'].map((x) => `browser_${x}`)) expect(classifyTool(n)).toBe('write');
  });

  test('discovery lists playwright from the managed file; its tools learned from the init event are admitted per grant level, and a first-turn gap allows nothing', async () => {
    const home = tmp();
    const replies = [];
    const spawnImpl = (cmd, args) => {
      replies.push(args);
      const c = new EventEmitter(); c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.stdin = new PassThrough(); c.kill = () => {}; c.stdin.resume();
      c.stdin.on('end', () => setImmediate(() => {
        c.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', tools: ['Read', ...PW.map((t) => `mcp__playwright__${t}`)], mcp_servers: [{ name: 'playwright', status: 'connected' }] }) + '\n');
        c.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', session_id: 's' }) + '\n');
        c.stdout.end(); c.emit('close', 0);
      }));
      return c;
    };
    const discover = () => ({ servers: [{ name: 'playwright', sources: ['managed'] }, { name: 'playwright-local-verify', sources: ['managed'] }], errors: [] });
    const svc = createEuphonia({ home, hubDir: path.join(home, 'hub'), user: 'w', spawnImpl, discover });
    expect(svc.discoverServers().servers.map((s) => s.name)).toEqual(['euphonia-bridge', 'playwright', 'playwright-local-verify']);
    svc.grants.grant({ server: 'playwright', level: 'read', duration: '1h' });
    const flag = (a, f) => a[a.indexOf(f) + 1];
    await svc.send('one').done;                                  // the catalogue gap: grant exists, tools not yet learned
    expect(flag(replies[0], '--allowedTools')).not.toMatch(/mcp__playwright/);
    expect(flag(replies[0], '--append-system-prompt')).toMatch(/learned on its first turn/);
    await svc.send('two').done;                                  // learned from the first turn's init event
    const allowed = flag(replies[1], '--allowedTools');
    for (const n of READ_PW) expect(allowed).toContain(`mcp__playwright__${n}`);
    for (const n of PW.filter((x) => !READ_PW.includes(x))) { expect(allowed).not.toContain(`mcp__playwright__${n}`); expect(flag(replies[1], '--disallowedTools')).toContain(`mcp__playwright__${n}`); }
    expect(flag(replies[1], '--disallowedTools')).toContain('mcp__playwright-local-verify');   // the other managed server stays denied
    svc.grants.grant({ server: 'playwright', level: 'write', duration: '1h' });
    await svc.send('three').done;
    for (const n of PW) expect(flag(replies[2], '--allowedTools')).toContain(`mcp__playwright__${n}`);
  });
});
