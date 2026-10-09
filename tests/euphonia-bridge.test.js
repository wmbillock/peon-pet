const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { classifyTool } = require('../lib/euphonia/tool-class');
const { createTools, createRunner, grantAllows, SERVER, ASSISTANT_PREFIX } = require('../lib/euphonia/bridge/tools');
const gh = require('../lib/euphonia/bridge/gh');
const { createAudit } = require('../lib/euphonia/bridge/audit');
const { createFirmHttp } = require('../lib/euphonia/bridge/firm-http');
const { sendOnce, frame, parseFrames, GUID } = require('../lib/euphonia/bridge/ws-client');
const { applyCosmetics } = require('../lib/euphonia/bridge/cosmetics');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brg-'));
const READ = ['firm_get_status', 'firm_list_inbox', 'firm_get_workstream', 'firm_list_events', 'github_view_pr', 'github_list_prs', 'github_list_issues', 'github_check_pr', 'github_firm_pr_watch'];
const WRITE = ['firm_send_to_management', 'firm_respond_inbox', 'firm_file_task', 'pet_set_cosmetics'];

test('every bridge tool name classifies as intended, so a read grant cannot reach a write tool', () => {
  for (const n of READ) expect([n, classifyTool(n), classifyTool(`mcp__euphonia-bridge__${n}`)]).toEqual([n, 'read', 'read']);
  for (const n of WRITE) expect([n, classifyTool(n)]).toEqual([n, 'write']);
  expect(createTools({ firm: {}, ghRun: async () => '', cosmetics: () => ({}) }).map((d) => d.name).sort()).toEqual([...READ, ...WRITE].sort());
});

