const fs = require('fs');
const os = require('os');
const path = require('path');
const { CodexWatcher, dayDirs } = require('../lib/codex-watcher');

const MAIN = '01a0fd8f-e137-7271-a1dd-d1c1b580dbf3';
const GUARD = '01a0fd96-7c32-7ef0-a7db-2b56de2b4963';
const WORKER = '01a0f8cc-56ac-7613-99ee-fa6a7134d77a';

let root, dir, w, sessions, subs;
const line = (type, payload) => JSON.stringify({ timestamp: new Date().toISOString(), type, payload }) + '\n';
const meta = (id, extra = {}) => line('session_meta', { id, session_id: MAIN, cwd: '/work/proj', ...extra });
const ev = (type, extra = {}) => line('event_msg', { type, ...extra });
const item = (type, extra = {}) => line('response_item', { type, ...extra });
const file = (id) => path.join(dir, `rollout-2026-10-02T12-00-00-${id}.jsonl`);
const write = (id, text) => fs.writeFileSync(file(id), text);
const append = (id, text) => fs.appendFileSync(file(id), text);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const events = () => sessions.map((e) => e.event);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-'));
  dir = dayDirs(root)[0];
  fs.mkdirSync(dir, { recursive: true });
  w = new CodexWatcher({ sessionsDir: root });
  sessions = []; subs = [];
  w.on('session-event', (e) => sessions.push(e));
  w.on('subagent-event', (e) => subs.push(e));
});
afterEach(() => { w.stop(); fs.rmSync(root, { recursive: true, force: true }); });

test('existing session is announced as SessionSeen with cwd, tagged codex, and history is not replayed', () => {
  write(MAIN, meta(MAIN) + ev('task_started') + ev('task_complete') + ev('task_started') + ev('task_complete'));
  w.start();
  expect(events()).toEqual(['SessionSeen', 'SessionCwd']);
  expect(sessions[0]).toMatchObject({ sessionId: MAIN, agent: 'codex', cwd: '/work/proj' });
});

test('a turn in progress at startup yields one UserPromptSubmit and keeps the session active', () => {
  write(MAIN, meta(MAIN) + ev('task_started'));
  w.start();
  expect(events()).toEqual(['SessionSeen', 'SessionCwd', 'UserPromptSubmit']);
  expect([...w.getActiveSessionIds()]).toEqual([MAIN]);
});

test('live events: start, prompt, complete → Stop; session goes inactive', async () => {
  w.start();
  write(MAIN, meta(MAIN));
  await sleep(1300);
  append(MAIN, ev('task_started'));
  await sleep(700);
  expect([...w.getActiveSessionIds()]).toEqual([MAIN]);
  append(MAIN, ev('task_complete'));
  await sleep(700);
  expect(events()).toEqual(['SessionStart', 'SessionCwd', 'UserPromptSubmit', 'Stop']);
  expect(w.getActiveSessionIds().size).toBe(0);
});

test('interrupted turn maps to PostToolUseFailure (annoyed)', async () => {
  write(MAIN, meta(MAIN) + ev('task_started'));
  w.start();
  sessions.length = 0;
  append(MAIN, ev('turn_aborted', { reason: 'interrupted' }));
  await sleep(700);
  expect(events()).toEqual(['PostToolUseFailure']);
});

test('tool calls are tracked until their output; collaboration tools are exempt', async () => {
  write(MAIN, meta(MAIN) + ev('task_started')
    + item('function_call', { name: 'shell', call_id: 'c1' })
    + item('function_call', { name: 'wait_agent', namespace: 'collaboration', call_id: 'c2' }));
  w.start();
  const st = [...w._files.values()][0];
  expect([...st.pendingTools]).toEqual(['c1']);
  append(MAIN, item('function_call_output', { call_id: 'c1' }));
  await sleep(700);
  expect(st.pendingTools.size).toBe(0);
});

test('guardian review threads are ignored entirely', () => {
  write(GUARD, meta(GUARD, { source: { subagent: { other: 'guardian' } } }) + ev('task_started'));
  w.start();
  expect(sessions).toEqual([]);
  expect(subs).toEqual([]);
  expect(w.getActiveSessionIds().size).toBe(0);
});

test('spawned worker threads become sub-agents that stop on task_complete (live only)', async () => {
  w.start();
  write(WORKER, meta(WORKER, { source: { subagent: { thread_spawn: { parent_thread_id: MAIN } } } }));
  await sleep(1300);
  expect(subs.map((s) => s.event)).toEqual(['SubagentStart']);
  expect(subs[0]).toMatchObject({ sessionId: MAIN, parentToolId: `cx_${WORKER}`, agent: 'codex' });
  append(WORKER, ev('task_complete'));
  await sleep(700);
  expect(subs.map((s) => s.event)).toEqual(['SubagentStart', 'SubagentStop']);
  expect(sessions).toEqual([]);  // workers never register as their own pet session
});

test('workers already running at startup are not resurrected', () => {
  write(WORKER, meta(WORKER, { source: { subagent: { thread_spawn: {} } } }));
  w.start();
  expect(subs).toEqual([]);
});

test('stale rollouts are skipped, and a resumed one is picked up when touched', async () => {
  write(MAIN, meta(MAIN));
  const old = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(file(MAIN), old, old);
  w.start();
  expect(sessions).toEqual([]);
  fs.utimesSync(file(MAIN), new Date(), new Date());
  await sleep(1300);
  expect(events()[0]).toBe('SessionStart');
});

test('tolerates garbage lines and missing directories', () => {
  write(MAIN, 'not json\n' + meta(MAIN) + '{"truncated"');
  expect(() => w.start()).not.toThrow();
  expect(events()[0]).toBe('SessionSeen');
  const empty = new CodexWatcher({ sessionsDir: path.join(root, 'nope') });
  expect(() => empty.start()).not.toThrow();
  empty.stop();
});
