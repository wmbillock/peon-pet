const fs = require('fs');
const os = require('os');
const path = require('path');
const { createEuphonia, userLine, renderTurnHeader, OWNER_FALLBACK } = require('../lib/euphonia/service');
const { fakeClaude, okReply, exit, line, delta } = require('./helpers/fake-claude');

let tmp;
// initWaitMs 0: tests that care about the init wait set it themselves.
const mk = (script, extra = {}, fakeOpts = {}) => {
  const f = fakeClaude(script, fakeOpts);
  const hubDir = path.join(tmp, 'hub'); fs.mkdirSync(hubDir, { recursive: true });
  const e = createEuphonia({ home: path.join(tmp, 'home'), hubDir, user: 'matt.login', spawnImpl: f.spawnImpl, now: () => new Date('2026-10-05T12:00:00Z'), discover: () => ({ servers: [], errors: [] }), managedPolicy: () => ({ ask: new Set(), deny: new Set() }), initWaitMs: 0, stopWaitMs: 50, ...extra });
  const events = [];
  e.subscribe((ev) => events.push(ev));
  return { e, events, calls: f.calls, procs: f.procs };
};
const flag = (a, f) => a[a.indexOf(f) + 1];
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'euph-')); });

test('first message creates session.json and captures the CLI session id', async () => {
  const { e, calls } = mk((c) => okReply(c, 'sess-111', ['Hi']));
  expect(e.getSession()).toBeNull();
  await e.send('hello').done;
  expect(calls[0].args).not.toContain('--resume');
  expect(calls[0].stdin).toBe('hello');           // the message goes on stdin, never argv
  expect(calls[0].args).not.toContain('hello');
  const s = JSON.parse(fs.readFileSync(e.paths.session, 'utf8'));
  expect(s).toMatchObject({ id: 'sess-111', turns: 1, created_at: '2026-10-05T12:00:00.000Z' });
});

