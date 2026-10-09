// The Euphonia chat bubble: a thin DOM view over the pure model in chat-model.js.
// It talks only to the main process (window.peonBridge.euphonia*); it never sees the CLI or the files.
const EuphoniaChat = window.EuphoniaChat;
const { initial, reduce, keyAction } = EuphoniaChat;

export function initChat({ onShow } = {}) {
  const $ = (id) => document.getElementById(id);
  const list = $('chat-list'), input = $('chat-input'), sendBtn = $('chat-send'), status = $('chat-status'), errBox = $('chat-error');
  let state = initial();
  let loaded = false;

  // "new conversation" until a turn has completed, then the turn count and when it was last active.
  function sessionLine(session) {
    $('chat-sub').textContent = EuphoniaChat.describeSession(session);
  }

  // One draft: the exact text, and a button. Only a person pressing it sends it (main accepts this only from this window).
  function draftNode(text) {
    const box = document.createElement('div'); box.className = 'draft';
    const label = document.createElement('div'); label.className = 'draft-label'; label.textContent = 'Message for Management (not sent yet)';
    const body = document.createElement('pre'); body.className = 'draft-body'; body.textContent = text;
    const row = document.createElement('div'); row.className = 'draft-row';
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = 'Send to Management';
    const result = document.createElement('span'); result.className = 'draft-result'; result.setAttribute('role', 'status');
    btn.addEventListener('click', async () => {
      btn.disabled = true; result.textContent = 'Sending…'; result.className = 'draft-result';
      let r;
      try { r = await window.peonBridge.euphoniaSendDraft(text); } catch (e) { r = { ok: false, error: e.message }; }
      if (r && r.ok) { label.textContent = 'Message for Management (sent)'; result.textContent = 'Sent.'; result.className = 'draft-result ok'; }
      else { btn.disabled = false; result.textContent = (r && (r.error || r.text)) || 'Could not send'; result.className = 'draft-result bad'; }
    });
    row.append(btn, result);
    box.append(label, body, row);
    return box;
  }

  function markdownNode(text) {
    const body = document.createElement('div'); body.className = 'markdown-body';
    body.innerHTML = window.EuphoniaMarkdown.render(text);
    return body;
  }

  function render() {
    // Rebuild only what changed: messages are few (capped), so a keyed rebuild is fine.
    const stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 24;
    const existing = new Map([...list.children].map((n) => [n.dataset.id, n]));
    state.messages.forEach((m, i) => {
      let n = existing.get(m.id);
      if (!n) { n = document.createElement('div'); n.dataset.id = m.id; }
      existing.delete(m.id);
      n.className = `msg ${m.role}${m.pending ? ' pending' : ''}`;
      // Cache the source, not rendered text: formatting changes textContent. Unchanged messages keep
      // their draft buttons/results while other messages stream. Draft payloads remain exact plain text.
      if (n.dataset.raw !== m.text || n.dataset.format !== m.role) {
        n.dataset.raw = m.text; n.dataset.format = m.role;
        if (m.role === 'assistant' && m.text) {
          n.replaceChildren(...EuphoniaChat.parseSegments(m.text).map((seg) => (seg.type === 'text' ? markdownNode(seg.text) : draftNode(seg.text))));
        } else { n.textContent = m.text; }
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
    sessionLine(null);
  });
  const refreshAccess = () => window.peonBridge.accessSummary && window.peonBridge.accessSummary().then((r) => { $('chat-access').textContent = `tool access: ${r.text}`; }).catch(() => {});
  $('chat-access').addEventListener('click', (e) => { e.preventDefault(); window.peonBridge.openAccessSettings(); });
  const setName = (n) => { if (!n) return; $('chat-name').textContent = n; document.title = n; $('chat-input').placeholder = `Ask ${n}… (Enter sends, Shift+Enter newline)`; };
  if (window.peonBridge.onEuphoniaConfig) window.peonBridge.onEuphoniaConfig((c) => setName(c.name));
  refreshAccess();
  // Approval cards live outside the message list (which re-renders): one per open request, newest last.
  const cards = document.createElement('div'); cards.className = 'approvals';
  list.after(cards);
  const openCards = new Map();
  function approvalCard(a) {
    if (openCards.has(a.id) || !window.peonBridge.euphoniaAnswerApproval) return;
    const box = document.createElement('div'); box.className = 'approval';
    const label = document.createElement('div'); label.className = 'approval-label';
    label.textContent = `Approve ${a.level === 'write' ? 'a write' : 'a call'}: ${a.tool}`;
    const body = document.createElement('pre'); body.className = 'approval-body'; body.textContent = a.input || '{}';
    const row = document.createElement('div'); row.className = 'approval-row';
    const yes = document.createElement('button'); yes.type = 'button'; yes.textContent = 'Approve';
    const no = document.createElement('button'); no.type = 'button'; no.className = 'deny'; no.textContent = 'Deny';
    const result = document.createElement('span'); result.className = 'approval-result'; result.setAttribute('role', 'status');
    const answer = async (allow) => {
      yes.disabled = no.disabled = true;
      let r; try { r = await window.peonBridge.euphoniaAnswerApproval(a.id, allow); } catch (e) { r = { ok: false, error: e.message }; }
      if (!r || !r.ok) { result.textContent = (r && r.error) || 'Could not answer'; }
    };
    yes.addEventListener('click', () => answer(true));
    no.addEventListener('click', () => answer(false));
    row.append(yes, no, result);
    box.append(label, body, row);
    cards.append(box);
    openCards.set(a.id, { box, result });
    cards.scrollIntoView({ block: 'end' });
  }
  function closeCard(id, approved, by) {
    const c = openCards.get(id); if (!c) return;
    openCards.delete(id);
    c.box.classList.add('closed');
    c.result.textContent = approved ? 'Approved.' : by === 'owner' ? 'Denied.' : by === 'timeout' ? 'Expired, not run.' : 'Closed, not run.';
    setTimeout(() => c.box.remove(), 4000);
  }
  if (window.peonBridge.euphoniaApprovals) window.peonBridge.euphoniaApprovals().then((xs) => (xs || []).forEach(approvalCard)).catch(() => {});

  window.peonBridge.onEuphoniaEvent((event) => {
    if (event.type === 'approval') { approvalCard(event); return; }
    if (event.type === 'approval-closed') { closeCard(event.id, event.approved, event.by); return; }
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
        dispatch({ type: 'history', records: h.records || [], active: h.active });
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