// ---- fakes ----
function setup({ grants = [], ghOut = {} } = {}) {
  const home = tmp();
  const calls = { firm: [], gh: [], cosmetics: [] };
  const firm = {
    workstreams: async () => [{ id: 'ws_1', title: 'T', status: 'active', counts: { done: 1 }, cost_usd: 1.5, secret: 'x' }],
    inbox: async () => [{ id: 'i1', kind: 'plan_ok' }],
    workstream: async (id) => ({ id }),
    events: async ({ sinceId = 0, limit = 100, latest = false } = {}) => { calls.firm.push(['events', latest ? 'latest' : sinceId, limit]); return EVENTS.filter((e) => latest || e.id > sinceId).slice(latest ? -limit : 0, latest ? undefined : limit); },
    prs: async () => FIRM_PRS,
    sendToManagement: async (text) => { calls.firm.push(['send', text]); return { sent: true, notes: [] }; },
    respondInbox: async (id, action, text) => { calls.firm.push(['respond', id, action, text]); return { ok: true }; },
  };
  const ghRun = async (args) => { calls.gh.push(args); return ghOut[args[0] + ':' + args[1]] ?? '[]'; };
  const cosmetics = (patch) => { calls.cosmetics.push(patch); return { changed: Object.keys(patch) }; };
  const defs = createTools({ firm, ghRun, cosmetics });
  const audit = createAudit({ file: path.join(home, 'bridge-audit.jsonl') });
  let granted = grants;
  const call = createRunner({ defs, readGrants: () => granted, audit });
  return { call, calls, home, audit, setGrants: (g) => { granted = g; }, auditLines: () => (fs.existsSync(audit.file) ? fs.readFileSync(audit.file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []) };
}
const G = (level, expires_at = null) => [{ server: SERVER, level, expires_at }];
const EVENTS = [
  { id: 1, ts: '2026-10-07T10:00:00Z', kind: 'user_message', actor: 'user', target_agent: 'management', payload: { text: 'hi' }, delivered_at: '2026-10-07T10:00:01Z', acked_at: null },
  { id: 2, ts: '2026-10-07T11:00:00Z', kind: 'bead_done', actor: 'lead:ws_1', target_agent: 'management', payload: { workstream_id: 'ws_1' }, delivered_at: null, acked_at: null },
  { id: 3, ts: '2026-10-07T12:00:00Z', kind: 'pr_opened', actor: 'scheduler', target_agent: null, payload: { workstream_id: 'ws_2', pr_url: 'u' }, delivered_at: null, acked_at: null },
];
const FIRM_PRS = [
  { workstream_id: 'ws_1', title: 'Pixoo', pr_number: '7', branch: 'firm/ws_1', base_branch: 'pricing/the-firm/develop', status: 'running', pr_state: 'open', merged_at: null },
  { workstream_id: 'ws_2', title: 'Old', pr_number: '8', branch: 'firm/ws_2', base_branch: 'main', status: 'running', pr_state: 'open', merged_at: null },
  { workstream_id: 'ws_3', title: 'Done', pr_number: '9', branch: 'firm/ws_3', base_branch: 'main', status: 'done', pr_state: 'merged', merged_at: '2026-10-01T00:00:00Z' },
];

describe('grant enforcement inside the bridge', () => {
  test('no grant: every tool is refused and nothing is called', async () => {
    const s = setup();
    for (const n of [...READ, ...WRITE]) expect((await s.call(n, { id: 'a', number: 1, label: 'the-firm', text: 'x', title: 't', body: 'b', action: 'reply', name: 'n' })).isError).toBe(true);
    expect(s.calls).toEqual({ firm: [], gh: [], cosmetics: [] });
    expect(s.auditLines().every((l) => l.status === 'refused')).toBe(true);
  });
  test('expired grant is refused; unexpired works', async () => {
    const s = setup({ grants: G('write', '2000-01-01T00:00:00.000Z') });
    expect((await s.call('firm_list_inbox')).isError).toBe(true);
    s.setGrants(G('read', new Date(Date.now() + 60000).toISOString()));
    expect((await s.call('firm_list_inbox')).isError).toBe(false);
  });
  test('a read grant cannot call a write tool; a write grant can call both', async () => {
    const s = setup({ grants: G('read') });
    const r = await s.call('firm_send_to_management', { text: 'hi' });
    expect(r.isError).toBe(true); expect(r.text).toMatch(/only a read grant/);
    expect(s.calls.firm).toEqual([]);
    s.setGrants(G('write'));
    expect((await s.call('firm_send_to_management', { text: 'hi' })).isError).toBe(false);
    expect((await s.call('firm_list_inbox')).isError).toBe(false);
  });
  test('a grant for another server does not count; unknown tools are refused', async () => {
    const s = setup({ grants: [{ server: 'slack', level: 'write', expires_at: null }] });
    expect((await s.call('firm_list_inbox')).isError).toBe(true);
    s.setGrants(G('write'));
    expect((await s.call('rm_rf')).text).toMatch(/Unknown tool/);
    expect(grantAllows([], 'read').ok).toBe(false);
  });
  test('a write whose attempt cannot be audited is refused', async () => {
    const s = setup({ grants: G('write') });
    fs.writeFileSync(path.join(s.home, 'blocker'), 'file');
    const defs = createTools({ firm: { sendToManagement: async () => { throw new Error('must not run'); } }, ghRun: async () => '', cosmetics: () => ({}) });
    const call = createRunner({ defs, readGrants: () => G('write'), audit: createAudit({ file: path.join(s.home, 'blocker', 'x', 'audit.jsonl') }) });
    const r = await call('firm_send_to_management', { text: 'hi' });
    expect(r.isError).toBe(true); expect(r.text).toMatch(/audit log could not be written/);
  });
});

describe('tools', () => {
  test('read tools return what the Firm and gh returned', async () => {
    const s = setup({ grants: G('read'), ghOut: { 'pr:view': '{"number":7,"state":"OPEN"}' } });
    const st = JSON.parse((await s.call('firm_get_status')).text);
    expect(st.workstreams[0]).toEqual({ id: 'ws_1', title: 'T', status: 'active', counts: { done: 1 }, cost_usd: 1.5 });
    expect(st.inbox_waiting).toBe(1);
    expect(JSON.parse((await s.call('firm_get_workstream', { id: 'ws_1' })).text)).toEqual({ id: 'ws_1' });
    expect(JSON.parse((await s.call('github_view_pr', { number: 7 })).text)).toEqual({ number: 7, state: 'OPEN' });
    await s.call('github_list_prs', { state: 'merged', limit: 5 });
    await s.call('github_list_issues', { label: 'the-firm' });
    const chk = JSON.parse((await s.call('github_check_pr', { number: 7 })).text);
    expect(chk).toEqual({ pr: { number: 7, state: 'OPEN' }, checks: [] });   // the PR's base/head/state come with its checks
    expect(s.calls.gh.map((a) => a.slice(0, 2).join(' ')).sort()).toEqual(['issue list', 'pr checks', 'pr list', 'pr view', 'pr view'].sort());
    for (const cmd of [gh.commands.viewPr({ number: 1 }), gh.commands.listPrs(), gh.commands.listFirmPrs()]) {
      const fields = cmd[cmd.indexOf('--json') + 1].split(',');
      for (const f of ['baseRefName', 'headRefName', 'state', 'isDraft', 'mergeStateStatus', 'reviewDecision', 'statusCheckRollup']) expect(fields).toContain(f);
    }
  });
  test('firm_list_events: newest by default, after an id, after a timestamp, filtered to a workstream; the actor comes through', async () => {
    const s = setup({ grants: G('read') });
    expect(JSON.parse((await s.call('firm_list_events')).text).map((e) => [e.id, e.actor])).toEqual([[1, 'user'], [2, 'lead:ws_1'], [3, 'scheduler']]);
    expect(JSON.parse((await s.call('firm_list_events', { since: 1 })).text).map((e) => e.id)).toEqual([2, 3]);
    expect(JSON.parse((await s.call('firm_list_events', { since: '2026-10-07T11:30:00Z' })).text).map((e) => e.id)).toEqual([3]);
    expect(JSON.parse((await s.call('firm_list_events', { workstream: 'ws_2' })).text).map((e) => e.id)).toEqual([3]);
    for (const bad of [{ since: 'yesterday' }, { limit: 0 }, { limit: 501 }, { workstream: 'a;b' }]) expect((await s.call('firm_list_events', bad)).isError).toBe(true);
  });
  test("github_firm_pr_watch: The Firm's open PRs read live from gh, flagged when the base is not the Firm develop branch; merged ones skipped", async () => {
    const views = { '7': '{"number":7,"state":"OPEN","baseRefName":"pricing/the-firm/develop","headRefName":"firm/ws_1","isDraft":false}', '8': '{"number":8,"state":"OPEN","baseRefName":"main","headRefName":"firm/ws_2","isDraft":true,"url":"u8"}' };
    const s = setup({ grants: G('read') });
    s.ghRun = null;
    const defs = createTools({ firm: { prs: async () => FIRM_PRS }, ghRun: async (args) => { s.calls.gh.push(args); return views[args[2]]; }, cosmetics: () => ({}) });
    const call = createRunner({ defs, readGrants: () => G('read'), audit: s.audit });
    const r = JSON.parse((await call('github_firm_pr_watch')).text);
    expect(r.source).toBe('the-firm /api/prs');
    expect(r.prs.map((p) => [p.number, p.workstream_id])).toEqual([[7, 'ws_1'], [8, 'ws_2']]);
    expect(r.flagged).toEqual([{ number: 8, baseRefName: 'main', headRefName: 'firm/ws_2', url: 'u8', problem: 'base is main, not pricing/the-firm/develop' }]);
    expect(r.note).toMatch(/1 PR\(s\) are not based on pricing\/the-firm\/develop/);
    // The Firm unreachable: gh pr list, filtered to the-firm label or a Firm branch
    const list = JSON.stringify([{ number: 1, baseRefName: 'main', headRefName: 'firm/x', labels: [] }, { number: 2, baseRefName: 'pricing/the-firm/develop', headRefName: 'feat/y', labels: [{ name: 'the-firm' }] }, { number: 3, baseRefName: 'main', headRefName: 'feat/z', labels: [] }]);
    const defs2 = createTools({ firm: { prs: async () => { throw new Error('ECONNREFUSED'); } }, ghRun: async () => list, cosmetics: () => ({}) });
    const r2 = JSON.parse((await createRunner({ defs: defs2, readGrants: () => G('read'), audit: s.audit })('github_firm_pr_watch')).text);
    expect(r2.source).toMatch(/gh pr list.*ECONNREFUSED/);
    expect(r2.prs.map((p) => p.number)).toEqual([1, 2]);
    expect(r2.flagged.map((p) => p.number)).toEqual([1]);
  });
  test('[Assistant] prefix on messages to Management and on inbox responses', async () => {
    const s = setup({ grants: G('write') });
    await s.call('firm_send_to_management', { text: 'please plan X' });
    await s.call('firm_respond_inbox', { id: 'i1', action: 'reply', text: 'use option B' });
    await s.call('firm_respond_inbox', { id: 'i1', action: 'approve' });
    expect(s.calls.firm).toEqual([
      ['send', '[Assistant] please plan X'],
      ['respond', 'i1', 'reply', '[Assistant] use option B'],
      ['respond', 'i1', 'approve', '[Assistant] relayed by the assistant'],
    ]);
    expect(ASSISTANT_PREFIX).toBe('[Assistant] ');
    const refusing = createTools({ firm: { sendToManagement: async () => ({ sent: true, notes: ['Management is busy'] }) }, ghRun: async () => '', cosmetics: () => ({}) });
    const r = await createRunner({ defs: refusing, readGrants: () => G('write'), audit: s.audit })('firm_send_to_management', { text: 'x' });
    expect(r.isError).toBe(true); expect(r.text).toMatch(/refused the message: Management is busy/);
  });
  test('firm_file_task creates a labelled issue with fixed arguments and returns the URL', async () => {
    const s = setup({ grants: G('write'), ghOut: { 'issue:create': 'https://github.com/Affirm/affirm-builders/issues/4321\n' } });
    const r = await s.call('firm_file_task', { title: 'Add X; $(rm -rf /) `x`', body: 'details | & > file' });
    expect(JSON.parse(r.text)).toEqual({ url: 'https://github.com/Affirm/affirm-builders/issues/4321' });
    const args = s.calls.gh[0];
    expect(args.slice(0, 4)).toEqual(['issue', 'create', '--repo', 'Affirm/affirm-builders']);
    expect(args).toContain('--label=the-firm');
    expect(args.find((a) => a.startsWith('--title='))).toBe('--title=Add X; $(rm -rf /) `x`');   // data in one argument, never a shell string
    expect(args.length).toBe(7);
  });
  test('no issue URL back means failure, not a claimed success', async () => {
    const s = setup({ grants: G('write'), ghOut: { 'issue:create': 'ok' } });
    const r = await s.call('firm_file_task', { title: 't', body: 'b' });
    expect(r.isError).toBe(true);
  });
  test('pet_set_cosmetics passes only the four cosmetic keys', async () => {
    const s = setup({ grants: G('write') });
    expect((await s.call('pet_set_cosmetics', { name: 'Nova', soundPack: 'x' })).isError).toBe(false);
    expect(s.calls.cosmetics).toEqual([{ name: 'Nova', soundPack: 'x' }]);
    for (const bad of [{ restricted: false }, { grants: [] }, { voiceFocus: 'all' }, { openChatOnLaunch: true }, {}]) expect((await s.call('pet_set_cosmetics', bad)).isError).toBe(true);
    expect(s.calls.cosmetics).toHaveLength(1);
  });
  test('bad arguments are rejected before anything runs', async () => {
    const s = setup({ grants: G('write') });
    for (const [n, a] of [['firm_respond_inbox', { id: 'i1', action: 'rm -rf' }], ['firm_respond_inbox', { id: '../x', action: 'reply' }], ['firm_get_workstream', { id: 'a;b' }],
      ['firm_send_to_management', { text: '' }], ['firm_send_to_management', { text: 'x'.repeat(5000) }]]) {
      expect([n, (await s.call(n, a)).isError]).toEqual([n, true]);
    }
    expect(s.calls.firm).toEqual([]);
  });
});

describe('gh argument validation', () => {
  test('numbers only; no shell metacharacters; wrong repo is not an input; label is allow-listed', () => {
    for (const bad of ['12;rm -rf /', '$(id)', '1 2', '-1', '1.5', 0, -3, '', null, undefined, '`x`', 'abc', 1e9]) expect(() => gh.commands.viewPr({ number: bad })).toThrow();
    expect(gh.commands.viewPr({ number: '42' })).toEqual(['pr', 'view', '42', '--repo', 'Affirm/affirm-builders', '--json', expect.any(String)]);
    expect(gh.commands.viewPr({ number: 42, repo: 'evil/other' })).toContain('Affirm/affirm-builders');
    expect(gh.commands.viewPr({ number: 42, repo: 'evil/other' })).not.toContain('evil/other');
    for (const bad of ['bug', 'the-firm;ls', '', undefined, '--all']) expect(() => gh.commands.listIssues({ label: bad })).toThrow();
    expect(() => gh.commands.listPrs({ state: 'all; echo' })).toThrow();
    expect(() => gh.commands.listPrs({ limit: 500 })).toThrow();
    expect(() => gh.commands.createIssue({ title: '', body: 'b' })).toThrow();
    expect(() => gh.commands.createIssue({ title: 't', body: 'x'.repeat(10001) })).toThrow();
    for (const f of [gh.commands.viewPr({ number: 1 }), gh.commands.listPrs(), gh.commands.listIssues({ label: 'the-firm' }), gh.commands.prChecks({ number: 1 }), gh.commands.createIssue({ title: 't', body: 'b' })]) {
      expect(f).not.toContain('api');
      expect(f[0] === 'pr' || f[0] === 'issue').toBe(true);
    }
  });
  test('the runner never uses a shell', async () => {
    let opts;
    await gh.createGhRunner({ execFileImpl: (cmd, args, o, cb) => { opts = { cmd, o }; cb(null, 'out', ''); } })(['pr', 'list']);
    expect(opts.cmd).toBe('gh'); expect(opts.o.shell).toBe(false);
    await expect(gh.createGhRunner({ execFileImpl: (c, a, o, cb) => cb(new Error('x'), '', 'not logged in\nmore') })(['pr'])).rejects.toThrow(/gh failed: not logged in/);
  });
});

describe('audit', () => {
  test('every call is logged with a validated summary; free text by length only; no bodies', async () => {
    const s = setup({ grants: G('write'), ghOut: { 'issue:create': 'https://github.com/Affirm/affirm-builders/issues/9' } });
    await s.call('firm_send_to_management', { text: 'super secret token abc123' });
    await s.call('firm_file_task', { title: 'secret title', body: 'secret body' });
    await s.call('github_view_pr', { number: 3 });
    s.setGrants([]);
    await s.call('firm_list_inbox');
    const lines = s.auditLines();
    expect(lines.map((l) => [l.tool, l.status])).toEqual([
      ['firm_send_to_management', 'attempt'], ['firm_send_to_management', 'ok'],
      ['firm_file_task', 'attempt'], ['firm_file_task', 'ok'], ['github_view_pr', 'ok'], ['firm_list_inbox', 'refused'],
    ]);
    expect(lines.find((l) => l.tool === 'firm_send_to_management').args).toEqual({ text: { chars: 25 } });
    expect(lines[0].args).toEqual({ text: { chars: 25 } });
    expect(fs.readFileSync(s.audit.file, 'utf8')).not.toMatch(/secret|abc123/);
    expect(lines.every((l) => typeof l.ts === 'string')).toBe(true);
    expect((fs.statSync(s.audit.file).mode & 0o777).toString(8)).toBe('600');
  });
});

describe('Firm HTTP + WebSocket', () => {
  // A fake Firm with the live guard: reads are open; GET /api/session hands out TOKEN; a write without X-Firm-Token is 403.
  const TOKEN = 'tok-live-1';
  function fakeFirmServer({ replyAfterMs = 0 } = {}) {
    const state = { events: [{ id: 10, ts: 't0', kind: 'bead_done', actor: 'lead:ws_1', target_agent: 'management', payload: {}, delivered_at: null, acked_at: null }], msgs: [], seen: [] };
    const fetchImpl = async (url, init = {}) => {
      const u = new URL(url);
      state.seen.push([init.method || 'GET', u.pathname + u.search, init.headers && init.headers['X-Firm-Token'], init.body]);
      const ok = (body) => ({ ok: true, status: 200, json: async () => body });
      if (u.pathname === '/api/events') {
        const since = Number(u.searchParams.get('since_id') || 0), limit = Number(u.searchParams.get('limit') || 100);
        return ok(u.searchParams.get('latest') ? state.events.slice(-limit) : state.events.filter((e) => e.id > since).slice(0, limit));
      }
      if (u.pathname === '/api/threads/management/messages') return ok(state.msgs);
      if (u.pathname === '/api/session') return ok({ token: TOKEN });
      if (u.pathname.startsWith('/api/inbox/') && u.pathname.endsWith('/respond')) {
        if (!init.headers || init.headers['X-Firm-Token'] !== TOKEN) return { ok: false, status: 403, json: async () => ({ detail: 'missing or wrong token' }) };
        const { action, text } = JSON.parse(init.body);
        const sent = action === 'dismiss' ? null : `[Inbox] ${action}: ${text}`;
        if (sent) state.userSent(sent);
        return ok({ sent, item: null });
      }
      return ok({ ok: true, path: u.pathname });
    };
    state.userSent = (text) => {
      const id = state.events[state.events.length - 1].id + 1;
      state.events.push({ id, ts: `t${id}`, kind: 'user_message', actor: 'user', target_agent: 'management', payload: { text }, delivered_at: `d${id}`, acked_at: null });
      state.msgs.push({ type: 'text', role: 'user', text, audience: 'chat' });
      setTimeout(() => state.msgs.push({ type: 'text', role: 'assistant', text: `Noted: ${text.slice(0, 20)}`, audience: 'chat' }), replyAfterMs);
    };
    return { state, fetchImpl };
  }

  test('reads carry no token; inbox respond fetches the session token, posts { action, text } with X-Firm-Token and returns the receipt', async () => {
    const { state, fetchImpl } = fakeFirmServer();
    const f = createFirmHttp({ fetchImpl, sleep: () => new Promise((r) => setTimeout(r, 1)), receiptWaitMs: 500, receiptStepMs: 1 });
    await f.workstreams(); await f.inbox(); await f.workstream('ws_28b136'); await f.prs(); await f.events({ sinceId: 3, limit: 5 });
    expect(state.seen.map((x) => x.slice(0, 3))).toEqual([
      ['GET', '/api/workstreams', undefined], ['GET', '/api/inbox', undefined], ['GET', '/api/workstreams/ws_28b136', undefined], ['GET', '/api/prs', undefined], ['GET', '/api/events?since_id=3&limit=5', undefined],
    ]);
    expect(state.seen.some((x) => x[1].includes('session'))).toBe(false);   // reads never fetch a token
    const r = await f.respondInbox('item:1', 'reply', '[Assistant] hi');
    const post = state.seen.find((x) => x[0] === 'POST');
    expect(state.seen.slice(state.seen.indexOf(post) - 2, state.seen.indexOf(post)).map((x) => x[1])).toEqual(['/api/events?latest=1&limit=1', '/api/session']);   // events cursor, then the token, for the write only
    expect(post).toEqual(['POST', '/api/inbox/item%3A1/respond', TOKEN, JSON.stringify({ action: 'reply', text: '[Assistant] hi' })]);
    expect(r.sent).toBe('[Inbox] reply: [Assistant] hi');
    expect(r.receipt).toMatchObject({ event_id: 11, delivered_at: 'd11' });
    expect(r.reply).toMatch(/^Noted: /);
    expect(() => f.workstream('../x')).toThrow();
    expect(() => f.events({ limit: 501 })).toThrow(/limit/);
    expect(() => createFirmHttp({ baseUrl: 'http://example.com:8420' })).toThrow(/localhost/);
    const bad = createFirmHttp({ fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ detail: 'Inbox item x is no longer open' }) }) });
    await expect(bad.inbox()).rejects.toThrow(/HTTP 404: Inbox item x is no longer open/);
  });

  // The live guard on the socket: an allowed Origin and `firm-token.<TOKEN>` among the subprotocols, else 403 before accept.
  function firmSocketServer(state, got) {
    const server = http.createServer();
    server.on('upgrade', (req, socket) => {
      socket.on('error', () => {});
      got.origin = req.headers.origin; got.proto = req.headers['sec-websocket-protocol']; got.path = req.url;
      const protos = String(got.proto || '').split(',').map((p) => p.trim());
      if (!got.origin || !protos.includes(`firm-token.${TOKEN}`)) { got.refused = (got.refused || 0) + 1; socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); setTimeout(() => socket.end(), 50); return; }
      const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: firm\r\n\r\n`);
      const serverFrame = (o) => { const b = Buffer.from(JSON.stringify(o)); return Buffer.concat([Buffer.from([0x81, b.length]), b]); };
      socket.write(serverFrame({ type: 'status' }));   // history replay + status frame come first
      let buf = Buffer.alloc(0);
      socket.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        if (buf.length < 6 || (buf[0] & 0x0f) !== 1) return;
        const len = buf[1] & 0x7f; const mask = buf.slice(2, 6); const body = Buffer.from(buf.slice(6, 6 + len).map((c, i) => c ^ mask[i % 4]));
        got.message = JSON.parse(body.toString());
        state.userSent(got.message.text);   // the server records it; it sends no ack
        socket.write(serverFrame({ type: 'text', role: 'user', text: got.message.text, audience: 'chat' }));
      });
    });
    return server;
  }

  test('sendToManagement: Origin and the token subprotocol, one message frame; the receipt is the user_message event and the reply follows', async () => {
    const got = {};
    const { state, fetchImpl } = fakeFirmServer();
    const server = firmSocketServer(state, got);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const f = createFirmHttp({ baseUrl: base, fetchImpl, wsSend: (o) => sendOnce({ ...o, quietMs: 60, listenMs: 250 }), sleep: () => new Promise((r) => setTimeout(r, 1)), receiptWaitMs: 500, receiptStepMs: 1 });
    const r = await f.sendToManagement('[Assistant] hello');
    server.close();
    expect(got.origin).toBe(base);
    expect(got.proto).toBe(`firm, firm-token.${TOKEN}`);
    expect(got.path).toBe('/ws/threads/management');
    expect(got.message).toEqual({ type: 'message', text: '[Assistant] hello' });
    expect(r).toMatchObject({ sent: true, notes: [], receipt: { event_id: 11, ts: 't11', delivered_at: 'd11', acked_at: null }, reply: 'Noted: [Assistant] hello' });
    expect(state.seen.filter((x) => x[1].startsWith('/api/events?since_id=10'))).not.toHaveLength(0);   // polled from the id seen before the send
  });

  test('positive control: without the token subprotocol the socket is refused with 403, nothing is sent, and the action fails with a clear message', async () => {
    const got = {};
    const { state, fetchImpl } = fakeFirmServer();
    const server = firmSocketServer(state, got);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    // the token-less client shape (what the Oct 2 reading of The Firm produced): refused before accept
    await expect(sendOnce({ origin: base, path: '/ws/threads/management', token: 'wrong', text: 'x', quietMs: 20, listenMs: 50 })).rejects.toThrow(/refused the chat socket \(HTTP 403\): the session token or the Origin was not accepted; nothing was sent/);
    await expect(sendOnce({ origin: base, path: '/ws/threads/management', text: 'x' })).rejects.toThrow(/needs a session token/);
    expect(got.refused).toBe(1);
    expect(got.message).toBeUndefined();
    expect(state.events.some((e) => e.kind === 'user_message')).toBe(false);
    // through the action runner: a Firm that hands out a stale token makes the write fail, audited, never "sent"
    const stale = createFirmHttp({ baseUrl: base, fetchImpl: async (url, init) => (new URL(url).pathname === '/api/session' ? { ok: true, status: 200, json: async () => ({ token: 'stale' }) } : fetchImpl(url, init)), wsSend: (o) => sendOnce({ ...o, quietMs: 20, listenMs: 50 }) });
    const defs = createTools({ firm: stale, ghRun: async () => '', cosmetics: () => ({}) });
    const home = tmp();
    const r = await createRunner({ defs, readGrants: () => G('write'), audit: createAudit({ file: path.join(home, 'a.jsonl') }) })('firm_send_to_management', { text: 'hello' });
    server.close();
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^Failed: The Firm refused the chat socket \(HTTP 403\)/);
    // and the inbox respond POST without the header is 403 too
    const bare = createFirmHttp({ fetchImpl: async (url, init) => (new URL(url).pathname === '/api/session' ? { ok: true, status: 200, json: async () => ({}) } : fetchImpl(url, init)) });
    await expect(bare.respondInbox('i1', 'reply', 'x')).rejects.toThrow(/gave no session token/);
    const direct = await fetchImpl(`${base}/api/inbox/i1/respond`, { method: 'POST', headers: {}, body: JSON.stringify({ action: 'reply', text: 'x' }) });
    expect(direct.status).toBe(403);
  });

  test('a refusal notice after the send means no receipt; a reply that never comes stays pending', async () => {
    const { fetchImpl } = fakeFirmServer({ replyAfterMs: 10000 });
    const f = createFirmHttp({ fetchImpl, wsSend: async () => ({ sent: true, notes: ['This lead takes direction from Management only'] }), sleep: async () => {}, receiptWaitMs: 1, receiptStepMs: 1 });
    expect(await f.sendToManagement('x')).toMatchObject({ sent: true, notes: ['This lead takes direction from Management only'], receipt: null, reply: null });
    const g = createFirmHttp({ fetchImpl, wsSend: async () => ({ sent: true, notes: [] }), sleep: async () => {}, receiptWaitMs: 1, receiptStepMs: 1 });
    expect(await g.sendToManagement('never recorded')).toMatchObject({ sent: true, receipt: null, reply: 'pending' });
  });

  test('frame helpers round-trip', () => {
    const f = frame(1, 'héllo');
    expect((f[1] & 0x80) !== 0).toBe(true);   // client frames are masked
    const srv = Buffer.concat([Buffer.from([0x81, 5]), Buffer.from('hello')]);
    expect(parseFrames(Buffer.concat([srv, srv.slice(0, 3)]))).toMatchObject({ frames: [{ opcode: 1, text: 'hello' }], rest: srv.slice(0, 3) });
  });
});

describe('cosmetics', () => {
  test('validated, local config only, only the four keys', () => {
    const dir = tmp();
    const peon = path.join(dir, 'peon'); fs.mkdirSync(path.join(peon, 'packs/ok'), { recursive: true }); fs.writeFileSync(path.join(peon, 'packs/ok/openpeon.json'), '{}');
    const assets = path.join(dir, 'assets'); fs.mkdirSync(assets); fs.writeFileSync(path.join(assets, 'kirby-sprite-atlas.png'), 'x');
    const cfgFile = path.join(dir, 'config.json'); fs.writeFileSync(cfgFile, JSON.stringify({ name: 'Euphonia', restricted: true, openChatOnLaunch: false }));
    const ctx = { configFile: cfgFile, peonDir: peon, assetsDir: assets, userDataDir: path.join(dir, 'ud') };
    expect(applyCosmetics({ ...ctx, patch: { name: ' Nova ', soundPack: 'ok', species: 'kirby', border: 'neon-pink' } }).changed).toEqual(['name', 'soundPack', 'border', 'species']);
    expect(JSON.parse(fs.readFileSync(cfgFile, 'utf8'))).toEqual({ name: 'Nova', restricted: true, openChatOnLaunch: false, soundPack: 'ok', border: 'neon-pink', species: 'kirby' });
    for (const bad of [{ soundPack: 'missing' }, { soundPack: '../x' }, { species: 'nope' }, { species: '../../etc' }, { name: '' }, { name: 'x'.repeat(40) }, { border: 'a b' }]) expect(() => applyCosmetics({ ...ctx, patch: bad })).toThrow();
    expect(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).restricted).toBe(true);
  });
});
