'use strict';
// Action protocol. Euphonia asks the APP to do things by ending a reply with fenced blocks:
//
//   ```euphonia-action
//   {"tool":"firm_get_status","args":{}}
//   ```
//
// Only the assistant's OWN reply text for the current turn is ever parsed, and only TRAILING blocks (a block quoted in the middle
// of prose is just prose). Tool results come back as a user-role message with origin "tool" and are never parsed.
//   READ  tools run automatically when an unexpired read-or-write grant for `euphonia-bridge` exists.
//   WRITE tools never run on the model's say-so: they become an approval card the user clicks in the chat window (hash-bound,
//         10 minute expiry, persisted), and still need an unexpired WRITE grant, checked again by the handler when it runs.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SERVER, ASSISTANT_PREFIX } = require('./bridge/tools');

const FENCE = '```euphonia-action';
const MGMT_FENCE = '```management';   // legacy alias: the block's text becomes firm_send_to_management {text}; same card, one code path
const MAX_ACTIONS = 3;
const MAX_BLOCK_CHARS = 8000;
const MAX_HOPS = 6;
const CARD_TTL_MS = 10 * 60 * 1000;
const RESULT_CHARS = 6000;
const RECEIPT_WINDOW_MS = 24 * 3600e3;
const RECEIPT_LINES = 10;

const canonical = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const hashOf = (tool, args) => crypto.createHash('sha256').update(canonical({ tool, args })).digest('hex');

// → { display, actions: [{tool,args}], errors: [string], blocks: number }
function parseActions(text, knownTools) {
  let rest = String(text == null ? '' : text);
  const raw = [];
  for (;;) {
    const trimmed = rest.replace(/\s+$/, '');
    if (!trimmed.endsWith('```')) break;
    const starts = [FENCE, MGMT_FENCE].map((f) => [f, trimmed.lastIndexOf(f)]).filter(([, i]) => i >= 0).sort((a, b) => b[1] - a[1]);
    if (!starts.length) break;
    const [fence, start] = starts[0];
    const bodyStart = start + fence.length;
    const nl = trimmed.slice(bodyStart).search(/\r?\n/);
    if (nl < 0 || trimmed.slice(bodyStart, bodyStart + nl).trim() !== '') break;   // the fence line must be exactly the header
    const body = trimmed.slice(bodyStart + nl, trimmed.length - 3);
    if (body.includes('```')) break;
    raw.unshift(fence === MGMT_FENCE ? { alias: 'firm_send_to_management', text: body.trim() } : body.trim());
    rest = trimmed.slice(0, start);
  }
  const display = raw.length ? rest.replace(/\s+$/, '') : String(text == null ? '' : text);
  const out = { display, actions: [], errors: [], blocks: raw.length };
  if (!raw.length) return out;
  if (raw.length > MAX_ACTIONS) { out.errors.push(`Too many actions in one reply (${raw.length}; the limit is ${MAX_ACTIONS}). None were run.`); return out; }
  for (const body of raw) {
    if (body && body.alias) {   // the management alias carries plain text, not JSON
      if (!body.text) { out.errors.push('A management block was empty and was ignored.'); continue; }
      if (body.text.length > MAX_BLOCK_CHARS) { out.errors.push(`A management block is larger than ${MAX_BLOCK_CHARS} characters and was rejected.`); continue; }
      if (!knownTools.includes(body.alias)) { out.errors.push(`Unknown tool: ${body.alias}.`); continue; }
      out.actions.push({ tool: body.alias, args: { text: body.text } });
      continue;
    }
    if (body.length > MAX_BLOCK_CHARS) { out.errors.push(`An action block is larger than ${MAX_BLOCK_CHARS} characters and was rejected.`); continue; }
    let o;
    try { o = JSON.parse(body); } catch { out.errors.push('An action block is not valid JSON and was rejected.'); continue; }
    if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).some((k) => k !== 'tool' && k !== 'args')) { out.errors.push('An action block must be {"tool": "...", "args": {...}} and nothing else.'); continue; }
    if (typeof o.tool !== 'string' || !knownTools.includes(o.tool)) { out.errors.push(`Unknown tool: ${String(o.tool).slice(0, 60)}. Known tools: ${knownTools.join(', ')}.`); continue; }
    const args = o.args === undefined ? {} : o.args;
    if (!args || typeof args !== 'object' || Array.isArray(args)) { out.errors.push(`args for ${o.tool} must be an object.`); continue; }
    out.actions.push({ tool: o.tool, args });
  }
  return out;
}

// What the card shows: the exact text and the destination, so the user approves what will really be sent.
function previewOf(tool, args) {
  switch (tool) {
    case 'firm_send_to_management': return { destination: "The Firm: message to Management, sent as you", text: `${ASSISTANT_PREFIX}${args.text}` };
    case 'firm_respond_inbox': return { destination: `The Firm inbox card ${args.id}: button "${args.action}"`, text: `${ASSISTANT_PREFIX}${args.text || 'relayed by the assistant'}` };
    case 'firm_file_task': return { destination: 'GitHub issue in Affirm/affirm-builders, label the-firm', title: args.title, text: args.body };
    case 'pet_set_cosmetics': return { destination: "Euphonia's own settings (cosmetic only)", text: Object.entries(args).map(([k, v]) => `${k}: ${v}`).join('\n') };
    default: return { destination: tool, text: canonical(args) };
  }
}

