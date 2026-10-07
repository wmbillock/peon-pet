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
const READ = ['firm_get_status', 'firm_list_inbox', 'firm_get_workstream', 'github_view_pr', 'github_list_prs', 'github_list_issues', 'github_check_pr'];
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
    now: async () => ({ ws_1: 'working' }), inbox: async () => [{ id: 'i1', kind: 'plan_ok' }],
    workstream: async (id) => ({ id }),
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
    expect(JSON.parse((await s.call('firm_get_status')).text).workstreams[0]).toEqual({ id: 'ws_1', title: 'T', status: 'active', counts: { done: 1 }, cost_usd: 1.5 });
    expect(JSON.parse((await s.call('firm_get_workstream', { id: 'ws_1' })).text)).toEqual({ id: 'ws_1' });
    expect(JSON.parse((await s.call('github_view_pr', { number: 7 })).text)).toEqual({ number: 7, state: 'OPEN' });
    await s.call('github_list_prs', { state: 'merged', limit: 5 });
    await s.call('github_list_issues', { label: 'the-firm' });
    await s.call('github_check_pr', { number: 7 });
    expect(s.calls.gh.map((a) => a.slice(0, 2).join(' '))).toEqual(['pr view', 'pr list', 'issue list', 'pr checks']);
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
    expect(lines[0].args).toEqual({ text: { chars: 25 } });
    expect(fs.readFileSync(s.audit.file, 'utf8')).not.toMatch(/secret|abc123/);
    expect(lines.every((l) => typeof l.ts === 'string')).toBe(true);
    expect((fs.statSync(s.audit.file).mode & 0o777).toString(8)).toBe('600');
  });
});

describe('Firm HTTP + WebSocket', () => {
  test('reads need no token; inbox respond fetches the session token first; ids are validated; non-loopback refused', async () => {
    const seen = [];
    const fetchImpl = async (url, init = {}) => {
      seen.push([init.method || 'GET', url.replace('http://127.0.0.1:8420', ''), init.headers && init.headers['X-Firm-Token'], init.body]);
      return { ok: true, status: 200, json: async () => (url.endsWith('/api/session') ? { token: 'tok' } : { ok: true }) };
    };
    const f = createFirmHttp({ fetchImpl });
    await f.workstreams(); await f.inbox(); await f.workstream('ws_28b136');
    await f.respondInbox('item:1', 'reply', '[Assistant] hi');
    expect(seen).toEqual([
      ['GET', '/api/workstreams', undefined, undefined], ['GET', '/api/inbox', undefined, undefined], ['GET', '/api/workstreams/ws_28b136', undefined, undefined],
      ['GET', '/api/session', undefined, undefined], ['POST', '/api/inbox/item%3A1/respond', 'tok', JSON.stringify({ action: 'reply', text: '[Assistant] hi' })],
    ]);
    expect(() => f.workstream('../x')).toThrow();
    expect(() => createFirmHttp({ baseUrl: 'http://example.com:8420' })).toThrow(/localhost/);
    const bad = createFirmHttp({ fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ detail: 'missing or wrong token' }) }) });
    await expect(bad.inbox()).rejects.toThrow(/HTTP 401: missing or wrong token/);
  });

  test('sendToManagement uses the token subprotocol and an allowed Origin (local socket only)', async () => {
    const got = {};
    const server = http.createServer();
    server.on('upgrade', (req, socket) => {
      socket.on('error', () => {});   // the client hangs up right after its quiet period
      got.origin = req.headers.origin; got.proto = req.headers['sec-websocket-protocol']; got.path = req.url;
      const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: firm\r\n\r\n`);
      const serverFrame = (o) => { const b = Buffer.from(JSON.stringify(o)); return Buffer.concat([Buffer.from([0x81, b.length]), b]); };
      socket.write(serverFrame({ type: 'status' }));   // history replay
      let buf = Buffer.alloc(0);
      socket.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        if (buf.length < 6 || (buf[0] & 0x0f) !== 1) return;
        const len = buf[1] & 0x7f; const mask = buf.slice(2, 6); const body = Buffer.from(buf.slice(6, 6 + len).map((c, i) => c ^ mask[i % 4]));
        got.message = JSON.parse(body.toString());
        socket.write(serverFrame({ type: 'system', text: 'Management is busy', audience: 'chat' }));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    const f = createFirmHttp({ baseUrl: base, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ token: 'tok-1' }) }), wsSend: (o) => sendOnce({ ...o, quietMs: 60, listenMs: 250 }) });
    const r = await f.sendToManagement('[Assistant] hello');
    server.close();
    expect(got.origin).toBe(base);
    expect(got.proto).toBe('firm, firm-token.tok-1');
    expect(got.path).toBe('/ws/threads/management');
    expect(got.message).toEqual({ type: 'message', text: '[Assistant] hello' });
    expect(r).toEqual({ sent: true, notes: ['Management is busy'] });
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
