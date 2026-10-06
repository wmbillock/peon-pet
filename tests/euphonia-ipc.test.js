const { registerEuphoniaIpc } = require('../lib/euphonia/ipc');

function setup({ muted = false } = {}) {
  const handlers = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} };
  const pet = { isDestroyed: () => false, send: jest.fn() };
  const chat = { isDestroyed: () => false, send: jest.fn() };
  const dash = { id: 'dash' };
  let listener, marker = null, cfg = { soundPack: 'p' };
  const svc = {
    subscribe: (fn) => { listener = fn; }, send: jest.fn(() => ({ turnId: 't1' })), history: () => [], getConfig: () => cfg,
    getSession: () => null, setConfig: jest.fn((c) => { cfg = { ...cfg, ...c }; return cfg; }), resetSession: () => true,
    getReadMarker: () => marker, setReadMarker: (m) => { marker = m; },
  };
  const play = jest.fn();
  registerEuphoniaIpc({
    ipcMain, getPetWebContents: () => pet, getChat: { webContents: () => chat, isActive: () => false, open: () => {} },
    getSenders: () => [dash], getService: () => svc, peonDir: () => '/nowhere', listPacks: () => [{ name: 'p' }, { name: 'q' }], isMuted: () => muted, getVolume: () => 0.5, play,
  });
  return { handlers, pet, chat, dash, svc, play, emit: (ev) => listener(ev) };
}

test('only the chat window may send; the message carries origin user', async () => {
  const t = setup();
  expect(await t.handlers['euphonia-send']({ sender: t.dash }, 'hi')).toMatchObject({ ok: false });
  expect(await t.handlers['euphonia-send']({ sender: t.pet }, 'hi')).toMatchObject({ ok: false });
  expect(t.svc.send).not.toHaveBeenCalled();
  expect(await t.handlers['euphonia-send']({ sender: t.chat }, 'hi')).toEqual({ ok: true, turnId: 't1' });
  expect(t.svc.send).toHaveBeenCalledWith('hi', { origin: 'user' });
});

test('events go to the chat window and a cue plays on done unless muted', async () => {
  const t = setup();
  await t.handlers['euphonia-send']({ sender: t.chat }, 'hi');
  t.emit({ type: 'delta', text: 'x' });
  t.emit({ type: 'done' });
  expect(t.chat.send).toHaveBeenCalledTimes(2);
  expect(t.play).toHaveBeenCalledTimes(1);
  const m = setup({ muted: true });
  await m.handlers['euphonia-send']({ sender: m.chat }, 'hi');
  m.emit({ type: 'done' });
  expect(m.play).not.toHaveBeenCalled();
});

test('config: sound pack must be installed; strangers are refused', async () => {
  const t = setup();
  expect((await t.handlers['euphonia-set-config']({ sender: t.dash }, { soundPack: 'q' })).ok).toBe(true);
  expect((await t.handlers['euphonia-set-config']({ sender: t.dash }, { soundPack: 'nope' })).ok).toBe(false);
  expect((await t.handlers['euphonia-set-config']({ sender: {} }, { soundPack: 'q' })).ok).toBe(false);
});

test('"allow reading on all connected servers" is dashboard-only, grants read blanket on connected servers only, then learns tool names', async () => {
  const t = setup();
  const granted = [];
  t.svc.discoverServers = () => ({ servers: [{ name: 'jira', status: 'connected' }, { name: 'atlan', status: 'needs-auth' }, { name: 'notion', status: 'connected' }], errors: [] });
  t.svc.grants = { grant: (g) => granted.push(g), list: () => granted };
  t.svc.learnTools = jest.fn(async () => ({ jira: 20, notion: 47 }));
  expect(await t.handlers['euphonia-access-grant-connected']({ sender: t.chat })).toMatchObject({ ok: false });
  expect(await t.handlers['euphonia-access-grant-connected']({ sender: t.pet })).toMatchObject({ ok: false });
  expect(granted).toEqual([]);
  const r = await t.handlers['euphonia-access-grant-connected']({ sender: t.dash });
  expect(r).toMatchObject({ ok: true, granted: ['jira', 'notion'], learned: { jira: 20, notion: 47 } });
  expect(granted.map((g) => `${g.server}:${g.level}:${g.duration}`)).toEqual(['jira:read:blanket', 'notion:read:blanket']);
  expect(t.svc.learnTools).toHaveBeenCalledTimes(1);
});

test('the Send to Management button: chat window only, checks the text, and sends through the injected sender', async () => {
  const handlers = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} };
  const chat = { isDestroyed: () => false, send: jest.fn() }, pet = { isDestroyed: () => false, send: jest.fn() }, dash = { id: 'dash' };
  const sent = [];
  const sendToFirm = jest.fn(async (text) => { sent.push(text); return text.includes('REFUSE') ? { isError: true, text: 'Refused: no unexpired grant' } : { isError: false, text: 'ok' }; });
  registerEuphoniaIpc({ ipcMain, getPetWebContents: () => pet, getChat: { webContents: () => chat, isActive: () => false, open: () => {} }, getSenders: () => [dash],
    getService: () => ({ subscribe: () => {}, history: () => [], getConfig: () => ({}), getSession: () => null }), peonDir: () => '/x', listPacks: () => [], isMuted: () => true, getVolume: () => 0.5, sendToFirm });
  const h = handlers['euphonia-send-draft'];
  expect(await h({ sender: dash }, 'hi')).toMatchObject({ ok: false });
  expect(await h({ sender: pet }, 'hi')).toMatchObject({ ok: false });
  expect(sent).toEqual([]);                                                       // no other window can send
  expect(await h({ sender: chat }, '   ')).toMatchObject({ ok: false });
  expect(await h({ sender: chat }, 'x'.repeat(4001))).toMatchObject({ ok: false });
  expect(await h({ sender: chat }, 42)).toMatchObject({ ok: false });
  expect(await h({ sender: chat }, '  do the thing  ')).toEqual({ ok: true, text: 'ok' });
  expect(sent).toEqual(['do the thing']);                                          // exactly the text shown, trimmed
  expect(await h({ sender: chat }, 'REFUSE this')).toEqual({ ok: false, text: 'Refused: no unexpired grant' });   // the grant check's refusal comes back to the button
});
