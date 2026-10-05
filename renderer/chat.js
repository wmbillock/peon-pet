// The Euphonia chat bubble: a thin DOM view over the pure model in chat-model.js.
// It talks only to the main process (window.peonBridge.euphonia*); it never sees the CLI or the files.
const { initial, reduce, keyAction } = window.EuphoniaChat;

export function initChat({ onShow } = {}) {
  const $ = (id) => document.getElementById(id);
  const list = $('chat-list'), input = $('chat-input'), sendBtn = $('chat-send'), status = $('chat-status'), errBox = $('chat-error');
  let state = initial();
  let loaded = false;

  function render() {
    // Rebuild only what changed: messages are few (capped), so a keyed rebuild is fine.
    const stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 24;
    const existing = new Map([...list.children].map((n) => [n.dataset.id, n]));
    state.messages.forEach((m, i) => {
      let n = existing.get(m.id);
      if (!n) { n = document.createElement('div'); n.dataset.id = m.id; }
      existing.delete(m.id);
      n.className = `msg ${m.role}${m.pending ? ' pending' : ''}`;
      if (n.textContent !== m.text) n.textContent = m.text;   // textContent: replies are never parsed as HTML
      if (list.children[i] !== n) list.insertBefore(n, list.children[i] || null);
    });
    for (const n of existing.values()) n.remove();
    if (stick) list.scrollTop = list.scrollHeight;
    status.className = state.busy ? 'busy' : '';
    status.textContent = state.busy ? (state.tool ? `Euphonia is using ${state.tool}…` : 'Euphonia is thinking…') : '';
    errBox.classList.toggle('on', !!state.error);
    errBox.textContent = state.error ? `${state.error} (click to dismiss)` : '';
    input.disabled = state.busy;
    sendBtn.disabled = state.busy;
  }
  const dispatch = (a) => { state = reduce(state, a); render(); };

  async function send() {
    const text = input.value;
    if (state.busy || !text.trim()) return;
    const res = await window.peonBridge.euphoniaSend(text);
    if (!res || !res.ok) return dispatch({ type: 'send-failed', message: (res && res.error) || 'Could not send' });
    input.value = '';
    dispatch({ type: 'sent', turnId: res.turnId, text: text.trim() });
  }

  $('chat-form').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  input.addEventListener('keydown', (e) => {
    const act = keyAction(e, { busy: state.busy, text: input.value });
    if (act === 'send' || act === 'block') e.preventDefault();
    if (act === 'send') send();
  });
  errBox.addEventListener('click', () => dispatch({ type: 'dismiss-error' }));
  $('chat-new').addEventListener('click', async () => {
    if (state.busy) return;
    await window.peonBridge.euphoniaReset();
    dispatch({ type: 'history', records: [] });
  });
  window.peonBridge.onEuphoniaEvent((event) => dispatch({ type: 'event', event }));

  // Called each time the chat view is shown.
  async function show() {
    if (!loaded) {
      loaded = true;
      try {
        const h = await window.peonBridge.euphoniaHistory();
        const cfg = h.config || {};
        $('chat-avatar').src = `peon-asset://dock-icon.png?char=${encodeURIComponent(cfg.species || 'trillian')}`;
        $('chat-sub').textContent = h.session ? `${h.session.turns} turns` : 'new';
        dispatch({ type: 'history', records: h.records || [] });
      } catch (e) { dispatch({ type: 'send-failed', message: `Could not load history: ${e.message}` }); }
    }
    setTimeout(() => input.focus(), 50);
    if (onShow) onShow();
  }
  render();
  return { show };
}