// The receipt log: one line per approved write, appended after it ran. Read back into the turn header so a later turn can
// answer "did that get sent?" from the record instead of memory.
function appendReceipt(file, rec) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(file, JSON.stringify(rec) + '\n', { mode: 0o600 });
    return true;
  } catch { return false; }
}
function readReceipts(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const l of text.split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch { /* torn line */ } }
  return out;
}
const hhmm = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
// The last 24 h of receipts, newest last, at most RECEIPT_LINES lines. '' when there are none.
function renderReceipts(file, { now = Date.now(), windowMs = RECEIPT_WINDOW_MS, max = RECEIPT_LINES } = {}) {
  const recent = readReceipts(file).filter((r) => r && r.ts && now - Date.parse(r.ts) <= windowMs).slice(-max);
  return recent.map((r) => {
    const rc = r.receipt ? ` (Firm event ${r.receipt.event_id}${r.receipt.acked_at ? ', acked' : r.receipt.delivered_at ? ', delivered to Management' : ', recorded'})` : '';
    const reply = r.reply && r.reply !== 'pending' ? ` reply: "${String(r.reply).slice(0, 160)}"` : r.reply === 'pending' ? ' reply: pending at the time' : '';
    return `- ${hhmm(r.ts)} ${r.action} -> ${r.destination}: ${r.status}${rc}${r.status === 'failed' ? ` (${String(r.result || '').slice(0, 160)})` : ''}${reply}`;
  }).join('\n');
}
// What a failed result says, in one short line.
const reasonOf = (text) => String(text || '').split('\n')[0].replace(/^(Failed|Refused):\s*/, '').slice(0, 160) || 'unknown error';

