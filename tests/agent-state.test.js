// The agent status bar's model: working / waiting / finished, from process liveness first and output age second.
// Everything here is fake: a fake clock, a fake process list (pid → alive), a fake registry directory. No test starts claude or codex.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildSessionStates, createSessionTracker } = require('../lib/session-tracker');
const { readSessionRegistry } = require('../lib/live-agents');
const { selectAgents } = require('../lib/agent-graph');
const { summarizeAgents, stateOf } = require('../dash/summary');

const NOW = 10_000_000;
const HOT_MS = 30_000, WARM_MS = 120_000;
const UUID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

// What main.js does: the tracker's clock gives hot/warm; the live set (from the pid-checked registry) gives live.
function rowsFor(files, liveIds, now = NOW) {
  const tracker = createSessionTracker();
  for (const [id, ageMs] of Object.entries(files)) tracker.update(id, now - ageMs);
  return buildSessionStates(tracker.entries(), now, HOT_MS, WARM_MS, 200)
    .map((s) => ({ ...s, live: liveIds.has(s.id), role: 'master', cwd: `/w/${s.id}`, name: s.id, lastActive: now - files[s.id] }));
}

describe('classification table (a session file, and whether its process is alive)', () => {
  //            name                         file age   alive  → state
  const table = [
    ['writing now',                          5_000,    true,  'working'],
    ['live, output 31s ago',                31_000,    true,  'waiting'],
    ['live, file touched 3 minutes ago',   180_000,    true,  'waiting'],     // used to read "idle" only by luck; now it is waiting because it is alive
    ['live, file untouched for hours',   3 * 3600e3,   true,  'waiting'],
    ['no process, file touched 3m ago',    180_000,    false, 'finished'],
    ['no process, old file',             6 * 3600e3,   false, 'finished'],     // the finished collectors (slack-summary, meeting-notes, ...)
    ['no process, written a minute ago',    60_000,    false, 'finished'],     // a quiet file alone never makes an agent waiting
  ];
  test.each(table)('%s', (_name, age, alive, want) => {
    const rows = rowsFor({ [UUID(1)]: age }, alive ? new Set([UUID(1)]) : new Set());
    // A busy registry entry or fresh output is "hot"; liveness is checked by the registry, not by age.
    expect(stateOf(rows[0])).toBe(want);
  });

  test('a registry session that says busy is working even with a quiet file (the main process keeps it hot)', () => {
    const rows = rowsFor({ [UUID(2)]: 0 }, new Set([UUID(2)]));   // main.js calls tracker.update(now) for every busy id each tick
    expect(stateOf(rows[0])).toBe('working');
  });
});

describe('The Firm threads', () => {
  const thread = (id, status, extra = {}) => ({ id, title: id, role: 'worker', status, cwd: '/f', sessionId: null, workstreamId: 'ws_a', projectId: null, updatedAt: 0, ...extra });
  const states = (firmThreads, rows = []) => Object.fromEntries(selectAgents({ rows, firmThreads, now: NOW }).agents.map((a) => [a.id, stateOf(a)]));

  test('running is working, starting and waiting are waiting, done / error / disconnected are not agents at all', () => {
    const got = states([thread('r', 'running'), thread('s', 'starting'), thread('w', 'waiting'), thread('d', 'done'), thread('e', 'error'), thread('x', 'disconnected')]);
    expect(got).toEqual({ 'firm:r': 'working', 'firm:s': 'waiting', 'firm:w': 'waiting' });
  });

  test('a finished thread whose session process is still alive keeps its row and its Firm identity', () => {
    const rows = rowsFor({ [UUID(3)]: 200_000 }, new Set([UUID(3)]));
    const { agents } = selectAgents({ rows, firmThreads: [thread('t', 'done', { sessionId: UUID(3) })], now: NOW });
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ id: UUID(3), firmRole: 'worker' });
    expect(stateOf(agents[0])).toBe('waiting');
  });

  test('Firm agents are counted apart from local sessions, and both are in the totals', () => {
    const rows = rowsFor({ [UUID(4)]: 1_000, [UUID(5)]: 200_000 }, new Set([UUID(4), UUID(5)]));
    const { agents } = selectAgents({ rows, firmThreads: [thread('r', 'running'), thread('w', 'waiting')], now: NOW });
    expect(summarizeAgents(agents, NOW)).toMatchObject({ total: 4, working: 2, waiting: 2, local: { working: 1, waiting: 1 }, firm: { working: 1, waiting: 1 } });
  });
});

describe('the bar never invents agents', () => {
  test('counted agents never exceed what the indexer returned, and counted + finished add up to it', () => {
    const files = {}; const live = new Set();
    for (let i = 1; i <= 60; i++) { files[UUID(i)] = i * 20_000; if (i % 3 === 0) live.add(UUID(i)); }
    const rows = rowsFor(files, live);
    const s = summarizeAgents(rows, NOW);
    expect(s.total).toBeLessThanOrEqual(rows.length);
    expect(s.total + s.finished).toBe(rows.length);
    expect(s.total).toBe(rows.filter((r) => r.hot || live.has(r.id)).length);   // fresh output (working) or a live process (waiting)
  });

  test('the cap is reported, not silent, and a finished Firm thread never takes a slot', () => {
    const threads = [...Array.from({ length: 60 }, (_, i) => ({ id: `d${i}`, title: `d${i}`, role: 'worker', status: 'done', cwd: '/f', sessionId: null, workstreamId: 'ws_a', updatedAt: 0 })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, title: `r${i}`, role: 'worker', status: 'running', cwd: '/f', sessionId: null, workstreamId: 'ws_a', updatedAt: 0 }))];
    const r = selectAgents({ rows: [], firmThreads: threads, now: NOW, cap: 48 });
    expect(r.agents).toHaveLength(5);
    expect(r.capped).toBe(0);
    const over = selectAgents({ rows: [], firmThreads: threads.filter((t) => t.status === 'running'), now: NOW, cap: 3 });
    expect(over).toMatchObject({ capped: 2 });
    expect(over.agents).toHaveLength(3);
  });
});

describe('the registry is the process list (a fake one)', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-state-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('only sessions whose pid is alive become live', () => {
    for (const [pid, n] of [[101, 1], [102, 2], [103, 3]]) fs.writeFileSync(path.join(dir, `${pid}.json`), JSON.stringify({ pid, sessionId: UUID(n), cwd: `/w/${n}`, entrypoint: 'cli' }));
    const alive = new Set([101, 103]);
    const live = new Set(readSessionRegistry({ dir, isAlive: (pid) => alive.has(pid) }).map((r) => r.sessionId));
    expect([...live].sort()).toEqual([UUID(1), UUID(3)]);
    const rows = rowsFor({ [UUID(1)]: 400_000, [UUID(2)]: 400_000, [UUID(3)]: 1_000 }, live);
    expect(Object.fromEntries(rows.map((r) => [r.id, stateOf(r)]))).toEqual({ [UUID(1)]: 'waiting', [UUID(2)]: 'finished', [UUID(3)]: 'working' });
  });
});
