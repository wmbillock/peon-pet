// Pure state for the Euphonia chat bubble: no DOM, no Electron, so it is unit-tested in Node and loaded
// as a classic script in the pet window (window.EuphoniaChat).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EuphoniaChat = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_MESSAGES = 200;

  const initial = () => ({ messages: [], busy: false, activeTurn: null, tool: null, error: null, open: [], finished: [] });
  const trim = (messages) => (messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages);
  const NO_REPLY = 'no reply (error)';

  // A denied tool, named with the server and the access level it needs, and where to grant it.
  function describeDenial(ev) {
    if (ev.server) return `Blocked: ${ev.tool} needs ${ev.level || 'write'} access to ${ev.server}. Grant it in the dashboard under Euphonia > Tool access.`;
    return `Blocked: ${ev.tool} is not available to Euphonia.`;
  }

  // Order is by turn, never by arrival: a turn's user message always precedes its assistant bubble and its
  // error marker, even when the main process's `start` event beats the send invoke's reply to the renderer.
  const turnOf = (m) => String(m.id).split(':')[0];
  function place(messages, msg) {
    const turn = turnOf(msg);
    const out = messages.slice();
    if (msg.role === 'user') {
      const i = out.findIndex((m) => turnOf(m) === turn && m.role !== 'user');
      if (i >= 0) out.splice(i, 0, msg); else out.push(msg);
    } else {
      let last = -1;
      out.forEach((m, i) => { if (turnOf(m) === turn) last = i; });
      if (last >= 0) out.splice(last + 1, 0, msg); else out.push(msg);
    }
    return trim(out);
  }
  const markOpen = (st, turn) => (st.finished.includes(turn) || st.open.includes(turn) ? st.open : [...st.open, turn]);
  function closeTurn(st, turn) {
    const open = st.open.filter((t) => t !== turn);
    return { open, finished: [...st.finished, turn].slice(-50), busy: open.length > 0, activeTurn: open[0] || null };
  }

  // A reply can carry a message for The Firm's Management in a fenced block tagged `management`. The chat shows it with a
  // Send button; only the person pressing it sends anything. -> [{ type: 'text', text } | { type: 'draft', text }]
  const DRAFT_RE = /```management[ \t]*\r?\n([\s\S]*?)```/g;
  function parseSegments(text) {
    const src = String(text || '');
    const out = [];
    let last = 0, m;
    DRAFT_RE.lastIndex = 0;
    while ((m = DRAFT_RE.exec(src))) {
      if (m.index > last) out.push({ type: 'text', text: src.slice(last, m.index) });
      const body = m[1].replace(/\s+$/, '');
      if (body.trim()) out.push({ type: 'draft', text: body });
      last = m.index + m[0].length;
    }
    if (last < src.length) out.push({ type: 'text', text: src.slice(last) });
    return out.length ? out : [{ type: 'text', text: src }];
  }

  // Actions:
  //   {type:'history', records, active?}        transcript rows; active = { running: turnId|null, queued: [turnId] }
  //   {type:'sent', turnId, text}               the user's message was accepted by the main process
  //   {type:'send-failed', message}             the main process refused it (e.g. empty)
  //   {type:'event', event}                     a service event: start | delta | tool | done | error
  //   {type:'dismiss-error'}
  function reduce(state, action) {
    switch (action.type) {
      case 'history': {
        const act = action.active || {};
        const queued = act.queued || [];
        const rows = (action.records || []).filter((r) => r && (r.role === 'user' || r.role === 'assistant') && typeof r.text === 'string');
        const answered = new Set(rows.filter((r) => r.role === 'assistant' && r.turnId).map((r) => r.turnId));
        const messages = [];
        for (const r of rows) {
          messages.push({ id: r.turnId ? `${r.turnId}:${r.role}` : `h${r.ts}`, role: r.role, text: r.text });
          if (r.role !== 'user' || !r.turnId || answered.has(r.turnId) || queued.includes(r.turnId)) continue;
          if (r.turnId === act.running) messages.push({ id: `${r.turnId}:assistant`, role: 'assistant', text: '', pending: true });
          else messages.push({ id: `${r.turnId}:error`, role: 'error', text: NO_REPLY });   // a failed turn: mark it, no silent gap
        }
        const open = [act.running, ...queued].filter(Boolean);
        return { ...state, messages: trim(messages), open, finished: [], busy: open.length > 0, activeTurn: open[0] || null, tool: null };
      }
      case 'sent': {
        const open = markOpen(state, action.turnId);
        return {
          ...state, open, busy: open.length > 0, activeTurn: open[0] || null, tool: null, error: null,
          messages: place(state.messages, { id: `${action.turnId}:user`, role: 'user', text: action.text }),
        };
      }
      case 'send-failed':
        return { ...state, error: action.message || 'Could not send' };
      case 'dismiss-error':
        return { ...state, error: null };
      case 'event': {
        const ev = action.event || {};
        if (!ev.turnId) return state;
        const id = `${ev.turnId}:assistant`;
        const has = state.messages.some((m) => m.id === id);
        if (ev.type === 'start') {
          const open = markOpen(state, ev.turnId);
          const base = { ...state, open, busy: open.length > 0, activeTurn: open[0] || null };
          if (has) return base;
          return { ...base, messages: place(state.messages, { id, role: 'assistant', text: '', pending: true }) };
        }
        if (ev.type === 'delta') {
          const open = markOpen(state, ev.turnId);
          const messages = has
            ? state.messages.map((m) => (m.id === id ? { ...m, text: m.text + ev.text } : m))
            : place(state.messages, { id, role: 'assistant', text: ev.text, pending: true });
          return { ...state, open, busy: open.length > 0, activeTurn: open[0] || null, tool: null, messages };
        }
        if (ev.type === 'denied') {
          const nid = `${ev.turnId}:denied:${ev.tool}`;
          if (state.messages.some((x) => x.id === nid)) return state;
          return { ...state, messages: place(state.messages, { id: nid, role: 'notice', text: describeDenial(ev) }) };
        }
        if (ev.type === 'tool') return { ...state, tool: ev.name || null };
        if (ev.type === 'done') {
          const final = typeof ev.text === 'string' && ev.text ? ev.text : null;
          const messages = has
            ? state.messages.map((m) => (m.id === id ? { id, role: 'assistant', text: final != null ? final : m.text } : m))
            : place(state.messages, { id, role: 'assistant', text: final || '' });
          return { ...state, ...closeTurn(state, ev.turnId), tool: null, messages };
        }
        if (ev.type === 'error') {
          // keep whatever streamed so far, drop an empty placeholder, and mark the turn so it never reads as a gap
          let messages = state.messages.filter((m) => !(m.id === id && !m.text)).map((m) => (m.id === id ? { id, role: 'assistant', text: m.text } : m));
          if (!messages.some((m) => m.id === `${ev.turnId}:error`)) messages = place(messages, { id: `${ev.turnId}:error`, role: 'error', text: NO_REPLY });
          return { ...state, ...closeTurn(state, ev.turnId), tool: null, error: ev.message || 'Something went wrong', messages };
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

  // Header line: session state at a glance.
  function describeSession(session, now = Date.now()) {
    if (!session || !session.turns) return 'new conversation';
    const t = Date.parse(session.updated_at || '');
    let when = '';
    if (Number.isFinite(t)) {
      const mins = Math.max(0, Math.floor((now - t) / 60000));
      when = mins < 1 ? ', active just now' : mins < 60 ? `, last active ${mins} min ago` : mins < 1440 ? `, last active ${Math.round(mins / 60)} h ago` : `, last active ${Math.round(mins / 1440)} d ago`;
    }
    return `${session.turns} turn${session.turns === 1 ? '' : 's'}${when}`;
  }

  return { initial, reduce, keyAction, describeSession, describeDenial, parseSegments, MAX_MESSAGES };
});
