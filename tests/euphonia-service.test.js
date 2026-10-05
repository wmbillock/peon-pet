const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { createEuphonia } = require('../lib/euphonia/service');

// A fake `claude`: records argv and stdin, replays canned stream-json lines. No provider is ever called.
function fakeClaude(script) {
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => {};
    const call = { cmd, args, opts, stdin: '' };
    calls.push(call);
    child.stdin.on('data', (d) => { call.stdin += d; });
    child.stdin.on('end', () => setImmediate(() => script(child, call, calls.length)));
    return child;
  };
  return { spawnImpl, calls };
}
const line = (o) => JSON.stringify(o) + '\n';
const delta = (text) => line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
function okReply(child, sessionId, parts) {
  child.stdout.write(line({ type: 'system', subtype: 'init', session_id: sessionId }));
  child.stdout.write(line({ type: 'stream_event', event: { type: 'message_start' } }));
  for (const p of parts) child.stdout.write(delta(p));
  child.stdout.write(line({ type: 'result', subtype: 'success', is_error: false, result: parts.join(''), session_id: sessionId }));
  child.stdout.end(); child.emit('close', 0);
}

let tmp;
const mk = (script, extra = {}) => {
  const f = fakeClaude(script);
  const hubDir = path.join(tmp, 'hub'); fs.mkdirSync(hubDir, { recursive: true });
  const e = createEuphonia({ home: path.join(tmp, 'home'), hubDir, user: 'willow', spawnImpl: f.spawnImpl, now: () => new Date('2026-10-05T12:00:00Z'), discover: () => ({ servers: [], errors: [] }), ...extra });
  const events = [];
  e.subscribe((ev) => events.push(ev));
  return { e, events, calls: f.calls };
};
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'euph-')); });

test('first message creates session.json and captures the CLI session id', async () => {
  const { e, calls } = mk((c) => okReply(c, 'sess-111', ['Hi']));
  expect(e.getSession()).toBeNull();
  await e.send('hello').done;
  expect(calls[0].args).not.toContain('--resume');
  expect(calls[0].stdin).toBe('hello');           // the message goes on stdin, never argv
  const s = JSON.parse(fs.readFileSync(e.paths.session, 'utf8'));
  expect(s).toMatchObject({ id: 'sess-111', turns: 1, created_at: '2026-10-05T12:00:00.000Z' });
});

test('second message resumes the same session by id', async () => {
  const { e, calls } = mk((c, _call, n) => okReply(c, 'sess-111', ['ok ' + n]));
  await e.send('one').done;
  await e.send('two').done;
  const a = calls[1].args;
  expect(a[a.indexOf('--resume') + 1]).toBe('sess-111');
  expect(e.getSession().turns).toBe(2);
});

test('deltas stream in order between start and done; tool shows name only', async () => {
  const { e, events } = mk((c) => {
    c.stdout.write(line({ type: 'system', subtype: 'init', session_id: 's' }));
    c.stdout.write(delta('Hel'));
    c.stdout.write(line({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/secret' } } } }));
    c.stdout.write(line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }, { type: 'text', text: 'Hel' }] } }));
    c.stdout.write(delta('lo'));
    c.stdout.write(line({ type: 'result', subtype: 'success', is_error: false, result: 'Hello', session_id: 's' }));
    c.stdout.end(); c.emit('close', 0);
  });
  await e.send('hi').done;
  expect(events.map((x) => x.type)).toEqual(['start', 'delta', 'tool', 'delta', 'done']);
  expect(events.filter((x) => x.type === 'delta').map((x) => x.text).join('')).toBe('Hello');
  expect(events.find((x) => x.type === 'tool')).toMatchObject({ name: 'Read' });
  expect(JSON.stringify(events)).not.toContain('/secret');
  expect(events.at(-1).text).toBe('Hello');
});

test('a chunk split across stdout writes is reassembled', async () => {
  const { e, events } = mk((c) => {
    const d = delta('split');
    c.stdout.write(line({ type: 'system', session_id: 's' }));
    c.stdout.write(d.slice(0, 20)); c.stdout.write(d.slice(20));
    c.stdout.write(line({ type: 'result', subtype: 'success', result: 'split', session_id: 's' }));
    c.stdout.end(); c.emit('close', 0);
  });
  await e.send('x').done;
  expect(events.filter((x) => x.type === 'delta').map((x) => x.text)).toEqual(['split']);
});

test('CLI failure surfaces as an error event and leaves state untouched', async () => {
  let n = 0;
  const { e, events } = mk((c) => {
    if (++n === 1) return okReply(c, 'sess-1', ['fine']);
    c.stderr.write('No conversation found with session ID: sess-1\n');
    c.stdout.end(); c.emit('close', 1);
  });
  await e.send('a').done;
  const before = fs.readFileSync(e.paths.session, 'utf8');
  await e.send('b').done;
  const err = events.filter((x) => x.type === 'error');
  expect(err).toHaveLength(1);
  expect(err[0].message).toMatch(/No conversation found/);
  expect(fs.readFileSync(e.paths.session, 'utf8')).toBe(before);
  expect(e.history().filter((m) => m.role === 'assistant')).toHaveLength(1);
});

