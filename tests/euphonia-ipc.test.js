const { registerEuphoniaIpc } = require('../lib/euphonia/ipc');

function setup({ muted = false } = {}) {
  const handlers = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
  const pet = { isDestroyed: () => false, send: jest.fn() };
  const dash = { id: 'dash' };
  let listener;
  const svc = {
    subscribe: (fn) => { listener = fn; }, send: jest.fn(() => ({ turnId: 't1' })), history: () => [], getConfig: () => ({ soundPack: 'p' }),
    getSession: () => null, setConfig: jest.fn((c) => ({ soundPack: 'p', ...c })), resetSession: () => true,
  };
  const play = jest.fn();
  registerEuphoniaIpc({ ipcMain, getPetWebContents: () => pet, getSenders: () => [dash], getService: () => svc, peonDir: () => '/nowhere', listPacks: () => [{ name: 'p' }, { name: 'q' }], isMuted: () => muted, getVolume: () => 0.5, play });
  return { handlers, pet, dash, svc, play, emit: (ev) => listener(ev) };
}

test('only the pet window may send; the message carries origin user', async () => {
  const t = setup();
  expect(await t.handlers['euphonia-send']({ sender: t.dash }, 'hi')).toMatchObject({ ok: false });
  expect(t.svc.send).not.toHaveBeenCalled();
  expect(await t.handlers['euphonia-send']({ sender: t.pet }, 'hi')).toEqual({ ok: true, turnId: 't1' });
  expect(t.svc.send).toHaveBeenCalledWith('hi', { origin: 'user' });
});

test('events are forwarded to the pet and a cue plays on done unless muted', async () => {
  const t = setup();
  await t.handlers['euphonia-send']({ sender: t.pet }, 'hi');
  t.emit({ type: 'delta', text: 'x' });
  t.emit({ type: 'done' });
  expect(t.pet.send).toHaveBeenCalledTimes(2);
  expect(t.play).toHaveBeenCalledTimes(1);
  const m = setup({ muted: true });
  await m.handlers['euphonia-send']({ sender: m.pet }, 'hi');
  m.emit({ type: 'done' });
  expect(m.play).not.toHaveBeenCalled();
});

test('config: sound pack must be installed; strangers are refused', async () => {
  const t = setup();
  expect((await t.handlers['euphonia-set-config']({ sender: t.dash }, { soundPack: 'q' })).ok).toBe(true);
  expect((await t.handlers['euphonia-set-config']({ sender: t.dash }, { soundPack: 'nope' })).ok).toBe(false);
  expect((await t.handlers['euphonia-set-config']({ sender: {} }, { soundPack: 'q' })).ok).toBe(false);
});
