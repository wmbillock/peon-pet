const { createFirmClient, createFirmPoller, normalizeThread, parseBaseUrl } = require('../lib/firm-client');

const RAW = { id: 'ws_ab_lead', title: 'Lead', role: 'lead', status: 'running', cwd: '/w', session_id: 'sess-1', workstream_id: 'ws_ab',
  project_id: 'p1', bead_id: null, created_at: 5, updated_at: 9, last_message: 'x'.repeat(900), context_pct: 41.5, cost_usd: 1.234, model: 'm' };

test('normalizeThread maps fields and truncates long messages', () => {
  const t = normalizeThread(RAW);
  expect(t).toMatchObject({ id: 'ws_ab_lead', role: 'lead', status: 'running', sessionId: 'sess-1', workstreamId: 'ws_ab', projectId: 'p1', contextPct: 41.5, costUsd: 1.234 });
  expect(t.lastMessage).toHaveLength(400);
  expect(normalizeThread({ id: 7 })).toMatchObject({ id: '7', role: 'worker', status: 'unknown', sessionId: null, workstreamId: null });
});

test('only loopback http URLs are accepted', () => {
  expect(parseBaseUrl('http://127.0.0.1:8420/')).toBe('http://127.0.0.1:8420');
  expect(parseBaseUrl('http://localhost:9')).toBe('http://localhost:9');
  for (const bad of ['http://192.168.1.5:8420', 'https://127.0.0.1', 'http://example.com', 'nonsense', 'file:///etc/passwd']) {
    expect(() => parseBaseUrl(bad)).toThrow();
  }
});

test('client fetches /api/threads and validates the reply', async () => {
  const calls = [];
  const ok = createFirmClient({ fetchImpl: async (url) => { calls.push(url); return { ok: true, json: async () => [RAW, { nope: 1 }] }; } });
  const threads = await ok.threads();
  expect(calls).toEqual(['http://127.0.0.1:8420/api/threads']);
  expect(threads).toHaveLength(1);
  await expect(createFirmClient({ fetchImpl: async () => ({ ok: false, status: 503 }) }).threads()).rejects.toThrow(/HTTP 503/);
  await expect(createFirmClient({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }).threads()).rejects.toThrow(/Unexpected/);
});

describe('poller', () => {
  test('reports availability, tolerates one blip, flips after two failures, recovers', async () => {
    let mode = 'ok';
    const client = { threads: async () => { if (mode === 'ok') return [normalizeThread(RAW)]; throw new Error('down'); } };
    const changes = [], flips = [];
    const p = createFirmPoller({ client, intervalMs: 1e9, onChange: (s) => changes.push(s.available), onTransition: (s) => flips.push(s.available) });
    await p.refresh();
    expect(p.state).toMatchObject({ available: true });
    mode = 'down';
    await p.refresh();                       // one failure: still available
    expect(p.state.available).toBe(true);
    await p.refresh();                       // second failure: unavailable
    expect(p.state).toMatchObject({ available: false, error: 'down', threads: [] });
    mode = 'ok';
    await p.refresh();
    expect(p.state.available).toBe(true);
    expect(flips).toEqual([true, false, true]);
  });

  test('never available when the first poll fails', async () => {
    const p = createFirmPoller({ client: { threads: async () => { throw new Error('refused'); } }, intervalMs: 1e9 });
    await p.refresh();
    expect(p.state).toMatchObject({ available: false, error: 'refused' });
  });
});

describe('projects and identity supplied at instantiation', () => {
  const { normalizeProject } = require('../lib/firm-client');

  test('normalizeProject reads the title and, when The Firm supplies it, emoji / hue / frame / background', () => {
    expect(normalizeProject({ id: 'p1', title: 'Pricing CLI' })).toEqual({ id: 'p1', title: 'Pricing CLI', emoji: null, hue: null, frame: null, env: null });
    expect(normalizeProject({ id: 7, name: 'X', emoji: ' 💲 ', color_hue: 215.4, frame: 'gold', environment: 'jazz-club' }))
      .toEqual({ id: '7', title: 'X', emoji: '💲', hue: 215, frame: 'gold', env: 'jazz-club' });
    // junk is dropped, not trusted
    expect(normalizeProject({ id: 'p', hue: 999, emoji: 'x'.repeat(40), frame: '../etc', env: 'Has Space' }))
      .toEqual({ id: 'p', title: null, emoji: null, hue: null, frame: null, env: null });
  });

  test('normalizeThread keeps an agent type only when it is a clean slug', () => {
    expect(normalizeThread({ id: 't', agent_type: 'retro-robot' }).agentType).toBe('retro-robot');
    expect(normalizeThread({ id: 't', agent_type: 'Has Space' }).agentType).toBeNull();
    expect(normalizeThread({ id: 't' }).agentType).toBeNull();
  });

  test('client reads /api/projects; poller exposes id → project; a missing endpoint is tolerated', async () => {
    const calls = [];
    const client = createFirmClient({ fetchImpl: async (url) => { calls.push(url); return { ok: true, json: async () => [{ id: 'p1', title: 'Pricing CLI', emoji: '💲' }, { id: 'p2', name: 'Euphonia' }, { nope: 1 }] }; } });
    const list = await client.projects();
    expect(list.map((p) => [p.id, p.title, p.emoji])).toEqual([['p1', 'Pricing CLI', '💲'], ['p2', 'Euphonia', null]]);
    expect(calls).toEqual(['http://127.0.0.1:8420/api/projects']);

    const p = createFirmPoller({ client: { threads: async () => [normalizeThread(RAW)], projects: async () => [{ id: 'p1', title: 'Pricing CLI', emoji: '💲', id_: 1 }] }, intervalMs: 1e9 });
    await p.refresh();
    expect(p.state.projects.p1).toMatchObject({ id: 'p1', title: 'Pricing CLI', emoji: '💲' });

    const q = createFirmPoller({ client: { threads: async () => [normalizeThread(RAW)], projects: async () => { throw new Error('404'); } }, intervalMs: 1e9 });
    await q.refresh();
    expect(q.state).toMatchObject({ available: true, projects: {} });
  });
});