test('an is_error result and a missing binary are errors too', async () => {
  const bad = mk((c) => {
    c.stdout.write(line({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom', session_id: 's' }));
    c.stdout.end(); c.emit('close', 0);
  });
  await bad.e.send('x').done;
  expect(bad.events.at(-1)).toMatchObject({ type: 'error', message: 'boom' });
  expect(bad.e.getSession()).toBeNull();

  const missing = mk((c) => c.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })));
  await missing.e.send('x').done;
  expect(missing.events.at(-1).message).toMatch(/not found/);
});

test('transcript is append-only and records origin', async () => {
  const { e } = mk((c, _x, n) => okReply(c, 's', ['r' + n]));
  await e.send('first').done;
  const snap = fs.readFileSync(e.paths.transcript, 'utf8');
  await e.send('second', { origin: 'agent' }).done;
  const now = fs.readFileSync(e.paths.transcript, 'utf8');
  expect(now.startsWith(snap)).toBe(true);
  const h = e.history();
  expect(h.map((m) => [m.role, m.origin, m.text])).toEqual([
    ['user', 'user', 'first'], ['assistant', 'agent', 'r1'], ['user', 'agent', 'second'], ['assistant', 'agent', 'r2'],
  ]);
});

test('turns are serialized: the second spawns only after the first closes', async () => {
  let active = 0, maxActive = 0;
  const { e } = mk((c) => {
    active++; maxActive = Math.max(maxActive, active);
    setTimeout(() => { active--; okReply(c, 's', ['x']); }, 5);
  });
  await Promise.all([e.send('a').done, e.send('b').done]);
  expect(maxActive).toBe(1);
});

test('argv carries the authority policy and nothing writable outside kb', async () => {
  const { e, calls } = mk((c) => okReply(c, 's', ['x']));
  await e.send('hi').done;
  const a = calls[0].args;
  const val = (f) => a[a.indexOf(f) + 1];
  expect(val('--permission-mode')).toBe('dontAsk');
  expect(val('--tools')).toBe('Read,Grep,Glob,Edit,Write');
  expect(val('--allowedTools')).toContain(`Edit(/${path.resolve(e.paths.kbDir)}/**)`);
  expect(val('--allowedTools')).not.toMatch(/Bash/);
  expect(val('--add-dir')).toBe(path.resolve(e.paths.hubDir));
  expect(a).not.toContain('--strict-mcp-config');   // refused when an enterprise MCP config is present
  expect(a).toContain('--disable-slash-commands');
  expect(val('--disallowedTools')).toContain('mcp__*');
  expect(val('--system-prompt-snapshot')).toBe('off');   // the access block is re-rendered every turn
  expect(val('--append-system-prompt')).toContain('willow');
  expect(calls[0].opts.cwd).toBe(e.paths.home);
});

test('config: whitelisted keys only, validated', () => {
  const { e } = mk(() => {});
  expect(e.getConfig()).toMatchObject({ soundPack: 'ra2_eva_commander', species: 'trillian' });
  expect(e.setConfig({ soundPack: 'cortana', evil: 1 })).not.toHaveProperty('evil');
  expect(() => e.setConfig({ soundPack: '../x' })).toThrow();
  expect(() => e.send('   ')).toThrow(/Empty/);
});

test('resetSession keeps the old file and the next turn starts fresh', async () => {
  const { e, calls } = mk((c) => okReply(c, 's', ['x']));
  await e.send('a').done;
  expect(e.resetSession()).toBe(true);
  expect(fs.readdirSync(e.paths.home).some((f) => /^session\..*\.old\.json$/.test(f))).toBe(true);
  await e.send('b').done;
  expect(calls[1].args).not.toContain('--resume');
});

test('a rejected flag is named in the error with the CLI message and a next step', async () => {
  const { e, events } = mk((c) => {
    c.stderr.write('error: You cannot use --strict-mcp-config when an enterprise MCP config is present\n');
    c.stdout.end(); c.emit('close', 1);
  });
  await e.send('x').done;
  const m = events.at(-1).message;
  expect(m).toMatch(/You cannot use --strict-mcp-config/);
  expect(m).toMatch(/\[flag: --strict-mcp-config\]/);
  expect(m).toMatch(/Next:/);
});

test('pendingTurns reports the running turn and the queued ones, and empties as they finish', async () => {
  const { e } = mk((c) => setTimeout(() => okReply(c, 's', ['x']), 5));
  const a = e.send('a'), b = e.send('b');
  expect(e.pendingTurns()).toEqual({ running: a.turnId, queued: [b.turnId] });
  await a.done;
  expect(e.pendingTurns()).toEqual({ running: b.turnId, queued: [] });
  await b.done;
  expect(e.pendingTurns()).toEqual({ running: null, queued: [] });
});
