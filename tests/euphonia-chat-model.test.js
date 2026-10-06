const { initial, reduce, keyAction, MAX_MESSAGES } = require('../renderer/chat-model');
const ev = (s, event) => reduce(s, { type: 'event', event });

test('send then stream then done assembles one assistant message', () => {
  let s = reduce(initial(), { type: 'sent', turnId: 't1', text: 'hi' });
  expect(s.busy).toBe(true);
  s = ev(s, { type: 'start', turnId: 't1' });
  s = ev(s, { type: 'delta', turnId: 't1', text: 'Hel' });
  s = ev(s, { type: 'tool', turnId: 't1', name: 'Read' });
  expect(s.tool).toBe('Read');
  s = ev(s, { type: 'delta', turnId: 't1', text: 'lo' });
  expect(s.tool).toBeNull();
  expect(s.messages.map((m) => [m.role, m.text, !!m.pending])).toEqual([['user', 'hi', false], ['assistant', 'Hello', true]]);
  s = ev(s, { type: 'done', turnId: 't1', text: 'Hello' });
  expect(s.busy).toBe(false);
  expect(s.messages[1]).toEqual({ id: 't1:assistant', role: 'assistant', text: 'Hello' });
});

test('events arriving before start still create the message; start is idempotent', () => {
  let s = ev(initial(), { type: 'delta', turnId: 'a', text: 'x' });
  s = ev(s, { type: 'start', turnId: 'a' });
  expect(s.messages).toHaveLength(1);
});

test('error keeps streamed text, clears busy, exposes the message; empty placeholder is dropped', () => {
  let s = reduce(initial(), { type: 'sent', turnId: 't', text: 'q' });
  s = ev(s, { type: 'start', turnId: 't' });
  s = ev(s, { type: 'error', turnId: 't', message: 'claude not found' });
  expect(s).toMatchObject({ busy: false, error: 'claude not found' });
  expect(s.messages.map((m) => m.role)).toEqual(['user', 'error']);   // marker, not a gap
  s = reduce(s, { type: 'dismiss-error' });
  expect(s.error).toBeNull();

  let p = ev(reduce(initial(), { type: 'sent', turnId: 'u', text: 'q' }), { type: 'delta', turnId: 'u', text: 'part' });
  p = ev(p, { type: 'error', turnId: 'u', message: 'x' });
  expect(p.messages[1]).toEqual({ id: 'u:assistant', role: 'assistant', text: 'part' });
});

test('history loads user and assistant rows and is capped', () => {
  const records = Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => ({ ts: String(i), role: i % 2 ? 'assistant' : 'user', text: 'm' + i }));
  records.push({ role: 'system', text: 'ignored' });
  const s = reduce(initial(), { type: 'history', records });
  expect(s.messages).toHaveLength(MAX_MESSAGES);
  expect(s.messages.at(-1).text).toBe('m' + (MAX_MESSAGES + 4));
});

test('keyAction: Enter sends, Shift+Enter newline, busy/empty/IME block', () => {
  expect(keyAction({ key: 'Enter' }, { busy: false, text: 'hi' })).toBe('send');
  expect(keyAction({ key: 'Enter', shiftKey: true }, { busy: false, text: 'hi' })).toBe('newline');
  expect(keyAction({ key: 'Enter' }, { busy: true, text: 'hi' })).toBe('block');
  expect(keyAction({ key: 'Enter' }, { busy: false, text: '  ' })).toBe('block');
  expect(keyAction({ key: 'Enter', isComposing: true }, { busy: false, text: 'hi' })).toBe('none');
  expect(keyAction({ key: 'a' }, { busy: false, text: 'hi' })).toBe('none');
});

// ---- ordering regressions (owner smoke test: the "..." bubble rendered ABOVE the message it answers) ----
const view = (s) => s.messages.map((m) => [m.role, m.text]);
const failedHistory = ['Hi there', 'Hello Euphonia', 'Hey Ska Bot', 'hello?'].flatMap((text, i) => [
  { ts: `2026-10-05T20:5${i}:00.000Z`, turnId: `t${i}`, role: 'user', origin: 'user', text },
]);

test('failed history turns get an inline no-reply marker; the exact smoke-test sequence stays chronological', () => {
  let s = reduce(initial(), { type: 'history', records: failedHistory });
  expect(view(s)).toEqual([
    ['user', 'Hi there'], ['error', 'no reply (error)'], ['user', 'Hello Euphonia'], ['error', 'no reply (error)'],
    ['user', 'Hey Ska Bot'], ['error', 'no reply (error)'], ['user', 'hello?'], ['error', 'no reply (error)'],
  ]);
  const T = 't1791233831483-1';
  // IPC order in the real app: the main process emits `start` BEFORE the send invoke resolves in the renderer.
  s = ev(s, { type: 'start', turnId: T });
  s = reduce(s, { type: 'sent', turnId: T, text: 'hiya' });
  s = ev(s, { type: 'delta', turnId: T, text: 'Hiya! What can I do' });
  s = ev(s, { type: 'delta', turnId: T, text: ' for you?' });
  s = ev(s, { type: 'done', turnId: T, text: 'Hiya! What can I do for you?' });
  expect(view(s).slice(-2)).toEqual([['user', 'hiya'], ['assistant', 'Hiya! What can I do for you?']]);
  expect(s.messages).toHaveLength(10);
  expect(s.busy).toBe(false);
});

