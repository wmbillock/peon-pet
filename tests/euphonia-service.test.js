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
  expect(e.getConfig()).toMatchObject({ soundPack: null, species: 'weeping-willow' });   // shipped defaults are original/published only
  expect(e.setConfig({ soundPack: '' }).soundPack).toBeNull();
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

test('an enterprise MCP config refuses the per-turn --mcp-config: the turn is retried without it and later turns skip it', async () => {
  const refuse = (c) => { c.stdout.write(line({ type: 'result', subtype: 'error', is_error: true, result: 'You cannot dynamically configure MCP servers when an enterprise MCP config is present', session_id: 's' })); c.stdout.end(); c.emit('close', 1); };
  const { e, events, calls } = mk((c, call) => (call.args.includes('--mcp-config') ? refuse(c) : okReply(c, 'sess-9', ['Hello'])));
  await e.send('are you there').done;
  expect(calls).toHaveLength(2);
  expect(calls[0].args).toContain('--mcp-config');
  expect(calls[1].args).not.toContain('--mcp-config');
  expect(events.filter((x) => x.type === 'error')).toHaveLength(0);
  expect(events.filter((x) => x.type === 'done')).toHaveLength(1);
  await e.send('again').done;
  expect(calls).toHaveLength(3);                       // no second refused attempt
  expect(calls[2].args).not.toContain('--mcp-config');
});

test('learnTools runs a throwaway session with the same grants and merges the tool names into the real catalog, leaving her chat alone', async () => {
  const init = (c) => {
    c.stdout.write(line({ type: 'system', subtype: 'init', session_id: 'learn-1', mcp_servers: [{ name: 'jira', status: 'connected' }, { name: 'atlan', status: 'needs-auth' }],
      tools: ['Read', 'mcp__jira__getJiraIssue', 'mcp__jira__searchJiraIssuesUsingJql'] }));
    c.stdout.write(line({ type: 'result', subtype: 'success', is_error: false, result: 'Ready.', session_id: 'learn-1' }));
    c.stdout.end(); c.emit('close', 0);
  };
  const { e, calls } = mk(init);
  e.grants.grant({ server: 'jira', level: 'read', duration: 'blanket' });
  const counts = await e.learnTools();
  expect(counts).toEqual({ jira: 2 });
  const cat = JSON.parse(fs.readFileSync(e.paths.catalog, 'utf8'));
  expect(cat.servers.jira.tools).toEqual(['getJiraIssue', 'searchJiraIssuesUsingJql']);
  expect(cat.servers.atlan).toBeUndefined();                                  // no tools learned, nothing merged
  expect(calls[0].cwd || calls[0].opts.cwd).toContain('.learn');            // the probe ran in its own home
  expect(e.history().length).toBe(0);                                          // nothing was written to her transcript
  const scratchGrants = JSON.parse(fs.readFileSync(path.join(`${e.paths.home}.learn`, 'grants.json'), 'utf8')).grants;
  expect(scratchGrants.map((g) => g.server)).toEqual(['jira']);
});

// ---- persistent mode: one process, many turns ----
function liveClaude() {
  const procs = [];
  const spawnImpl = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.pid = 4242 + procs.length; child.kill = () => { child.emit('close', 0); };
    const p = { args, child, inputs: [] };
    procs.push(p);
    let buf = '';
    child.stdin.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        p.inputs.push(msg.message.content);
        setImmediate(() => {
          child.stdout.write(line({ type: 'system', subtype: 'init', session_id: 'sess-live', tools: [], mcp_servers: [] }));
          child.stdout.write(line({ type: 'stream_event', event: { type: 'message_start' } }));
          child.stdout.write(delta(`re: ${msg.message.content}`));
          child.stdout.write(line({ type: 'result', subtype: 'success', is_error: false, result: `re: ${msg.message.content}`, session_id: 'sess-live' }));
        });
      }
    });
    child.stdin.on('finish', () => setImmediate(() => child.emit('close', 0)));
    return child;
  };
  return { spawnImpl, procs };
}

