const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSessions, OFF_MESSAGE } = require('../lib/euphonia/bridge/sessions');
const { redact, clean } = require('../lib/euphonia/bridge/redact');
const { createSessionsMirror } = require('../lib/euphonia/sessions-mirror');
const { createTools } = require('../lib/euphonia/bridge/tools');
const { classifyTool } = require('../lib/euphonia/tool-class');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sess-')));
const jl = (...recs) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n';
const T0 = '2026-10-09T10:00:00.000Z';

function fixture() {
  const root = tmp();
  const proj = path.join(root, '-Users-me-proj');
  fs.mkdirSync(proj);
  const claude = path.join(proj, 'aaaa-1111.jsonl');
  const turns = [];
  for (let i = 1; i <= 14; i++) {
    turns.push({ type: 'user', timestamp: T0, cwd: '/Users/me/proj', gitBranch: 'feat/x', message: { role: 'user', content: i === 1 ? 'first <b>ask</b> ' + 'x'.repeat(400) : `question ${i}` } });
    turns.push({ type: 'assistant', timestamp: T0, message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'SECRET-THOUGHT' }, { type: 'text', text: `answer ${i} ` + 'y'.repeat(900) }, { type: 'tool_use', name: 'Bash', input: { command: 'cat /etc/passwd-ARG' } }] } });
    turns.push({ type: 'user', timestamp: T0, message: { role: 'user', content: [{ type: 'tool_result', content: 'TOOL-OUTPUT-LEAK' }] }, toolUseResult: { stdout: 'TOOL-OUTPUT-LEAK' } });
  }
  fs.writeFileSync(claude, jl({ type: 'permission-mode', sessionId: 'aaaa-1111' }, { type: 'user', isMeta: true, message: { role: 'user', content: 'META-IGNORED' } }, ...turns));
  const codexDir = path.join(root, '2026', '10', '09');
  fs.mkdirSync(codexDir, { recursive: true });
  const codex = path.join(codexDir, 'rollout-2026-10-09T10-00-00-bbbb-2222.jsonl');
  fs.writeFileSync(codex, jl(
    { timestamp: T0, type: 'session_meta', payload: { id: 'bbbb-2222', timestamp: T0, cwd: '/Users/me/other', git: { branch: 'main' } } },
    { timestamp: T0, type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'DEV-IGNORED' }] } },
    { timestamp: T0, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for /x' }, { type: 'input_text', text: '<environment_context>x</environment_context>' }] } },
    { timestamp: T0, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'codex task' }] } },
    { timestamp: T0, type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: 'ls -la ARG' } },
    { timestamp: T0, type: 'response_item', payload: { type: 'custom_tool_call_output', output: 'TOOL-OUTPUT-LEAK' } },
    { timestamp: T0, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'codex done' }] } },
  ));
  const old = new Date(Date.now() - 60 * 60 * 1000);   // an hour ago: idle
  fs.utimesSync(claude, old, old);
  return { root, claude, codex };
}

