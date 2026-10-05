// Pure state for the Euphonia chat bubble: no DOM, no Electron, so it is unit-tested in Node and loaded
// as a classic script in the pet window (window.EuphoniaChat).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EuphoniaChat = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_MESSAGES = 200;

  const initial = () => ({ messages: [], busy: false, activeTurn: null, tool: null, error: null });
  const trim = (messages) => (messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages);

  // Actions:
  //   {type:'history', records}                 transcript.jsonl rows (role user|assistant)
  //   {type:'sent', turnId, text}               the user's message was accepted by the main process
  //   {type:'send-failed', message}             the main process refused it (e.g. empty)
  //   {type:'event', event}                     a service event: start | delta | tool | done | error
  //   {type:'dismiss-error'}
  function reduce(state, action) {
    switch (action.type) {
      case 'history': {
        const messages = (action.records || [])
          .filter((r) => r && (r.role === 'user' || r.role === 'assistant') && typeof r.text === 'string')
          .map((r) => ({ id: r.turnId ? `${r.turnId}:${r.role}` : `h${r.ts}`, role: r.role, text: r.text }));
        return { ...state, messages: trim(messages) };
      }
      case 'sent':
        return {
          ...state, busy: true, activeTurn: action.turnId, tool: null, error: null,
          messages: trim([...state.messages, { id: `${action.turnId}:user`, role: 'user', text: action.text }]),
        };
      case 'send-failed':
        return { ...state, error: action.message || 'Could not send' };
      case 'dismiss-error':
        return { ...state, error: null };
      case 'event': {
        const ev = action.event || {};
        const id = `${ev.turnId}:assistant`;
        const has = state.messages.some((m) => m.id === id);
        if (ev.type === 'start') {
          if (has) return state;
          return { ...state, busy: true, activeTurn: ev.turnId, messages: trim([...state.messages, { id, role: 'assistant', text: '', pending: true }]) };
        }
        if (ev.type === 'delta') {
          const messages = has
            ? state.messages.map((m) => (m.id === id ? { ...m, text: m.text + ev.text } : m))
            : trim([...state.messages, { id, role: 'assistant', text: ev.text, pending: true }]);
          return { ...state, busy: true, tool: null, messages };
        }
        if (ev.type === 'tool') return { ...state, tool: ev.name || null };
        if (ev.type === 'done') {
          const final = typeof ev.text === 'string' ? ev.text : null;
          const messages = has
            ? state.messages.map((m) => (m.id === id ? { id, role: 'assistant', text: final != null && final ? final : m.text } : m))
            : trim([...state.messages, { id, role: 'assistant', text: final || '' }]);
          return { ...state, busy: false, activeTurn: null, tool: null, messages };
        }
        if (ev.type === 'error') {
          // keep whatever streamed so far, but drop an empty placeholder
          const messages = state.messages.filter((m) => !(m.id === id && !m.text)).map((m) => (m.id === id ? { id, role: 'assistant', text: m.text } : m));
          return { ...state, busy: false, activeTurn: null, tool: null, error: ev.message || 'Something went wrong', messages };
        }
        return state;
      }
      default:
        return state;
    }
  }

  // Enter sends, Shift+Enter newline; ignore Enter while composing (IME) or when empty/busy.
  function keyAction(e, { busy, text }) {
    if (e.key !== 'Enter' || e.isComposing) return 'none';
    if (e.shiftKey) return 'newline';
    if (busy || !String(text).trim()) return 'block';
    return 'send';
  }

  return { initial, reduce, keyAction, MAX_MESSAGES };
});