describe('one long-lived CLI process per session', () => {
  test('the second message goes to the SAME process as a stream-json user line; no respawn, no --resume', async () => {
    const { e, calls, procs } = mk((c, _call, n) => okReply(c, 'sess-111', ['ok ' + n]));
    await e.send('one').done;
    await e.send('two').done;
    expect(procs).toHaveLength(1);
    expect(calls.map((c) => c.stdin)).toEqual(['one', 'two']);
    expect(calls[1].proc).toBe(calls[0].proc);
    expect(procs[0].args).toEqual(expect.arrayContaining(['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']));
    expect(procs[0].closed).toBe(false);                      // stdin is still open
    expect(e.getSession().turns).toBe(2);
    expect(e.process()).toMatchObject({ no: 1, persistent: true, exited: false });
    expect(JSON.parse(userLine('x'))).toEqual({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'x' }] } });
    await e.shutdown();
    expect(procs[0].closed).toBe(true); expect(procs[0].exitCode).toBe(0);   // graceful: stdin ended, exit 0
    expect(e.process()).toBeNull();
  });
  test('a process that died between turns is replaced by one that resumes the session', async () => {
    const { e, calls, procs } = mk((c, _call, n) => okReply(c, 'sess-111', ['r' + n]));
    await e.send('one').done;
    exit(procs[0].child, 0);                                   // the CLI went away on its own
    await new Promise((r) => setImmediate(r));
    await e.send('two').done;
    expect(procs).toHaveLength(2);
    expect(flag(procs[1].args, '--resume')).toBe('sess-111');
    expect(calls[1].stdin).toBe('two');
    expect(e.getSession().turns).toBe(2);
  });
  test('a grant change restarts the process gracefully with the new allowlist and --resume; an unchanged grant does not', async () => {
    const { e, calls, procs } = mk((c, _call, n) => okReply(c, 's1', ['r' + n], { init: { tools: ['Read', 'mcp__slack__slack_read_channel', 'mcp__slack__slack_send_message'], mcp_servers: [{ name: 'slack', status: 'connected' }] } }), { discover: () => ({ servers: [{ name: 'slack' }], errors: [] }) });
    await e.send('one').done;
    await e.send('two').done;
    expect(procs).toHaveLength(1);
    e.grants.grant({ server: 'slack', level: 'read', duration: '1h' });
    await e.send('three').done;
    expect(procs).toHaveLength(2);
    expect(procs[0].closed).toBe(true); expect(procs[0].exitCode).toBe(0);
    expect(flag(procs[1].args, '--allowedTools')).toContain('mcp__slack__slack_read_channel');
    expect(flag(procs[1].args, '--resume')).toBe('s1');
    expect(calls[2].proc).toBe(procs[1]);
    await e.send('four').done;
    expect(procs).toHaveLength(2);                              // same grants: same process
    e.grants.revoke('slack');
    await e.send('five').done;
    expect(procs).toHaveLength(3);
    expect(flag(procs[2].args, '--allowedTools')).not.toMatch(/mcp__/);
  });
  test('the CLI rejects streaming input: the turn is redone per-turn and the run stays per-turn', async () => {
    const { e, calls, procs, events } = mk((c, call, n) => {
      if (call.proc.persistent) return exit(c, 1, "error: unknown option '--input-format'\n");
      okReply(c, 'sess-9', ['Hello ' + n]);
    });
    await e.send('hi').done;
    expect(procs).toHaveLength(2);
    expect(procs[0].args).toContain('--input-format');
    expect(procs[1].args).not.toContain('--input-format');
    expect(procs[1].closed).toBe(true);                         // per-turn: stdin ended with the message
    expect(events.filter((x) => x.type === 'error')).toHaveLength(0);
    expect(events.filter((x) => x.type === 'done')).toHaveLength(1);
    expect(events.find((x) => x.type === 'notice').text).toMatch(/one process per message/);
    await e.send('again').done;
    expect(procs).toHaveLength(3);
    expect(procs[2].args).not.toContain('--input-format');
    expect(flag(procs[2].args, '--resume')).toBe('sess-9');
    expect(calls.map((c) => c.stdin)).toEqual(['hi', 'hi', 'again']);
  });
  test('config transport: per-turn forces the old shape', async () => {
    const { e, procs } = mk((c, _call, n) => okReply(c, 's', ['r' + n]));
    e.setConfig({ transport: 'per-turn' });
    await e.send('a').done; await e.send('b').done;
    expect(procs).toHaveLength(2);
    expect(procs.every((p) => !p.args.includes('--input-format') && p.closed)).toBe(true);
    expect(flag(procs[1].args, '--resume')).toBe('s');
    expect(() => e.setConfig({ transport: 'telepathy' })).toThrow(/transport/);
  });
  test('a process dying mid-turn is an error for that turn; the next turn gets a fresh process', async () => {
    const { e, events, procs } = mk((c, _call, n) => (n === 1 ? exit(c, 1, 'No conversation found with session ID: sess-1\n') : okReply(c, 's2', ['fine'])));
    await e.send('a').done;
    expect(events.at(-1)).toMatchObject({ type: 'error' });
    expect(events.at(-1).message).toMatch(/No conversation found/);
    expect(e.getSession()).toBeNull();
    await e.send('b').done;
    expect(procs).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: 'done', text: 'fine' });
  });
});