describe('sessions_list', () => {
  test('lists claude and codex sessions with the documented fields, newest first', async () => {
    const f = fixture();
    const s = createSessions({ roots: () => [f.root], now: () => Date.now() });
    const r = await s.list({});
    expect(r.total).toBe(2);
    expect(r.sessions.map((x) => x.id)).toEqual(['rollout-2026-10-09T10-00-00-bbbb-2222', 'aaaa-1111']);   // codex file is newer
    const [cx, cl] = r.sessions;
    expect(cl).toMatchObject({ tool: 'claude', cwd: '/Users/me/proj', branch: 'feat/x', started: T0, messages: 28, state: 'idle' });
    expect(cl.first_message.length).toBeLessThanOrEqual(201);   // 200 + ellipsis
    expect(cl.first_message.startsWith('first <b>ask</b>')).toBe(true);
    expect(cx).toMatchObject({ tool: 'codex', cwd: '/Users/me/other', branch: 'main', messages: 2, first_message: 'codex task' });
    expect(cx.state).toBe('active');
    expect(JSON.stringify(r)).not.toMatch(/META-IGNORED|DEV-IGNORED|TOOL-OUTPUT-LEAK|SECRET-THOUGHT|AGENTS\.md/);
  });
  test('limit and since', async () => {
    const f = fixture();
    const s = createSessions({ roots: () => [f.root] });
    expect((await s.list({ limit: 1 })).sessions).toHaveLength(1);
    expect((await s.list({ since: new Date(Date.now() - 30 * 60 * 1000).toISOString() })).sessions.map((x) => x.tool)).toEqual(['codex']);
    await expect(s.list({ limit: 0 })).rejects.toThrow(/limit/);
    await expect(s.list({ limit: 999 })).rejects.toThrow(/limit/);
    await expect(s.list({ since: 'yesterday-ish' })).rejects.toThrow(/since/);
  });
  test('the message count picks up appended lines without losing the earlier count', async () => {
    const f = fixture();
    const s = createSessions({ roots: () => [f.root] });
    const find = async () => (await s.list({})).sessions.find((x) => x.id === 'aaaa-1111');
    expect((await find()).messages).toBe(28);
    fs.appendFileSync(f.claude, jl({ type: 'user', message: { role: 'user', content: 'one more' } }));
    expect((await find()).messages).toBe(29);
  });
  test('empty or missing sessionRoots is a clear feature-off error', async () => {
    for (const roots of [[], undefined, null, 'x', [''], ['relative/dir']]) {
      const s = createSessions({ roots: () => roots });
      await expect(s.list({})).rejects.toThrow(OFF_MESSAGE);
      await expect(s.summary({ id: 'aaaa-1111' })).rejects.toThrow(OFF_MESSAGE);
    }
    await expect(createSessions({ roots: () => [path.join(tmp(), 'nope')] }).list({})).rejects.toThrow(/sessionRoots/);
  });
  test('a session outside sessionRoots is never listed or read, and symlinks out of a root are not followed', async () => {
    const f = fixture();
    const outside = tmp();
    fs.writeFileSync(path.join(outside, 'zzzz-9999.jsonl'), jl({ type: 'user', message: { role: 'user', content: 'OUTSIDE' } }));
    fs.symlinkSync(outside, path.join(f.root, 'linked-dir'));
    fs.symlinkSync(path.join(outside, 'zzzz-9999.jsonl'), path.join(f.root, '-Users-me-proj', 'linked-file.jsonl'));
    const s = createSessions({ roots: () => [f.root] });
    const r = await s.list({});
    expect(JSON.stringify(r)).not.toContain('OUTSIDE');
    expect(r.sessions.map((x) => x.id)).not.toContain('linked-file');
    await expect(s.summary({ id: 'zzzz-9999' })).rejects.toThrow(/No session/);
    await expect(s.summary({ id: 'linked-file' })).rejects.toThrow(/No session/);
  });
});

