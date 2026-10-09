// The Euphonia chat bubble: a thin DOM view over the pure model in chat-model.js.
// It talks only to the main process (window.peonBridge.euphonia*); it never sees the CLI or the files.
const EuphoniaChat = window.EuphoniaChat;
const { initial, reduce, keyAction, describeCard } = EuphoniaChat;

export function initChat({ onShow } = {}) {
  const $ = (id) => document.getElementById(id);
  const list = $('chat-list'), input = $('chat-input'), sendBtn = $('chat-send'), status = $('chat-status'), errBox = $('chat-error');
  let state = initial();
  let loaded = false;

  // "new conversation" until a turn has completed, then the turn count and when it was last active.
  function sessionLine(session) {
    $('chat-sub').textContent = EuphoniaChat.describeSession(session);
  }

  const cardsBox = $('chat-cards');
  const cardEls = new Map();      // id -> { el, sig }
  const expanded = new Set();     // finished cards the user opened to read the full text
  // Cards: a pending card shows its whole text and the buttons. A finished card collapses to one line (tool and outcome);
  // click it to read the text again. A card is rebuilt only when what it shows changed, so streaming never flickers them.
  function renderCards() {
    const now = Date.now();
    const shown = state.cards.filter((c) => describeCard(c, now).actionable).concat(state.cards.filter((c) => !describeCard(c, now).actionable).slice(-3));
    const seen = new Set();
    const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; n.textContent = text; return n; };   // textContent only: card text is model-written
    for (const c of shown) {
      seen.add(c.id);
      const d = describeCard(c, now);
      const open = d.actionable || expanded.has(c.id);
      const sig = `${d.status}|${d.label}|${open ? 1 : 0}|${c.hash}`;
      let rec = cardEls.get(c.id);
      if (rec && rec.sig === sig) continue;
      if (!rec) { rec = { el: document.createElement('div'), sig: '' }; cardEls.set(c.id, rec); cardsBox.append(rec.el); }
      rec.sig = sig;
      const el = rec.el;
      el.className = `card ${d.status}${c.kind === 'policy' ? ' policy' : ''}${open ? '' : ' collapsed'}`;
      el.replaceChildren();
      const head = document.createElement('div'); head.className = 'row head';
      head.append(mk('span', 'tool', c.tool), mk('span', 'state', d.label));
      el.append(head);
      if (open) {
        el.append(mk('div', 'dest', c.preview.destination));
        if (c.preview.title) el.append(mk('div', '', `Title: ${c.preview.title}`));
        el.append(mk('pre', '', c.preview.text || ''));
        if (d.actionable) {
          const row = document.createElement('div'); row.className = 'row';
          for (const [decision, text] of [['approve', 'Approve'], ['deny', 'Deny']]) {
            const b = mk('button', decision, text);
            b.addEventListener('click', async () => {
              for (const x of row.querySelectorAll('button')) x.disabled = true;
              const r = await window.peonBridge.decideCard({ id: c.id, hash: c.hash, decision });
              if (!r || !r.ok) { for (const x of row.querySelectorAll('button')) x.disabled = false; dispatch({ type: 'send-failed', message: (r && r.error) || 'Could not decide that card' }); }
            });
            row.append(b);
          }
          el.append(row);
        }
      }
      if (!d.actionable) head.addEventListener('click', () => { if (expanded.has(c.id)) expanded.delete(c.id); else expanded.add(c.id); rec.sig = ''; renderCards(); });
    }
    for (const [id, rec] of cardEls) if (!seen.has(id)) { rec.el.remove(); cardEls.delete(id); expanded.delete(id); }
  }
  setInterval(() => { if (state.cards.some((c) => c.status === 'pending')) renderCards(); }, 15000);   // expiry shows without an event

  function markdownNode(text) {
    const body = document.createElement('div'); body.className = 'markdown-body';
    body.innerHTML = window.EuphoniaMarkdown.render(text);
    return body;
  }

  function render() {
    renderCards();
    // Rebuild only what changed: messages are few (capped), so a keyed rebuild is fine.
    const stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 24;
    const existing = new Map([...list.children].map((n) => [n.dataset.id, n]));
    state.messages.forEach((m, i) => {
      let n = existing.get(m.id);
      if (!n) { n = document.createElement('div'); n.dataset.id = m.id; }
      existing.delete(m.id);
      n.className = `msg ${m.role}${m.pending ? ' pending' : ''}`;
      // Assistant replies render as Markdown (markdown-it, html off, images off, http(s) links only); everything else is
      // textContent. The source is cached so an unchanged message is not re-rendered while another streams.
      if (n.dataset.raw !== m.text || n.dataset.format !== m.role) {
        n.dataset.raw = m.text; n.dataset.format = m.role;
        if (m.role === 'assistant' && m.text && window.EuphoniaMarkdown) n.replaceChildren(markdownNode(m.text)); else n.textContent = m.text;
      }
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

  let sending = false;   // Enter key-repeat during the IPC round trip must not send twice
  async function send() {
    const text = input.value;
    if (sending || state.busy || !text.trim()) return;
    sending = true;
    let res;
    try { res = await window.peonBridge.euphoniaSend(text); } catch (e) { res = { ok: false, error: e.message }; } finally { sending = false; }
    if (!res || !res.ok) return dispatch({ type: 'send-failed', message: (res && res.error) || 'Could not send' });
    if (input.value === text) input.value = '';   // clear only what was sent; keep anything typed meanwhile
    dispatch({ type: 'sent', turnId: res.turnId, text: text.trim() });
  }

  $('chat-form').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  input.addEventListener('keydown', (e) => {
    const act = keyAction(e, { busy: state.busy || sending, text: input.value });
    if (act === 'send' || act === 'block') e.preventDefault();
    if (act === 'send') send();
  });
  errBox.addEventListener('click', () => dispatch({ type: 'dismiss-error' }));
  $('chat-new').addEventListener('click', async () => {
    if (state.busy) return;
    await window.peonBridge.euphoniaReset();
    dispatch({ type: 'history', records: [] });
    sessionLine(null);
  });
  const refreshAccess = () => window.peonBridge.accessSummary && window.peonBridge.accessSummary().then((r) => { $('chat-access').textContent = `tool access: ${r.text}`; }).catch(() => {});
  $('chat-access').addEventListener('click', (e) => { e.preventDefault(); window.peonBridge.openAccessSettings(); });
  const setName = (n) => { if (!n) return; $('chat-name').textContent = n; document.title = n; $('chat-input').placeholder = `Ask ${n}… (Enter sends, Shift+Enter newline)`; };
  if (window.peonBridge.onEuphoniaConfig) window.peonBridge.onEuphoniaConfig((c) => setName(c.name));
  refreshAccess();
  window.peonBridge.onEuphoniaEvent((event) => {
    dispatch({ type: 'event', event });
    if (event.type === 'done' || event.type === 'error') refreshAccess();
    if (event.type === 'done') window.peonBridge.euphoniaHistory().then((h) => sessionLine(h.session)).catch(() => {});
  });

  // Called each time the chat view is shown.
  async function show() {
    if (!loaded) {
      loaded = true;
      try {
        const h = await window.peonBridge.euphoniaHistory();
        const cfg = h.config || {};
        setName(cfg.name);
        $('chat-avatar').src = `peon-asset://dock-icon.png?char=${encodeURIComponent(cfg.species || 'weeping-willow')}`;
        sessionLine(h.session);
        dispatch({ type: 'history', records: h.records || [], active: h.active, cards: h.cards || [] });   // pending cards survive a closed window
      } catch (e) { dispatch({ type: 'send-failed', message: `Could not load history: ${e.message}` }); }
    }
    focusInput();
    if (onShow) onShow();
  }
  function focusInput() {
    refreshAccess(); setTimeout(() => input.focus(), 50); }
  render();
  return { show, focusInput };
}