test('persistent: start() spawns one named stream-json process; turns go through it and keep the session', async () => {
  const f = liveClaude();
  const { e } = mk(null, { spawnImpl: f.spawnImpl, persistent: true });
  expect(e.start()).toBe(true);
  expect(f.procs).toHaveLength(1);
  const a = f.procs[0].args;
  expect(a).toContain('--input-format'); expect(a[a.indexOf('--input-format') + 1]).toBe('stream-json');
  expect(a[a.indexOf('--name') + 1]).toBe('Euphonia (willow)');
  expect(a).not.toContain('--resume');
  const r1 = []; e.subscribe((ev) => { if (ev.type === 'done') r1.push(ev.text); });
  await e.send('one').done;
  await e.send('two').done;
  expect(f.procs).toHaveLength(1);                 // same process for both turns
  expect(f.procs[0].inputs).toEqual(['one', 'two']);
  expect(r1).toEqual(['re: one', 're: two']);       // no stray paragraph break leaking between turns
  expect(e.getSession()).toMatchObject({ id: 'sess-live', turns: 2 });
  expect(e.status()).toMatchObject({ persistent: true, running: true });
});

test('persistent: a grant change replaces the process, resuming the same conversation; reset and shutdown stop it', async () => {
  const f = liveClaude();
  const { e } = mk(null, { spawnImpl: f.spawnImpl, persistent: true });
  await e.send('hi').done;
  expect(f.procs).toHaveLength(1);
  e.grants.grant({ server: 'jira', level: 'read', duration: 'blanket' });
  e.start();
  expect(f.procs).toHaveLength(2);
  const a = f.procs[1].args;
  expect(a[a.indexOf('--resume') + 1]).toBe('sess-live');
  e.start();
  expect(f.procs).toHaveLength(2);                  // nothing changed: no restart
  e.resetSession();
  expect(e.status().running).toBe(false);
  await e.send('fresh').done;
  expect(f.procs).toHaveLength(3);
  expect(f.procs[2].args).not.toContain('--resume');
  e.shutdown();
  expect(e.status().running).toBe(false);
});

test('persistent: the process dying mid-turn reports an error and the next message starts a new one', async () => {
  const f = liveClaude();
  const { e, events } = mk(null, { spawnImpl: f.spawnImpl, persistent: true });
  e.start();
  f.procs[0].child.stdin.removeAllListeners('data');
  f.procs[0].child.stdin.on('data', () => setImmediate(() => { f.procs[0].child.stderr.write('boom: crashed\n'); f.procs[0].child.emit('close', 1); }));
  await e.send('x').done;
  expect(events.filter((ev) => ev.type === 'error').pop().message).toMatch(/boom: crashed/);
  await e.send('y').done;
  expect(f.procs).toHaveLength(2);
  expect(events.filter((ev) => ev.type === 'done').pop().text).toBe('re: y');
});

// ---- approval cards: the CLI's permission prompts reach the owner ----
function askingClaude(toolName) {
  const procs = [];
  const spawnImpl = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => child.emit('close', 0);
    const p = { args, child, responses: [] };
    procs.push(p);
    let buf = '';
    child.stdin.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        if (msg.type === 'user') {
          setImmediate(() => child.stdout.write(line({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: toolName, input: { issueIdOrKey: 'PPE-1', labels: ['x'] } } })));
        } else if (msg.type === 'control_response') {
          p.responses.push(msg.response);
          const ok = msg.response.response.behavior === 'allow';
          setImmediate(() => {
            child.stdout.write(delta(ok ? 'edited' : 'not edited'));
            child.stdout.write(line({ type: 'result', subtype: 'success', is_error: false, result: ok ? 'edited' : 'not edited', session_id: 's-ask' }));
          });
        }
      }
    });
    child.stdin.on('finish', () => setImmediate(() => child.emit('close', 0)));
    return child;
  };
  return { spawnImpl, procs };
}
const policyAsk = () => ({ ask: new Set(['mcp__jira__editJiraIssue']), deny: new Set(), known: { jira: ['editJiraIssue', 'getJiraIssue'] } });

