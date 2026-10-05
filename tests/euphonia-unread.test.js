const fs = require('fs');
const os = require('os');
const path = require('path');
const { countUnread, latestAssistant, createUnreadTracker } = require('../lib/euphonia/unread');
const { createChatWindowManager } = require('../lib/euphonia/chat-window');
const { createEuphonia } = require('../lib/euphonia/service');
const { registerEuphoniaIpc } = require('../lib/euphonia/ipc');
const { describeSession } = require('../renderer/chat-model');

const a = (n) => ({ ts: `2026-10-05T12:00:0${n}.000Z`, turnId: `t${n}`, role: 'assistant', text: 'r' + n });
const u = (n) => ({ ts: `2026-10-05T12:00:0${n}.000Z`, turnId: `t${n}`, role: 'user', text: 'q' + n });

test('countUnread: everything is unread without a marker; only newer assistant messages after one', () => {
  const recs = [u(1), a(1), u(2), a(2), a(3)];
  expect(countUnread(recs, null)).toBe(3);
  expect(countUnread(recs, { ts: a(1).ts, id: 't1' })).toBe(2);
  expect(countUnread(recs, { ts: a(3).ts, id: 't3' })).toBe(0);
  expect(countUnread(recs, { ts: '2026-10-05T12:00:02.000Z', id: 'gone' })).toBe(1);   // marker's message missing: fall back to time
  expect(countUnread([u(1)], null)).toBe(0);
  expect(latestAssistant(recs).turnId).toBe('t3');
});

function fakeService(records, marker = null) {
  return { history: () => records, getReadMarker: () => marker, setReadMarker: (m) => { marker = m; } };
}

test('reply arriving while the chat is closed or unfocused shows the dot; focused shows none; focus clears', () => {
  const recs = [u(1)];
  let active = false; const seen = [];
  const svc = fakeService(recs);
  const t = createUnreadTracker({ service: svc, isChatActive: () => active, notify: (n) => seen.push(n) });
  t.refresh();                                   // nothing yet
  recs.push(a(1)); t.refresh();                  // arrives while closed
  expect(seen.at(-1)).toBe(1);
  recs.push(a(2)); t.refresh();
  expect(seen.at(-1)).toBe(2);
  active = true; t.refresh();                    // chat focused and showing: read
  expect(seen.at(-1)).toBe(0);
  recs.push(a(3)); t.refresh();                  // arrives while focused: no dot
  expect(seen.at(-1)).toBe(0);
  active = false; recs.push(a(4)); t.refresh();  // blurred, then another
  expect(seen.at(-1)).toBe(1);
});

test('the read marker persists across a restart: no stale dot, no lost real one', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'unr-'));
  const mk = () => createEuphonia({ home, hubDir: path.join(home, 'hub'), user: 'w', spawnImpl: () => { throw new Error('no cli'); } });
  let e = mk();
  fs.appendFileSync(e.paths.transcript, [a(1), a(2)].map((r) => JSON.stringify(r)).join('\n') + '\n');
  expect(countUnread(e.history(), e.getReadMarker())).toBe(2);
  e.setReadMarker({ ts: a(1).ts, id: 't1' });
  e = mk();                                      // "relaunch"
  expect(countUnread(e.history(), e.getReadMarker())).toBe(1);
  e.setReadMarker({ ts: a(2).ts, id: 't2' });
  expect(countUnread(mk().history(), mk().getReadMarker())).toBe(0);
});

test('session header text', () => {
  const now = Date.parse('2026-10-05T12:10:00Z');
  expect(describeSession(null)).toBe('new conversation');
  expect(describeSession({ turns: 0 })).toBe('new conversation');
  expect(describeSession({ turns: 1, updated_at: '2026-10-05T12:09:30Z' }, now)).toBe('1 turn, active just now');
  expect(describeSession({ turns: 4, updated_at: '2026-10-05T11:55:00Z' }, now)).toBe('4 turns, last active 15 min ago');
});

// ---- window manager with an injected fake BrowserWindow ----
function fakeBW() {
  const made = [];
  class BW {
    constructor(opts) { this.opts = opts; this.handlers = {}; this.destroyed = false; this.visible = true; this.minimized = false; this.focused = false; this.bounds = { x: 1, y: 2, width: opts.width, height: opts.height }; this.focusCalls = 0; this.webContents = { id: made.length, isDestroyed: () => this.destroyed }; made.push(this); }
    loadFile(f) { this.file = f; }
    on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
    emit(ev) { (this.handlers[ev] || []).forEach((f) => f()); }
    isDestroyed() { return this.destroyed; } isVisible() { return this.visible; } isMinimized() { return this.minimized; } isFocused() { return this.focused; }
    show() { this.visible = true; } restore() { this.minimized = false; } focus() { this.focused = true; this.focusCalls++; this.emit('focus'); }
    getBounds() { return this.bounds; }
    close() { this.destroyed = true; this.emit('closed'); }
  }
  return { BW, made };
}