describe('the turn header: access block, MCP state, receipts travel with the message, not the system prompt', () => {
  test('every message carries the live access block and ends with the user text; the system prompt points to it', async () => {
    const { e, calls, procs } = mk((c) => okReply(c, 's', ['x']));
    await e.send('hello there').done;
    expect(calls[0].full).toMatch(/^\[Current access for this turn/);
    expect(calls[0].full).toMatch(/External tools and actions: none/);
    expect(calls[0].full).toMatch(/\n\[Message\]\nhello there$/);
    expect(flag(procs[0].args, '--append-system-prompt')).toMatch(/top of EVERY message/);
    expect(flag(procs[0].args, '--append-system-prompt')).not.toMatch(/External tools and actions: none/);
    expect(renderTurnHeader({ access: 'A', mcpNotes: ['n1'], receipts: 'R', text: 'T' }).split('\n')).toEqual(['[Current access for this turn, written by the app; the whole truth about your tools now]', 'A', '- n1', '', "[Recent sends through your approval cards, last 24 h, from the app's receipt log]", 'R', '', '[Message]', 'T']);
  });
  test('MCP status is recorded from the init event; a granted server not connected at init is said to be held in that turn', async () => {
    const init = { type: 'system', subtype: 'init', session_id: 's', tools: ['Read', 'mcp__jira__getJiraIssue'], mcp_servers: [{ name: 'jira', status: 'connected' }, { name: 'playwright', status: 'pending' }, { name: 'atlan', status: 'needs-auth' }] };
    const { e, calls } = mk((c) => okReply(c, 's', ['x']), { initWaitMs: 500, discover: () => ({ servers: [{ name: 'jira' }, { name: 'playwright' }, { name: 'atlan' }], errors: [] }) }, { init });
    e.grants.grant({ server: 'playwright', level: 'read', duration: '1h' });
    e.grants.grant({ server: 'jira', level: 'read', duration: '1h' });
    await e.send('one').done;                                   // the first turn waited for init, so the header already knows
    const st = JSON.parse(fs.readFileSync(e.paths.mcpStatus, 'utf8'));
    expect(st.servers).toEqual({ jira: { status: 'connected', tools: 1 }, playwright: { status: 'pending', tools: 0 }, atlan: { status: 'needs-auth', tools: 0 } });
    expect(calls[0].full).toMatch(/playwright: held: still connecting \(CLI reported "pending" \(from the CLI's init under a minute ago\)\)/);
    expect(st.source).toBe('init');
    expect(calls[0].full).not.toMatch(/jira: held/);
    expect(calls[0].full).not.toMatch(/atlan/);                 // not granted: not her concern
    expect(e.mcpStatus().servers.playwright.status).toBe('pending');
  });
  test('first turn after launch with no init yet: the header says the state is unknown, or shows the previous launch\'s state as such', async () => {
    const { e, calls } = mk((c) => okReply(c, 's', ['x']), { discover: () => ({ servers: [{ name: 'jira' }], errors: [] }) });
    e.grants.grant({ server: 'jira', level: 'read', duration: '1h' });
    await e.send('one').done;
    expect(calls[0].full).toMatch(/jira: held: connection state unknown/);
    // a later launch (new service, same home) reads the recorded status and labels it as the previous launch's
    fs.writeFileSync(e.paths.mcpStatus, JSON.stringify({ updated: 'x', launch: 'old', process: 1, servers: { jira: { status: 'failed', tools: 0 } } }));
    const again = mk((c) => okReply(c, 's', ['x']), { discover: () => ({ servers: [{ name: 'jira' }], errors: [] }) });
    await again.e.send('two').done;
    expect(again.calls[0].full).toMatch(/jira: held: still connecting \(CLI reported "failed" \(from the CLI's init, as of the previous launch\)\)/);
  });
});

describe('who she is talking to', () => {
  test('the OS login never appears in the prompt except inside a path; displayName and pronouns do', async () => {
    const { e, procs } = mk((c) => okReply(c, 's', ['x']));
    e.setConfig({ displayName: 'Willow', pronouns: 'she/her' });
    await e.send('hi').done;
    const prompt = flag(procs[0].args, '--append-system-prompt');
    expect(prompt).toContain('Willow');
    expect(prompt).toContain('she/her');
    const withoutPaths = prompt.split('\n').filter((l) => !l.includes(e.paths.home) && !l.includes(e.paths.hubDir)).join('\n');
    expect(withoutPaths).not.toContain('matt.login');
    expect(e.paths.home).toContain('home');                     // the login (or EUPHONIA_HOME) only picks the directory
  });
  test('no displayName: a neutral "the owner", never the login; the seeded kb uses the same', () => {
    const { e, procs } = mk((c) => okReply(c, 's', ['x']));
    expect(e.getConfig().displayName).toBeNull();
    expect(fs.readFileSync(path.join(e.paths.kbDir, 'identity.md'), 'utf8')).toContain(`${OWNER_FALLBACK}'s personal assistant`);
    expect(fs.readFileSync(path.join(e.paths.kbDir, 'identity.md'), 'utf8')).not.toContain('matt.login');
    expect(e.setConfig({ displayName: '  ' }).displayName).toBeNull();
    expect(e.setConfig({ displayName: 'W\nillow' }).displayName).toBe('W illow');
    expect(procs).toHaveLength(0);
  });
  test('kb/identity.md is appended verbatim to the system prompt and a change to it restarts the process', async () => {
    const { e, procs } = mk((c) => okReply(c, 's', ['x']));
    fs.writeFileSync(e.paths.identity, '# Identity\n\nDry humour. Calls the owner Captain.\n');
    await e.send('one').done;
    expect(flag(procs[0].args, '--append-system-prompt')).toMatch(/## Identity and personality \(from .*identity\.md.*\)\n# Identity\n\nDry humour\. Calls the owner Captain\./);
    fs.appendFileSync(e.paths.identity, 'Also hums.\n');
    await e.send('two').done;
    expect(procs).toHaveLength(2);
    expect(flag(procs[1].args, '--append-system-prompt')).toContain('Also hums.');
  });
});

test('deltas stream in order between start and done; tool shows name only', async () => {
  const { e, events } = mk((c) => {
    c.stdout.write(line({ type: 'system', subtype: 'init', session_id: 's' }));
    c.stdout.write(delta('Hel'));
    c.stdout.write(line({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/secret' } } } }));
    c.stdout.write(line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }, { type: 'text', text: 'Hel' }] } }));
    c.stdout.write(delta('lo'));
    c.stdout.write(line({ type: 'result', subtype: 'success', is_error: false, result: 'Hello', session_id: 's' }));
  });
  await e.send('hi').done;
  expect(events.map((x) => x.type)).toEqual(['start', 'delta', 'tool', 'delta', 'done']);
  expect(events.filter((x) => x.type === 'delta').map((x) => x.text).join('')).toBe('Hello');
  expect(events.find((x) => x.type === 'tool')).toMatchObject({ name: 'Read' });
  expect(JSON.stringify(events)).not.toContain('/secret');
  expect(events.at(-1).text).toBe('Hello');
});

test('a chunk split across stdout writes is reassembled; a second turn on the same process starts with a clean parser', async () => {
  const { e, events } = mk((c, _call, n) => {
    const d = delta('split' + n);
    c.stdout.write(line({ type: 'system', session_id: 's' }));
    c.stdout.write(line({ type: 'stream_event', event: { type: 'message_start' } }));   // with a parser shared across turns this would read as a break after turn 1's text
    c.stdout.write(d.slice(0, 20)); c.stdout.write(d.slice(20));
    c.stdout.write(line({ type: 'result', subtype: 'success', result: 'split' + n, session_id: 's' }));
  });
  await e.send('x').done;
  await e.send('y').done;
  const dones = events.filter((x) => x.type === 'done');
  expect(dones.map((d) => d.text)).toEqual(['split1', 'split2']);
});

test('an is_error result and a missing binary are errors too', async () => {
  const bad = mk((c) => {
    c.stdout.write(line({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom', session_id: 's' }));
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

test('turns are serialized: the second message is written only after the first result', async () => {
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
  e.setConfig({ displayName: 'Willow' });
  await e.send('hi').done;
  const a = calls[0].args;
  const val = (f) => a[a.indexOf(f) + 1];
  expect(val('--permission-mode')).toBe('dontAsk');
  expect(val('--tools')).toBe('Read,Grep,Glob,Edit,Write');
  expect(val('--allowedTools')).toContain(`Edit(/${path.resolve(e.paths.kbDir)}/**)`);
  expect(val('--allowedTools')).not.toMatch(/Bash/);
  expect(val('--add-dir')).toBe(path.resolve(e.paths.hubDir));
  expect(a).not.toContain('--strict-mcp-config');   // refused when an enterprise MCP config is present
  expect(a).not.toContain('--mcp-config');
  expect(a).toContain('--disable-slash-commands');
  expect(val('--disallowedTools')).toContain('mcp__*');
  expect(val('--system-prompt-snapshot')).toBe('off');   // the prompt is rendered fresh on every request
  expect(val('--append-system-prompt')).toContain('Willow');
  expect(val('--input-format')).toBe('stream-json');
  expect(calls[0].opts.cwd).toBe(e.paths.home);
  expect(calls[0].opts.env.MCP_TIMEOUT).toBe('120000');
});

test('config: whitelisted keys only, validated', () => {
  const { e } = mk(() => {});
  expect(e.getConfig()).toMatchObject({ soundPack: null, species: 'weeping-willow', transport: 'persistent' });   // shipped defaults are original/published only
  expect(e.setConfig({ soundPack: '' }).soundPack).toBeNull();
  expect(e.setConfig({ soundPack: 'cortana', evil: 1 })).not.toHaveProperty('evil');
  expect(() => e.setConfig({ soundPack: '../x' })).toThrow();
  expect(() => e.send('   ')).toThrow(/Empty/);
});

test('resetSession keeps the old file, ends the live process, and the next turn starts fresh', async () => {
  const { e, calls, procs } = mk((c) => okReply(c, 's', ['x']));
  await e.send('a').done;
  expect(e.resetSession()).toBe(true);
  await new Promise((r) => setTimeout(r, 20));
  expect(procs[0].closed).toBe(true);
  expect(fs.readdirSync(e.paths.home).some((f) => /^session\..*\.old\.json$/.test(f))).toBe(true);
  await e.send('b').done;
  expect(procs).toHaveLength(2);
  expect(calls[1].args).not.toContain('--resume');
});

test('a rejected flag is named in the error with the CLI message and a next step', async () => {
  const { e, events } = mk((c) => exit(c, 1, 'error: You cannot use --strict-mcp-config when an enterprise MCP config is present\n'));
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

test('a turn that never gets a result times out, kills the process, and the next turn starts a new one', async () => {
  const { e, events, procs } = mk((c, _call, n) => { if (n > 1) okReply(c, 's', ['back']); }, { timeoutMs: 30 });
  await e.send('a').done;
  expect(events.at(-1)).toMatchObject({ type: 'error', message: 'Timed out waiting for the assistant' });
  expect(procs[0].child.killed).toBe(true);
  await e.send('b').done;
  expect(procs).toHaveLength(2);
  expect(events.at(-1)).toMatchObject({ type: 'done', text: 'back' });
});

test('learnTools runs a throwaway session with the same grants, merges the tool names into the real catalog, leaves her chat alone, and ends its process', async () => {
  const { e, calls, procs } = mk((c) => okReply(c, 'learn-1', ['Ready.'], { init: { mcp_servers: [{ name: 'jira', status: 'connected' }, { name: 'atlan', status: 'needs-auth' }], tools: ['Read', 'mcp__jira__getJiraIssue', 'mcp__jira__searchJiraIssuesUsingJql'] } }));
  e.grants.grant({ server: 'jira', level: 'read', duration: 'blanket' });
  const counts = await e.learnTools();
  expect(counts).toEqual({ jira: 2 });
  const cat = JSON.parse(fs.readFileSync(e.paths.catalog, 'utf8'));
  expect(cat.servers.jira.tools).toEqual(['getJiraIssue', 'searchJiraIssuesUsingJql']);
  expect(cat.servers.atlan).toBeUndefined();                                  // no tools learned, nothing merged
  expect(calls[0].opts.cwd).toContain('.learn');                             // the probe ran in its own home
  expect(e.history().length).toBe(0);                                          // nothing was written to her transcript
  expect(procs[0].closed).toBe(true);                                          // the probe's process was ended
  const scratchGrants = JSON.parse(fs.readFileSync(path.join(`${e.paths.home}.learn`, 'grants.json'), 'utf8')).grants;
  expect(scratchGrants.map((g) => g.server)).toEqual(['jira']);
});