test('approval: a policy-held tool on a write-granted server becomes a card; only the owner\'s answer lets it run', async () => {
  const f = askingClaude('mcp__jira__editJiraIssue');
  const { e, events } = mk(null, { spawnImpl: f.spawnImpl, persistent: true, managedPolicy: policyAsk });
  e.grants.grant({ server: 'jira', level: 'write', duration: 'blanket' });
  const a = e.accessSummary().find((s) => s.server === 'jira');
  expect(a.approve).toEqual(['editJiraIssue']);
  const turn = e.send('label PPE-1').done;
  await new Promise((r) => setTimeout(r, 30));
  const args = f.procs[0].args;
  expect(args[args.indexOf('--permission-mode') + 1]).toBe('default');
  expect(args[args.indexOf('--permission-prompt-tool') + 1]).toBe('stdio');
  expect(args[args.indexOf('--disallowedTools') + 1]).not.toContain('mcp__jira__editJiraIssue');
  const card = events.find((ev) => ev.type === 'approval');
  expect(card).toMatchObject({ tool: 'mcp__jira__editJiraIssue', server: 'jira', level: 'write' });
  expect(card.input).toContain('PPE-1');
  expect(f.procs[0].responses).toHaveLength(0);           // nothing answers by itself
  expect(e.pendingApprovals()).toHaveLength(1);
  expect(e.answerApproval('nope', true)).toBe(false);
  expect(e.answerApproval(card.id, true)).toBe(true);
  await turn;
  expect(f.procs[0].responses[0]).toMatchObject({ subtype: 'success', request_id: 'r1', response: { behavior: 'allow', updatedInput: { issueIdOrKey: 'PPE-1' } } });
  expect(events.find((ev) => ev.type === 'approval-closed')).toMatchObject({ id: card.id, approved: true, by: 'owner' });
  expect(events.filter((ev) => ev.type === 'done').pop().text).toBe('edited');
  expect(e.answerApproval(card.id, true)).toBe(false);    // one click, one call
  const audit = fs.readFileSync(path.join(e.paths.home, 'approvals.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  expect(audit.map((r) => r.decision)).toEqual(['asked', 'approved']);
});

test('approval: deny is passed through; a tool that is not approvable is refused with no card', async () => {
  const f = askingClaude('mcp__jira__editJiraIssue');
  const { e, events } = mk(null, { spawnImpl: f.spawnImpl, persistent: true, managedPolicy: policyAsk });
  e.grants.grant({ server: 'jira', level: 'write', duration: 'blanket' });
  const turn = e.send('label it').done;
  await new Promise((r) => setTimeout(r, 30));
  e.answerApproval(events.find((ev) => ev.type === 'approval').id, false);
  await turn;
  expect(f.procs[0].responses[0].response).toMatchObject({ behavior: 'deny', message: 'The owner denied this call.' });

  const g = askingClaude('mcp__slack__slack_send_message');   // no grant, not held: never a card
  const m2 = mk(null, { spawnImpl: g.spawnImpl, persistent: true, managedPolicy: policyAsk });
  m2.e.grants.grant({ server: 'jira', level: 'read', duration: 'blanket' });
  await m2.e.send('post it').done;
  expect(m2.events.some((ev) => ev.type === 'approval')).toBe(false);
  expect(g.procs[0].responses[0].response.behavior).toBe('deny');
});

test('approval: a read grant does not make a held write tool approvable', () => {
  const f = askingClaude('x');
  const { e } = mk(null, { spawnImpl: f.spawnImpl, persistent: true, managedPolicy: policyAsk });
  e.grants.grant({ server: 'jira', level: 'read', duration: 'blanket' });
  const a = e.accessSummary().find((s) => s.server === 'jira');
  expect(a.approve).toEqual([]);
  expect(a.held).toContain('editJiraIssue');
});