describe('sessions_get_summary', () => {
  test('returns the last 10 turns as truncated text and tool names only', async () => {
    const f = fixture();
    const s = createSessions({ roots: () => [f.root] });
    const r = await s.summary({ id: 'aaaa-1111' });
    expect(r.turns).toHaveLength(10);
    expect(r.turns[9].text.startsWith('answer 14')).toBe(true);
    expect(r.turns.every((t) => t.text.length <= 601)).toBe(true);
    expect(r.turns[0].role).toBe('user');
    expect(r.recent_tools).toEqual(Array(10).fill('Bash'));
    expect(r).toMatchObject({ tool: 'claude', cwd: '/Users/me/proj', branch: 'feat/x' });
    expect(JSON.stringify(r)).not.toMatch(/passwd-ARG|TOOL-OUTPUT-LEAK|SECRET-THOUGHT|META-IGNORED/);
    const c = await s.summary({ id: 'rollout-2026-10-09T10-00-00-bbbb-2222' });
    expect(c.turns.map((t) => [t.role, t.text])).toEqual([['user', 'codex task'], ['assistant', 'codex done']]);
    expect(c.recent_tools).toEqual(['exec']);
    expect(JSON.stringify(c)).not.toMatch(/ls -la ARG|TOOL-OUTPUT-LEAK|AGENTS|DEV-IGNORED/);
  });
  test('malformed ids are refused before any file access', async () => {
    const f = fixture();
    const s = createSessions({ roots: () => [f.root] });
    for (const id of ['../aaaa-1111', 'a/b', 'aaaa-1111.jsonl', '-rf', '', ' x', 'a b', 'a\0b', '.hidden', 'x'.repeat(200), 5, null, undefined, {}, ['aaaa-1111']]) {
      await expect(s.summary({ id })).rejects.toThrow(/not a valid session id/);
    }
    await expect(s.summary({})).rejects.toThrow(/not a valid session id/);
    await expect(s.summary({ id: 'does-not-exist' })).rejects.toThrow(/No session/);
  });
  test('redacts secrets in the turns and the first message', async () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'p'));
    fs.writeFileSync(path.join(root, 'p', 'sec-1.jsonl'), jl(
      { type: 'user', timestamp: T0, cwd: '/x', message: { role: 'user', content: 'use ghp_abcdefghijklmnopqrstuvwxyz0123456789 and password=hunter2' } },
      { type: 'assistant', timestamp: T0, message: { role: 'assistant', content: [{ type: 'text', text: 'API_TOKEN=abc123def Bearer abcdefgh12345678' }] } },
    ));
    const s = createSessions({ roots: () => [root] });
    const out = JSON.stringify([await s.list({}), await s.summary({ id: 'sec-1' })]);
    expect(out).not.toMatch(/ghp_|hunter2|abc123def|abcdefgh12345678/);
    expect(out).toContain('[redacted]');
  });
});

