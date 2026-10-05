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