test('chat window: single instance, second click focuses, bounds persist, close keeps the session', () => {
  const { BW, made } = fakeBW();
  const saved = []; const changes = []; const timers = [];
  let stored = { x: 40, y: 50, width: 500, height: 600 };
  const m = createChatWindowManager({
    BrowserWindow: BW, file: 'chat/index.html', webPreferences: {}, loadBounds: () => stored, saveBounds: (b) => { saved.push(b); stored = b; },
    onActiveChange: (v) => changes.push(v), setTimeoutImpl: (fn) => { timers.push(fn); return timers.length; }, clearTimeoutImpl: () => {},
  });
  const w = m.open();
  expect(made).toHaveLength(1);
  expect(w.opts).toMatchObject({ width: 500, height: 600, x: 40, y: 50, resizable: true, focusable: true, title: 'Euphonia' });
  expect(w.file).toBe('chat/index.html');
  w.minimized = true;
  expect(m.open()).toBe(w);                       // second click: same window, restored and focused
  expect(made).toHaveLength(1);
  expect(w.minimized).toBe(false);
  expect(m.isActive()).toBe(true);
  w.bounds = { x: 7, y: 8, width: 450, height: 520 };
  w.emit('resize'); timers.at(-1)();              // debounced save
  expect(saved.at(-1)).toEqual({ x: 7, y: 8, width: 450, height: 520 });
  w.close();                                      // closing the window does not touch the service
  expect(m.isOpen()).toBe(false);
  expect(m.isActive()).toBe(false);
  expect(changes.at(-1)).toBe(false);
  const w2 = m.open();                            // reopens at the remembered bounds
  expect(made).toHaveLength(2);
  expect(w2.opts).toMatchObject({ width: 450, height: 520, x: 7, y: 8 });
});

// ---- IPC: the pet window gets only the dot, never chat content ----
test('streaming goes to the chat window; the pet window receives only the unread count', async () => {
  const handlers = {}, ons = {};
  const ipcMain = { handle: (c, f) => { handlers[c] = f; }, on: (c, f) => { ons[c] = f; } };
  const mkWc = () => ({ sent: [], isDestroyed: () => false, send(ch, p) { this.sent.push([ch, p]); } });
  const pet = mkWc(), chat = mkWc();
  let chatOpen = false, active = false, opened = 0, listener;
  const records = []; let marker = null;
  const svc = {
    subscribe: (fn) => { listener = fn; }, send: () => ({ turnId: 't1' }), history: () => records, getConfig: () => ({ soundPack: 'p' }), getSession: () => null,
    getReadMarker: () => marker, setReadMarker: (m) => { marker = m; }, setConfig: (c) => c, resetSession: () => true,
  };
  const ipc = registerEuphoniaIpc({
    ipcMain, getPetWebContents: () => pet, getService: () => svc, peonDir: () => '/x', listPacks: () => [], isMuted: () => true, getVolume: () => 0.5,
    getChat: { webContents: () => (chatOpen ? chat : null), isActive: () => active, open: () => { opened++; chatOpen = true; } },
  });
  // chat not open: only the pet may ask to open it; the pet cannot send messages
  expect((await handlers['euphonia-send']({ sender: pet }, 'hi')).ok).toBe(false);
  ons['euphonia-open-chat']({ sender: chat });  expect(opened).toBe(0);
  ons['euphonia-open-chat']({ sender: pet });   expect(opened).toBe(1);
  expect((await handlers['euphonia-send']({ sender: chat }, 'hi')).ok).toBe(true);
  listener({ type: 'delta', text: 'x' });
  records.push(a(1)); listener({ type: 'done', text: 'r1' });
  expect(chat.sent.map((s) => s[0])).toEqual(['euphonia-event', 'euphonia-event']);
  expect(pet.sent).toEqual([['euphonia-unread', { count: 1 }]]);     // dot, no content
  expect(JSON.stringify(pet.sent)).not.toMatch(/r1|delta/);
  active = true; ipc.onChatActiveChange();
  expect(pet.sent.at(-1)).toEqual(['euphonia-unread', { count: 0 }]);
});
