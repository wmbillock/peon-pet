const { summarizeAgents, isIdle, needsAttention } = require('../dash/summary');

const NOW = 1_000_000;
const ag = (id, extra = {}) => ({ id, hot: false, warm: false, live: false, role: 'worker', anim: null, animAt: 0, project: null, mark: null, ...extra });
const proj = (key, name, emoji) => ({ project: { key, name, emoji }, mark: { ring: `ring-${key}` } });

test('counts working, idle, and ignores quiet agents', () => {
  const s = summarizeAgents([ag('a', { hot: true, warm: true }), ag('b', { warm: true }), ag('c', {}), ag('d', { hot: true })], NOW);
  expect(s).toMatchObject({ total: 3, working: 2, idle: 1, attention: 0 });
});

test('a live master idle for hours is idle, not gone; a quiet worker is not counted', () => {
  expect(isIdle(ag('m', { role: 'master' }))).toBe(true);
  expect(isIdle(ag('l', { live: true }))).toBe(true);
  expect(isIdle(ag('w', {}))).toBe(false);
  expect(summarizeAgents([ag('m', { role: 'master' }), ag('w')], NOW)).toMatchObject({ total: 1, idle: 1 });
});

test('attention: a recent alarmed or annoyed reaction, expiring after two minutes', () => {
  expect(needsAttention(ag('a', { anim: 'alarmed', animAt: NOW - 1000 }), NOW)).toBe(true);
  expect(needsAttention(ag('a', { anim: 'annoyed', animAt: NOW - 119000 }), NOW)).toBe(true);
  expect(needsAttention(ag('a', { anim: 'alarmed', animAt: NOW - 121000 }), NOW)).toBe(false);
  expect(needsAttention(ag('a', { anim: 'celebrate', animAt: NOW }), NOW)).toBe(false);
  expect(summarizeAgents([ag('a', { hot: true, anim: 'alarmed', animAt: NOW - 5 })], NOW).attention).toBe(1);
});

test('projects are counted, busiest first, with their emoji and colour', () => {
  const s = summarizeAgents([
    ag('1', { warm: true, ...proj('p1', 'Euphonia', '🎼') }),
    ag('2', { hot: true, ...proj('p2', 'Pricing', '💲') }),
    ag('3', { warm: true, ...proj('p2', 'Pricing', '💲') }),
    ag('4', { warm: true, ...proj('p3', 'Libretto', '📚') }),
    ag('5', { warm: true, ...proj('p3', 'Libretto', '📚') }),
  ], NOW);
  expect(s.projects.map((p) => p.key)).toEqual(['p2', 'p3', 'p1']);   // working first, then by size
  expect(s.projects[0]).toMatchObject({ name: 'Pricing', emoji: '💲', count: 2, working: 1, ring: 'ring-p2' });
});

test('empty and missing inputs are fine', () => {
  expect(summarizeAgents([], NOW)).toEqual({ total: 0, working: 0, idle: 0, attention: 0, projects: [], limit: 0, over: false, overBy: 0 });
  expect(summarizeAgents(undefined, NOW).total).toBe(0);
});

describe('summaryTips (what the tooltips say)', () => {
  const { summaryTips } = require('../dash/summary');
  const t = (id, extra = {}) => ({ id, name: id, title: null, hot: false, warm: false, live: false, role: 'worker', firmRole: null, anim: null, animAt: 0, lastActive: NOW - 5000, project: null, mark: null, ...extra });
  const proj = (key, name, emoji) => ({ project: { key, name, emoji }, mark: { ring: 'r' } });

  test('each group has a heading with its count, the agents (working first), and a hint to click', () => {
    const tips = summaryTips([
      t('idle-one', { warm: true, lastActive: NOW - 90000, ...proj('p', 'Pricing', '💲') }),
      t('busy-one', { hot: true, warm: true, role: 'master', title: 'Euphonia', lastActive: NOW - 2000, ...proj('e', 'Euphonia', '🎼') }),
    ], NOW);
    expect(tips.working).toBe('1 working\n🎼 Euphonia · master · 2s\nClick to see them');
    expect(tips.idle).toBe('1 idle — between turns\n💲 idle-one · 1m\nClick to see them');
    expect(tips.projects.p.split('\n')[0]).toBe('💲 Pricing — 0 working, 1 idle');
    expect(tips.projects.e).toContain('Click to see only this project');
  });

  test('lists are capped with a "+N more", and the attention group reads correctly', () => {
    const many = Array.from({ length: 10 }, (_, i) => t(`a${i}`, { hot: true, lastActive: NOW - i * 1000 }));
    const lines = summaryTips(many, NOW).working.split('\n');
    expect(lines[0]).toBe('10 working');
    expect(lines.filter((l) => l.startsWith('a'))).toHaveLength(7);
    expect(lines).toContain('+3 more');
    const one = summaryTips([t('x', { hot: true, anim: 'alarmed', animAt: NOW - 100, firmRole: 'lead', title: 'Lead · Pricing' })], NOW);
    expect(one.attention.split('\n')[0]).toBe('1 needs you — alarmed or interrupted');
    expect(one.attention).toContain('Lead · Pricing · lead');
    expect(summaryTips([t('y', { hot: true, anim: 'alarmed', animAt: NOW }), t('z', { hot: true, anim: 'annoyed', animAt: NOW })], NOW).attention.split('\n')[0]).toBe('2 need you — alarmed or interrupted');
  });

  test('long names are clipped; empty groups still produce a heading', () => {
    expect(summaryTips([t('q', { hot: true, title: 'x'.repeat(60) })], NOW).working).toContain('x'.repeat(25) + '…');
    expect(summaryTips([], NOW).working).toBe('0 working\nClick to see them');
  });
});

describe('crowding limit', () => {
  const S = require('../dash/summary');
  const hot = (id) => ({ id, hot: true, warm: true });
  const agents = Array.from({ length: 6 }, (_, i) => hot(`a${i}`));
  test('over the limit when more agents are working than allowed, and by how many', () => {
    expect(S.summarizeAgents(agents, Date.now(), { limit: 4 })).toMatchObject({ working: 6, limit: 4, over: true, overBy: 2 });
    expect(S.summarizeAgents(agents, Date.now(), { limit: 6 })).toMatchObject({ over: false, overBy: 0 });
    expect(S.summarizeAgents(agents, Date.now(), { limit: 0 })).toMatchObject({ limit: 0, over: false });
    expect(S.summarizeAgents(agents)).toMatchObject({ over: false });                       // default: no limit
  });
  test('the working tooltip says how far over you are and what to do', () => {
    const t = S.summaryTips(agents, Date.now(), { limit: 4 }).working;
    expect(t).toMatch(/6 working — 2 over your limit of 4/);
    expect(t).toMatch(/hold new work/);
    expect(S.summaryTips(agents).working).toMatch(/^6 working\n/);
  });
});
