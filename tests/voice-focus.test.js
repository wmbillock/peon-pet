const { resolveVoiceFocus, shouldPlay, pickVisibleAgent, cleanMode } = require('../lib/voice-focus');
const { registerEuphoniaIpc } = require('../lib/euphonia/ipc');

const facts = (o = {}) => ({ pixooConnected: false, pixooShowing: null, cornerView: 'pet', visibleAgentId: null, leadId: 'euphonia', chatWindowFocused: false, ...o });
const focus = (o) => resolveVoiceFocus(facts(o)).agentId;

test('a connected Pixoo beats the main view and the chat', () => {
  expect(focus({ pixooConnected: true, pixooShowing: 'a1', cornerView: 'speaker', visibleAgentId: 'a2' })).toBe('a1');
  expect(focus({ pixooConnected: true, pixooShowing: 'a1', chatWindowFocused: true })).toBe('a1');
  expect(resolveVoiceFocus(facts({ pixooConnected: true, pixooShowing: 'a1' })).reason).toBe('pixoo');
});

test('a disconnected Pixoo (or one showing nothing) defers to the selected view', () => {
  expect(focus({ pixooConnected: false, pixooShowing: 'a1', cornerView: 'speaker', visibleAgentId: 'a2' })).toBe('a2');
  expect(focus({ pixooConnected: true, pixooShowing: null, cornerView: 'presenter', visibleAgentId: 'm1' })).toBe('m1');
  expect(focus({ cornerView: 'pet', visibleAgentId: 'a2' })).toBe('euphonia');   // pet view = the lead
});

test('rotation changes the focus mid-run, and the gate follows it', () => {
  const play = (agentId, f) => shouldPlay({ agentId, focus: resolveVoiceFocus(facts(f)).agentId });
  expect(play('a1', { cornerView: 'speaker', visibleAgentId: 'a1' })).toBe(true);
  expect(play('a2', { cornerView: 'speaker', visibleAgentId: 'a1' })).toBe(false);
  expect(play('a2', { cornerView: 'speaker', visibleAgentId: 'a2' })).toBe(true);   // the view rotated
  expect(play('a1', { cornerView: 'speaker', visibleAgentId: 'a2' })).toBe(false);
  expect(play('a1', { pixooConnected: true, pixooShowing: 'a1', cornerView: 'speaker', visibleAgentId: 'a2' })).toBe(true);   // the Pixoo rotated onto a1
});

test('events of non-focused agents are silent, and an unknown speaker is never "everyone"', () => {
  expect(shouldPlay({ agentId: 'a3', focus: 'a1' })).toBe(false);
  expect(shouldPlay({ agentId: null, focus: 'a1' })).toBe(false);
  expect(shouldPlay({ agentId: 'a1', focus: null })).toBe(false);
});

test('Euphonia: plays when focused, or when her chat window is focused even if another agent holds the focus', () => {
  expect(shouldPlay({ agentId: 'euphonia', focus: 'euphonia' })).toBe(true);
  expect(shouldPlay({ agentId: 'euphonia', focus: 'a1' })).toBe(false);
  expect(shouldPlay({ agentId: 'euphonia', focus: 'a1', chatWindowFocused: true })).toBe(true);
  expect(shouldPlay({ agentId: 'a2', focus: 'a1', chatWindowFocused: true })).toBe(false);      // chat focus gives Euphonia nobody else's voice
  expect(focus({ chatWindowFocused: true, cornerView: 'speaker', visibleAgentId: 'a2' })).toBe('euphonia');
});

test('unresolved view falls back to the lead, never to all voices', () => {
  expect(resolveVoiceFocus(facts({ cornerView: 'grid', visibleAgentId: null }))).toEqual({ agentId: 'euphonia', reason: 'fallback-lead' });
  expect(resolveVoiceFocus(facts({ cornerView: 'speaker', visibleAgentId: null, leadId: 'pet_9' })).agentId).toBe('pet_9');
  const none = resolveVoiceFocus({});
  expect(none.agentId).toBeNull();
  expect(shouldPlay({ agentId: 'a1', focus: none.agentId })).toBe(false);
});

test("'all' mode leaves behaviour unchanged; an unknown mode means the default", () => {
  expect(shouldPlay({ mode: 'all', agentId: 'a3', focus: 'a1' })).toBe(true);
  expect(shouldPlay({ mode: 'all', agentId: null, focus: null })).toBe(true);
  expect(cleanMode('all')).toBe('all');
  expect(cleanMode(undefined)).toBe('active-display');
  expect(cleanMode('bogus')).toBe('active-display');
});

test('pickVisibleAgent: speaker = most recent working root, presenter = a master, grid has no single agent', () => {
  const s = [{ id: 'a', hot: true, lastActive: 1 }, { id: 'b', hot: true, lastActive: 5 }, { id: 'c', hot: false, lastActive: 9, rank: 0, role: 'master' }, { id: 'k', hot: true, lastActive: 99, isRoot: false }];
  expect(pickVisibleAgent('speaker', s)).toBe('b');
  expect(pickVisibleAgent('presenter', s)).toBe('c');
  expect(pickVisibleAgent('grid', s)).toBeNull();
  expect(pickVisibleAgent('speaker', [])).toBeNull();
});

test("Euphonia's reply cue goes through the gate and keeps her own pack", async () => {
  const handlers = {};
  const run = async (allow) => {
    const plays = [];
    let listener;
    const dash = {};
    const svc = { subscribe: (fn) => { listener = fn; }, send: () => ({ turnId: 't' }), history: () => [], getReadMarker: () => null, setReadMarker: () => {}, getConfig: () => ({ soundPack: 'mine' }), getSession: () => null };
    registerEuphoniaIpc({
      ipcMain: { handle: (c, f) => { handlers[c] = f; }, on: () => {} }, getPetWebContents: () => null, getChat: { webContents: () => ({ isDestroyed: () => false, send() {} }), isActive: () => false, open: () => {} },
      getSenders: () => [dash], getService: () => svc, peonDir: () => '/p', listPacks: () => [], isMuted: () => false, getVolume: () => 0.5, shouldPlay: () => allow, play: (f) => plays.push(f),
    });
    await handlers['euphonia-history']({ sender: dash });
    listener({ type: 'done' });
    return plays.length;
  };
  // pickCue finds no pack under /p, so a permitted cue resolves to null; what matters is that a denied gate never reaches play at all
  expect(await run(false)).toBe(0);
  expect(await run(true)).toBe(1);   // the gate is the only difference
});
