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
  expect(summarizeAgents([], NOW)).toEqual({ total: 0, working: 0, idle: 0, attention: 0, projects: [] });
  expect(summarizeAgents(undefined, NOW).total).toBe(0);
});
