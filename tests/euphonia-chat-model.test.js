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
  expect(s.messages.map((m) => m.role)).toEqual(['user']);
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