test('(a) send while idle in either arrival order: user first, then its own assistant bubble', () => {
  const order1 = ev(reduce(initial(), { type: 'sent', turnId: 'a', text: 'q' }), { type: 'start', turnId: 'a' });
  const order2 = reduce(ev(initial(), { type: 'start', turnId: 'a' }), { type: 'sent', turnId: 'a', text: 'q' });
  for (const s of [order1, order2]) expect(s.messages.map((m) => m.id)).toEqual(['a:user', 'a:assistant']);
});

test('(b) a second message sent while the first runs is queued below it and gets its placeholder only when its turn starts', () => {
  let s = reduce(initial(), { type: 'sent', turnId: 'a', text: 'one' });
  s = ev(s, { type: 'start', turnId: 'a' });
  s = ev(s, { type: 'delta', turnId: 'a', text: 'r1' });
  s = reduce(s, { type: 'sent', turnId: 'b', text: 'two' });
  expect(s.messages.map((m) => m.id)).toEqual(['a:user', 'a:assistant', 'b:user']);
  s = ev(s, { type: 'done', turnId: 'a', text: 'r1' });
  expect(s.busy).toBe(true);                       // b is still queued
  s = ev(s, { type: 'start', turnId: 'b' });
  s = ev(s, { type: 'delta', turnId: 'b', text: 'r2' });
  s = ev(s, { type: 'done', turnId: 'b', text: 'r2' });
  expect(view(s)).toEqual([['user', 'one'], ['assistant', 'r1'], ['user', 'two'], ['assistant', 'r2']]);
  expect(s.busy).toBe(false);
});

test('(c) an error on a turn leaves its user message followed by the marker, not a gap', () => {
  let s = reduce(initial(), { type: 'sent', turnId: 'a', text: 'q' });
  s = ev(s, { type: 'start', turnId: 'a' });
  s = ev(s, { type: 'error', turnId: 'a', message: 'boom' });
  expect(view(s)).toEqual([['user', 'q'], ['error', 'no reply (error)']]);
  expect(s.error).toBe('boom');
});

test('(d) window reopened mid-stream: the running turn gets a live placeholder; queued turns get none; later events attach by turnId', () => {
  const records = [
    { ts: '2026-10-05T20:00:00.000Z', turnId: 'old', role: 'user', text: 'old q' },
    { ts: '2026-10-05T20:00:05.000Z', turnId: 'old', role: 'assistant', text: 'old a' },
    { ts: '2026-10-05T20:01:00.000Z', turnId: 'run', role: 'user', text: 'running q' },
    { ts: '2026-10-05T20:01:01.000Z', turnId: 'next', role: 'user', text: 'queued q' },
  ];
  let s = reduce(initial(), { type: 'history', records, active: { running: 'run', queued: ['next'] } });
  expect(s.messages.map((m) => m.id)).toEqual(['old:user', 'old:assistant', 'run:user', 'run:assistant', 'next:user']);
  expect(s.busy).toBe(true);
  s = ev(s, { type: 'delta', turnId: 'run', text: 'live' });
  expect(s.messages.find((m) => m.id === 'run:assistant').text).toBe('live');
  s = ev(s, { type: 'done', turnId: 'run', text: 'live done' });
  expect(s.busy).toBe(true);                       // `next` still queued
  s = ev(s, { type: 'start', turnId: 'next' });
  s = ev(s, { type: 'done', turnId: 'next', text: 'n' });
  expect(s.messages.map((m) => m.id)).toEqual(['old:user', 'old:assistant', 'run:user', 'run:assistant', 'next:user', 'next:assistant']);
  expect(s.busy).toBe(false);
});

test('a done that beats the sent action does not leave the chat stuck busy', () => {
  let s = ev(initial(), { type: 'start', turnId: 'a' });
  s = ev(s, { type: 'done', turnId: 'a', text: 'fast' });
  s = reduce(s, { type: 'sent', turnId: 'a', text: 'q' });
  expect(s.busy).toBe(false);
  expect(view(s)).toEqual([['user', 'q'], ['assistant', 'fast']]);
});

describe('drafts for Management', () => {
  const M = require('../renderer/chat-model');
  test('a fenced management block becomes a draft segment; surrounding text stays text', () => {
    const text = 'Here is the message:\n```management\nCreate Jira tickets under PPE-2832.\nDo not close issues.\n```\nPress send when ready.';
    expect(M.parseSegments(text)).toEqual([
      { type: 'text', text: 'Here is the message:\n' },
      { type: 'draft', text: 'Create Jira tickets under PPE-2832.\nDo not close issues.' },
      { type: 'text', text: '\nPress send when ready.' },
    ]);
  });
  test('plain replies, other code fences and empty drafts are never drafts', () => {
    expect(M.parseSegments('just text')).toEqual([{ type: 'text', text: 'just text' }]);
    expect(M.parseSegments('```js\nconsole.log(1)\n```').some((x) => x.type === 'draft')).toBe(false);
    expect(M.parseSegments('```management\n   \n```').some((x) => x.type === 'draft')).toBe(false);
    expect(M.parseSegments('')).toEqual([{ type: 'text', text: '' }]);
  });
  test('several drafts in one reply are each their own segment', () => {
    expect(M.parseSegments('```management\none\n``` and ```management\ntwo\n```').filter((x) => x.type === 'draft').map((x) => x.text)).toEqual(['one', 'two']);
  });
});
