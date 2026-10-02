const { buildAgents, wsFromCwd } = require('../lib/agent-graph');

const sess = (id, extra = {}) => ({ id, cwd: `/w/${id}`, name: id, title: null, role: 'master', hot: false, warm: true, lastActive: 1000, live: true, ...extra });
const thread = (id, role, extra = {}) => ({ id, title: id, role, status: 'running', cwd: '/f', sessionId: null, workstreamId: null, projectId: null, updatedAt: 0, ...extra });
const by = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

test('wsFromCwd finds a Firm workspace id in worktree paths only', () => {
  expect(wsFromCwd('/Users/me/.firm/worktrees/ws_1b90d2/_base/projects/the-firm')).toBe('ws_1b90d2');
  expect(wsFromCwd('/Users/me/.firm/worktrees/ws_6fc07f')).toBe('ws_6fc07f');
  expect(wsFromCwd('/Users/me/dev/ws_1b90d2')).toBeNull();
  expect(wsFromCwd(null)).toBeNull();
});

test('your own sessions are their own roots, masters first, stable order', () => {
  const out = buildAgents({ sessions: [sess('zeta'), sess('alpha'), sess('mid', { role: 'worker' })] });
  expect(out.map((r) => r.id)).toEqual(['alpha', 'zeta', 'mid']);
  expect(by(out).alpha).toMatchObject({ isRoot: true, rootId: 'alpha', groupId: 'agent:alpha', rank: 0 });
  expect(by(out).mid).toMatchObject({ isRoot: true, rank: 1 });   // an unattached worker is its own root, after masters
});

test('a workstream: lead is the root; workers/inspectors are its children, in role order', () => {
  const sessions = [sess('s-lead', { role: 'worker' }), sess('s-w1', { role: 'worker' }), sess('s-insp', { role: 'worker' })];
  const firmThreads = [
    thread('t-insp', 'inspector', { sessionId: 's-insp', workstreamId: 'ws_a' }),
    thread('t-w1', 'worker', { sessionId: 's-w1', workstreamId: 'ws_a' }),
    thread('t-lead', 'lead', { sessionId: 's-lead', workstreamId: 'ws_a' }),
  ];
  const out = buildAgents({ sessions, firmThreads });
  expect(out.map((r) => r.id)).toEqual(['s-lead', 's-w1', 's-insp']);
  const r = by(out);
  expect(r['s-lead']).toMatchObject({ role: 'master', firmRole: 'lead', isRoot: true, rank: 0, groupId: 'ws:ws_a' });
  expect(r['s-w1']).toMatchObject({ role: 'worker', isRoot: false, rootId: 's-lead', rank: 1 });
  expect(r['s-insp']).toMatchObject({ role: 'worker', rootId: 's-lead' });
});

test('Firm threads without a transcript session still appear (so Firm-launched agents are visible)', () => {
  const out = buildAgents({ sessions: [], firmThreads: [
    thread('management', 'management'),
    thread('t-lead', 'lead', { workstreamId: 'ws_b' }),
    thread('t-w', 'worker', { workstreamId: 'ws_b', status: 'idle' }),
    thread('t-dead', 'worker', { workstreamId: 'ws_b', status: 'error' }),
  ], now: 5000 });
  const r = by(out);
  expect(Object.keys(r)).toEqual(expect.arrayContaining(['firm:management', 'firm:t-lead', 'firm:t-w']));
  expect(r['firm:management']).toMatchObject({ kind: 'firm', role: 'master', isRoot: true, hot: true, status: 'busy', groupId: 'management' });
  expect(r['firm:t-w']).toMatchObject({ hot: false, warm: true, rootId: 'firm:t-lead' });
  expect(r['firm:t-dead']).toMatchObject({ warm: false, live: false });
});

test('registry workers in a Firm worktree join the workstream group even before the Firm API answers', () => {
  const out = buildAgents({ sessions: [
    sess('lead', { role: 'master', cwd: '/x' }),
    sess('wk', { role: 'worker', cwd: '/Users/me/.firm/worktrees/ws_ab12/_base/projects/the-firm' }),
    sess('wk2', { role: 'worker', cwd: '/Users/me/.firm/worktrees/ws_ab12/_base/projects/the-firm' }),
  ] });
  const r = by(out);
  expect(r.wk.groupId).toBe('ws:ws_ab12');
  expect(r.wk2.groupId).toBe('ws:ws_ab12');
  expect([r.wk.isRoot, r.wk2.isRoot].filter(Boolean)).toHaveLength(1);       // one stands in as root
  expect(r.wk.rootId).toBe(r.wk2.rootId);
  expect(r.lead.groupId).toBe('agent:lead');
});

test('a workstream with no lead falls back to the highest-ranking member as root', () => {
  const out = buildAgents({ sessions: [], firmThreads: [
    thread('i', 'inspector', { workstreamId: 'ws_c' }), thread('w', 'worker', { workstreamId: 'ws_c' }) ] });
  expect(out.find((r) => r.isRoot).id).toBe('firm:w');
});

test('input is not mutated and every row has group/root/order', () => {
  const s = [sess('a')];
  const out = buildAgents({ sessions: s });
  expect(s[0]).not.toHaveProperty('groupId');
  for (const r of out) for (const k of ['groupId', 'rootId', 'isRoot', 'rank', 'order', 'kind']) expect(r).toHaveProperty(k);
});

test('Management sorts first among masters, and a Firm title replaces the derived session name', () => {
  const out = buildAgents({
    sessions: [sess('aaa', { title: 'Aardvark' }), sess('lead-s', { title: 'the-firm-fd', role: 'worker' })],
    firmThreads: [thread('management', 'management', { title: 'Management' }), thread('l', 'lead', { sessionId: 'lead-s', workstreamId: 'ws_q', title: 'Lead · Pricing CLI' })],
  });
  expect(out[0]).toMatchObject({ firmRole: 'management' });
  expect(out.find((r) => r.id === 'lead-s').title).toBe('Lead · Pricing CLI');
  expect(out.find((r) => r.id === 'aaa').title).toBe('Aardvark');
});