function createActionEngine({ defs, run, grants, cardsFile, sentFile = null, now = () => Date.now(), sendFollowUp, emit = () => {}, audit }) {
  const byName = new Map(defs.map((d) => [d.name, d]));
  const names = defs.map((d) => d.name);
  const readCards = () => { try { const d = JSON.parse(fs.readFileSync(cardsFile, 'utf8')); return Array.isArray(d.cards) ? d.cards : []; } catch { return []; } };
  const writeCards = (cards) => {
    fs.mkdirSync(path.dirname(cardsFile), { recursive: true, mode: 0o700 });
    const tmp = `${cardsFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, cards }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, cardsFile);
  };
  const expire = (cards) => {
    let changed = false;
    for (const c of cards) if (c.status === 'pending' && Date.parse(c.expires_at) <= now()) { c.status = 'expired'; changed = true; }
    const keep = cards.filter((c) => now() - Date.parse(c.created_at) < 24 * 3600e3);
    if (changed || keep.length !== cards.length) writeCards(keep);
    return keep;
  };
  const list = () => expire(readCards());
  const level = (tool) => byName.get(tool).class;
  const clip = (t) => (t.length > RESULT_CHARS ? `${t.slice(0, RESULT_CHARS)}\n[truncated]` : t);
  const live = () => grants.list().find((g) => g.server === SERVER);   // grants.list() drops expired entries
  const label = (tool, text) => `[tool result: ${tool}]\n${clip(text)}`;
  const fail = (reason) => { audit.log('action', {}, 'rejected', reason); return reason; };

  // Process one assistant reply (already parsed). Reads run now; writes become cards. Feeds results back as ONE follow-up message.
  async function process({ turnId, parsed, hops = 0 }) {
    const feed = [];          // text that goes back to her
    let needsReply = false;   // true when something in the feed is an answer she must act on (not just "waiting for a card")
    for (const e of parsed.errors) { feed.push(`[tool result: invalid action]\n${fail(e)}`); needsReply = true; }
    if (!parsed.actions.length && !feed.length) return;
    if (hops >= MAX_HOPS) { emit({ type: 'notice', turnId, text: `Stopped after ${MAX_HOPS} automatic tool rounds. Ask again to continue.` }); audit.log('action', {}, 'refused', 'hop limit'); return; }
    for (const a of parsed.actions) {
      const need = level(a.tool);
      if (need === 'read') { const r = await run(a.tool, a.args); feed.push(label(a.tool, r.text)); needsReply = true; continue; }
      const g = live();
      if (!g || g.level !== 'write') {
        audit.log(a.tool, a.args, 'refused', 'no write grant');
        feed.push(label(a.tool, `Refused: ${a.tool} is a write and needs write access to ${SERVER}${g ? ' (only read is granted)' : ''}. The owner grants it in the dashboard under Euphonia > Tool access. Nothing was sent or changed.`));
        needsReply = true;
        continue;
      }
      const cards = list();
      const hash = hashOf(a.tool, a.args);
      const dup = cards.find((c) => c.status === 'pending' && c.hash === hash);
      if (dup) { feed.push(label(a.tool, 'An identical approval card is already waiting. Nothing was done yet.')); needsReply = true; continue; }
      const card = { id: crypto.randomBytes(5).toString('hex'), kind: 'action', tool: a.tool, args: a.args, hash, preview: previewOf(a.tool, a.args), status: 'pending', turnId, hops, created_at: new Date(now()).toISOString(), expires_at: new Date(now() + CARD_TTL_MS).toISOString() };
      writeCards([...cards, card]);
      audit.log(a.tool, a.args, 'card', card.id);
      emit({ type: 'card', card });
      feed.push(label(a.tool, `Waiting for the user to approve a card in the chat window (expires in 10 minutes). Nothing has been done. Do not say it was done.`));
    }
    if (needsReply) sendFollowUp(feed.join('\n\n'), { hops: hops + 1 });
  }

  // The user's click. Accepted from the chat window only (enforced by the IPC layer); here the card is the authority, not the caller.
  async function decide({ id, hash, decision }) {
    const cards = list();
    const card = cards.find((c) => c.id === id);
    if (!card) return { ok: false, error: 'That card no longer exists.' };
    if (card.status !== 'pending') return { ok: false, error: `That card is already ${card.status}.` };
    if (typeof hash !== 'string' || hash !== card.hash || hashOf(card.tool, card.args) !== card.hash) { audit.log(card.tool, card.args, 'refused', 'hash mismatch'); return { ok: false, error: 'The card does not match what was approved. Nothing was done.' }; }
    const set = (patch) => { const all = readCards(); const c = all.find((x) => x.id === id); Object.assign(c, patch); writeCards(all); emit({ type: 'card', card: c }); return c; };
    if (decision !== 'approve') {
      set({ status: 'denied', decided_at: new Date(now()).toISOString() });
      audit.log(card.tool, card.args, 'denied', card.id);
      sendFollowUp(label(card.tool, 'The user denied this action. It was not done.'), { hops: (card.hops || 0) + 1 });   // the click continues the same round budget
      return { ok: true, status: 'denied' };
    }
    set({ status: 'running', decided_at: new Date(now()).toISOString() });   // single flight: a second click finds it no longer pending
    const r = await run(card.tool, card.args);   // the handler re-checks the write grant itself
    const ts = new Date(now()).toISOString();
    let parsed = null;
    if (!r.isError) { try { parsed = JSON.parse(r.text); } catch { /* not JSON */ } }
    const receipt = parsed && parsed.receipt ? parsed.receipt : null;
    const reply = parsed && parsed.reply !== undefined ? parsed.reply : null;
    const rec = { id: card.id, ts, action: card.tool, destination: card.preview.destination, status: r.isError ? 'failed' : 'delivered', result: r.isError ? reasonOf(r.text) : String(r.text || '').slice(0, 300), receipt, reply };
    const logged = sentFile ? appendReceipt(sentFile, rec) : false;
    const done = set({ status: r.isError ? 'failed' : 'executed', outcome: clip(r.text), sent_at: r.isError ? null : ts, failed_reason: r.isError ? reasonOf(r.text) : null, receipt, reply, receipt_logged: logged });
    emit({ type: 'receipt', card: done, receipt: rec });
    // Back into her session as a labelled tool result, so she confirms in her own words from the record, never from intent.
    const confirm = r.isError ? r.text : `${r.text}\n\n[receipt] ${rec.status} at ${ts}${receipt ? `; Firm event ${receipt.event_id}${receipt.acked_at ? ' acked' : receipt.delivered_at ? ' delivered to Management' : ' recorded'}` : ''}${reply ? `; Management's reply: ${reply}` : ''}${logged ? '' : ' (receipt log could not be written)'}`;
    sendFollowUp(label(card.tool, confirm), { hops: (card.hops || 0) + 1 });
    return { ok: true, status: done.status };
  }

  // End of a conversation: every pending card is cancelled (approving one later would run a write into a new conversation).
  function cancelPending(why = 'cancelled') {
    const all = readCards();
    let n = 0;
    for (const c of all) if (c.status === 'pending') { c.status = 'cancelled'; c.decided_at = new Date(now()).toISOString(); c.by = why; n++; emit({ type: 'card', card: c }); audit.log(c.tool, c.args, 'cancelled', c.id); }
    if (n) writeCards(all);
    return n;
  }
  return { parse: (text) => parseActions(text, names), process, decide, list, names, cancelPending, MAX_ACTIONS, receipts: () => readReceipts(sentFile) };
}

module.exports = { parseActions, createActionEngine, previewOf, hashOf, renderReceipts, readReceipts, MAX_ACTIONS, MAX_HOPS, CARD_TTL_MS, RECEIPT_WINDOW_MS, RECEIPT_LINES };