describe('redaction', () => {
  const cases = {
    'AWS access key': 'key AKIAIOSFODNN7EXAMPLE end',
    'AWS temp key': 'ASIAIOSFODNN7EXAMPLE',
    'Bearer': 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9abc.def',
    'ghp_': 'ghp_0123456789abcdefghijABCDEFGHIJ012345',
    'github_pat_': 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz',
    'xoxb': 'xoxb-1234567890-abcdefghij',
    'xoxp': 'xoxp-1234567890-abcdefghij',
    'private key block': '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nabcdef\n-----END RSA PRIVATE KEY-----',
    'cut private key block': '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
    'password=': 'password=correct-horse',
    'password: json': '{"password": "correct horse"}',
    'token=': 'curl x?token=abc.def-123&y=1',
    'env KEY': 'STRIPE_SECRET_KEY=sk_live_abcdef',
    'env TOKEN': 'GITHUB_TOKEN="value with spaces"',
    'env PASSWORD': 'DB_PASSWORD=pw123',
    'env SECRET': 'CLIENT_SECRET=zzz999',
    'env KEY plain': 'MY_API_KEY=k-12345',
  };
  for (const [name, input] of Object.entries(cases)) {
    test(`removes ${name}`, () => {
      const out = redact(`before ${input} after`);
      const secret = input.replace(/^.*?[=:] ?"?|^key |^Authorization: Bearer /, '');
      expect(out).toContain('[redacted]');
      expect(out).toContain('before');
      for (const frag of ['AKIAIOSFODNN7EXAMPLE', 'ASIAIOSFODNN7EXAMPLE', 'eyJhbGci', 'ghp_0123', 'github_pat_11', 'xoxb-1234', 'xoxp-1234', 'MIIEow', 'MIIEvQ', 'correct-horse', 'correct horse', 'abc.def-123', 'sk_live', 'value with spaces', 'pw123', 'zzz999', 'k-12345']) expect(out).not.toContain(frag);
      expect(secret.length).toBeGreaterThan(0);
    });
  }
  test('redacts before truncating so a secret on the cut line cannot half-leak', () => {
    const t = `${'a'.repeat(190)} ghp_0123456789abcdefghijABCDEFGHIJ012345`;
    expect(clean(t, 200)).not.toMatch(/ghp_/);
  });
  test('ordinary text is untouched', () => {
    expect(redact('Fix the token budget in the keyboard handler; see key concepts.')).toBe('Fix the token budget in the keyboard handler; see key concepts.');
  });
});

describe('actions and mirror', () => {
  test('the new actions classify as read, need a read grant, and appear in the tool list', () => {
    const defs = createTools({ firm: {}, ghRun: async () => '', cosmetics: () => ({}) });
    for (const n of ['sessions_list', 'sessions_get_summary']) { expect(classifyTool(n)).toBe('read'); expect(defs.find((d) => d.name === n).class).toBe('read'); }
  });
  test('with the default (no roots) the actions return the feature-off error', async () => {
    const defs = createTools({ firm: {}, ghRun: async () => '', cosmetics: () => ({}) });
    await expect(defs.find((d) => d.name === 'sessions_list').run({})).rejects.toThrow(/off/);
    await expect(defs.find((d) => d.name === 'sessions_get_summary').run({ id: 'x' })).rejects.toThrow(/off/);
  });
  test('the actions render rows and turns for the model', async () => {
    const f = fixture();
    const defs = createTools({ firm: {}, ghRun: async () => '', cosmetics: () => ({}), sessions: createSessions({ roots: () => [f.root] }) });
    const list = await defs.find((d) => d.name === 'sessions_list').run({ limit: 5 });
    expect(JSON.parse(list).sessions).toHaveLength(2);
    const sum = await defs.find((d) => d.name === 'sessions_get_summary').run({ id: 'aaaa-1111' });
    expect(sum.split('\n').length).toBe(12);   // header line, "turns:", 10 turns
  });
  test('no write, start, stop, send, resume or delete path exists in the session code', () => {
    for (const f of ['bridge/sessions.js', 'bridge/redact.js']) {
      const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'euphonia', f), 'utf8').replace(/\/\/.*$/gm, '');
      expect(src).not.toMatch(/writeFile|appendFile|unlink|rmSync|rm\(|rename|mkdir|truncate|copyFile|chmod|symlink\(|child_process|spawn|exec\(|execFile|fork\(|net\.|http|fetch\(|process\.kill|createWriteStream/);
    }
    const names = createTools({ firm: {}, ghRun: async () => '', cosmetics: () => ({}) }).map((d) => d.name).filter((n) => n.startsWith('sessions_'));
    expect(names.sort()).toEqual(['sessions_get_summary', 'sessions_list']);
  });
  test('the mirror writes a capped list-only STATUS.md, and says the feature is off when roots are empty', async () => {
    const f = fixture();
    const kb = tmp();
    const on = createSessionsMirror({ kbDir: kb, sessions: createSessions({ roots: () => [f.root] }), now: () => new Date(T0) });
    expect((await on.refresh()).ok).toBe(true);
    const text = fs.readFileSync(path.join(kb, 'sessions', 'STATUS.md'), 'utf8');
    expect(text).toMatch(/aaaa-1111 · claude · idle/);
    expect(text).toMatch(/bbbb-2222 · codex · /);
    expect(text).not.toMatch(/answer 14/);
    expect(text.length).toBeLessThanOrEqual(12020);
    const kb2 = tmp();
    const off = createSessionsMirror({ kbDir: kb2, sessions: createSessions({ roots: () => [] }) });
    await off.refresh();
    expect(fs.readFileSync(path.join(kb2, 'sessions', 'STATUS.md'), 'utf8')).toMatch(/sessionRoots/);
  });
  test('a mirror over many sessions stays under the size cap', async () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'p'));
    for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(root, 'p', `s${i}.jsonl`), jl({ type: 'user', timestamp: T0, cwd: '/c'.repeat(100), message: { role: 'user', content: 'm'.repeat(5000) } }));
    const kb = tmp();
    const m = createSessionsMirror({ kbDir: kb, sessions: createSessions({ roots: () => [root] }) });
    await m.refresh();
    const text = fs.readFileSync(path.join(kb, 'sessions', 'STATUS.md'), 'utf8');
    expect(text.length).toBeLessThanOrEqual(12020);
    expect((text.match(/^- s\d+/gm) || []).length).toBeLessThanOrEqual(25);
  });
});
