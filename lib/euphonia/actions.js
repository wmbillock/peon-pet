'use strict';
// Action protocol. Euphonia asks the APP to do things by putting fenced blocks in a reply (the prompt asks for the end; text after is tolerated):
//
//   ```euphonia-action
//   {"tool":"firm_get_status","args":{}}
//   ```
//
// Only the assistant's OWN reply text for the current turn is ever parsed, and blocks anywhere in it, in order (a fence must start a line; "> "-quoted fences are prose). Tool results come back as a user-role message with origin "tool" and are never parsed.
//   READ  tools run automatically when an unexpired read-or-write grant for `euphonia-bridge` exists.
//   WRITE tools never run on the model's say-so: they become an approval card the user clicks in the chat window (hash-bound,
//         10 minute expiry, persisted), and still need an unexpired WRITE grant, checked again by the handler when it runs.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SERVER, ASSISTANT_PREFIX } = require('./bridge/tools');
const taintLib = require('./taint');

const FENCE = '```euphonia-action';
const MGMT_FENCE = '```management';   // legacy alias: the block's text becomes firm_send_to_management {text}; same card, one code path
const MAX_ACTIONS = 3;
const MAX_BLOCK_CHARS = 8000;
const MAX_HOPS = 6;
const CARD_TTL_MS = 10 * 60 * 1000;
const RESULT_CHARS = 6000;
const RECEIPT_WINDOW_MS = 24 * 3600e3;
const RECEIPT_LINES = 10;
// A card in "running" with no send in flight in this process means the app ended mid-send. A click normally settles in well under a
// minute (the receipt wait is ~20 s), so after this long it is settled as failed and marked unconfirmed. A live, merely slow send is
// never touched: it is held in `sending`, so only a card nobody is working on can be settled.
const RUNNING_STALE_MS = 5 * 60 * 1000;
const LATE_REPLY_MS = 90 * 1000;   // one more look for Management's reply when it had not arrived by the end of the send's own wait

const canonical = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const hashOf = (tool, args) => crypto.createHash('sha256').update(canonical({ tool, args })).digest('hex');

// True when everything after line `end` is blank or more well-formed action fences.
function blocksOnlyAfter(lines, end) {
  for (let i = end + 1; i < lines.length; i++) {
    if (/^\s*$/.test(lines[i])) continue;
    if (!/^```(euphonia-action|management)\s*$/.test(lines[i])) return false;
    let j = i + 1; while (j < lines.length && !/^```\s*$/.test(lines[j])) j++;
    if (j >= lines.length) return false;
    i = j;
  }
  return true;
}

// → { display, actions: [{tool,args}], errors: [string], blocks: number }
// Blocks are recognised anywhere in the reply, in order. A fence must start at column 0 with an exact header line and end at the next
// bare ``` line, so quoted ("> ```") or indented fences stay prose. A fence that has the header but cannot be read (header with extra
// text, never closed) is reported in `errors` and left in the display, never dropped silently.
// strict (the reply came after reading files/tools, so it may repeat injected text): a block counts only when nothing but other
// blocks follows it, the old trailing-only rule; a block with prose after it is reported and left as text.
function parseActions(text, knownTools, { strict = false } = {}) {
  const src = String(text == null ? '' : text);
  const lines = src.split('\n');
  const raw = [];
  const errors = [];
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^```(euphonia-action|management)(.*)$/.exec(lines[i].replace(/\r$/, ''));
    if (!m) { kept.push(lines[i]); continue; }
    const fence = m[1] === 'management' ? MGMT_FENCE : FENCE;
    if (m[2].trim() !== '') { errors.push(`A fenced block starting "${lines[i].slice(0, 60)}" was not run: the fence line must be exactly ${fence}.`); kept.push(lines[i]); continue; }
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) if (/^```\s*$/.test(lines[j])) { end = j; break; }
    if (end < 0) { errors.push(`A ${fence} block was never closed with a bare \`\`\` line and was not run.`); kept.push(lines[i]); continue; }
    const body = lines.slice(i + 1, end).join('\n').trim();
    if (strict && !blocksOnlyAfter(lines, end)) { errors.push(`A ${fence} block was not run: this reply came after reading files or tool results, so a block must be at the very end with no text after it.`); kept.push(...lines.slice(i, end + 1)); i = end; continue; }
    raw.push(fence === MGMT_FENCE ? { alias: 'firm_send_to_management', text: body } : body);
    i = end;
  }
  const display = raw.length ? kept.join('\n').replace(/\n{3,}/g, '\n\n').trim() : src;
  const out = { display, actions: [], errors, blocks: raw.length };
  if (!raw.length) return out;
  if (raw.length > MAX_ACTIONS) { out.errors.unshift(`Too many actions in one reply (${raw.length}; the limit is ${MAX_ACTIONS}). None were run.`); return out; }
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

function createActionEngine({ defs, run, grants, cardsFile, sentFile = null, now = () => Date.now(), sendFollowUp, emit = () => {}, audit, lateReply = null, lateReplyMs = LATE_REPLY_MS, isRunLive = null }) {
  const byName = new Map(defs.map((d) => [d.name, d]));
  const chains = new Map();     // card id -> what its chain read (memory only; sources are on the card), so the follow-up after a click stays tainted
  const sending = new Set();    // card ids whose send is in flight in THIS process: a running card with no entry here was cut off by an exit
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
    for (const c of cards) {
      if (c.status === 'pending' && Date.parse(c.expires_at) <= now()) { c.status = 'expired'; chains.delete(c.id); changed = true; }
      // A card stuck in "running" means the app ended mid-send (a click normally settles in under a minute). Settle it as failed,
      // and say the send is unconfirmed, so it never lingers and is never resent blindly.
      else if (c.status === 'running' && !sending.has(c.id) && now() - Date.parse(c.decided_at || c.created_at) > RUNNING_STALE_MS) { c.status = 'failed'; c.failed_reason = 'interrupted before a result was recorded; check the Firm feed before resending'; changed = true; }
    }
    // A launched session's card says "running" only while a process is behind it; otherwise its outcome was not recorded.
    if (isRunLive) for (const c of cards) if (c.session && c.run_state === 'running' && !isRunLive(c.session)) { c.run_state = 'ended'; c.run_note = 'the session is no longer running and its exit was not recorded (the app was restarted?)'; changed = true; }
    const keep = cards.filter((c) => now() - Date.parse(c.created_at) < 24 * 3600e3);
    if (changed || keep.length !== cards.length) writeCards(keep);
    return keep;
  };
  const list = () => expire(readCards());
  const level = (tool) => byName.get(tool).class;
  const previewFor = (tool, args) => { const d = byName.get(tool); return d && d.preview ? d.preview(args) : previewOf(tool, args); };   // a tool may describe itself with resolved values
  const clip = (t) => (t.length > RESULT_CHARS ? `${t.slice(0, RESULT_CHARS)}\n[truncated]` : t);
  const live = () => grants.list().find((g) => g.server === SERVER);   // grants.list() drops expired entries
  const label = (tool, text) => `[tool result: ${tool}]\n${clip(text)}`;
  const fail = (reason) => { audit.log('action', {}, 'rejected', reason); return reason; };

  // Process one assistant reply (already parsed). Reads run now; writes become cards. Feeds results back as ONE follow-up message.
  // taint: what this chain read (taint.js). A write that repeats it verbatim is refused; any other write in a tainted chain gets a card
  // that says what was read. Reads and untainted writes are unchanged.
  async function process({ turnId, parsed, hops = 0, taint = null }) {
    const feed = [];          // text that goes back to her
    let needsReply = false;   // true when something in the feed is an answer she must act on (not just "waiting for a card")
    for (const e of parsed.errors) { emit({ type: 'notice', turnId, text: e }); feed.push(`[tool result: invalid action]\n${fail(e)}`); needsReply = true; }
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
      const tainted = taintLib.isTainted(taint);
      const refuse = (why, note) => {   // no card: the call is not made and nothing is sent
        audit.log(a.tool, a.args, 'refused', note || why);
        emit({ type: 'notice', turnId, text: `Not sent: ${why}` });
        feed.push(label(a.tool, `Refused: ${why} No approval card was created and nothing was sent. Tell the user in one line. Do not retry unless the user asks.`));
        needsReply = true;
      };
      const echo = tainted ? taintLib.findEcho(taint, a, hashOf) : null;
      // The same action block inside content she read is the injection signature: refused, no card. Text copied word for word is allowed
      // (relaying a doc is her job) but the card is flagged and needs a second, explicit click.
      if (echo && echo.how === 'block') { refuse(`this action is the same block that appears in content read earlier in this conversation (${echo.source}). An action copied from a file or tool result is never sent; ask the user what they want instead.`, `echoes content read this turn: ${echo.source}`); continue; }
      const def = byName.get(a.tool);
      let bad = null;
      if (def.check) { try { await def.check(a.args); } catch (e) { bad = String((e && e.message) || e); } }
      if (!bad && tainted) for (const k of def.taintArgs || []) { const src = typeof a.args[k] === 'string' ? taintLib.mentions(taint, a.args[k]) : null; if (src) { bad = `${k} "${a.args[k]}" appears in content read this turn (${src}), so it is not trusted as the user's request.`; break; } }
      if (bad) { refuse(bad); continue; }
      const cards = list();
      const hash = hashOf(a.tool, a.args);
      const dup = cards.find((c) => c.status === 'pending' && c.hash === hash);
      if (dup) { feed.push(label(a.tool, 'An identical approval card is already waiting. Nothing was done yet.')); needsReply = true; continue; }
      const card = { id: crypto.randomBytes(5).toString('hex'), kind: 'action', tool: a.tool, args: a.args, hash, preview: previewFor(a.tool, a.args), status: 'pending', turnId, hops, created_at: new Date(now()).toISOString(), expires_at: new Date(now() + CARD_TTL_MS).toISOString() };
      if (tainted) { card.taint = { sources: taint.sources.slice(0, 12), uninspected: taint.uninspected.slice(0, 12), note: `this turn read external content (${taintLib.sourcesLabel(taint)})${taint.uninspected.length ? '; some of it could not be compared' : ''}` }; chains.set(card.id, taint); }
      if (echo) { card.echo = { source: echo.source }; audit.log(a.tool, a.args, 'flagged', `echoes content read this turn: ${echo.source}`); }
      if (def.snapshot) { try { card.guard = await def.snapshot(a.args); } catch (e) { refuse(String((e && e.message) || e)); continue; } }
      writeCards([...cards, card]);
      audit.log(a.tool, a.args, 'card', card.id);
      emit({ type: 'card', card });
      feed.push(label(a.tool, `Waiting for the user to approve a card in the chat window (expires in 10 minutes). Nothing has been done. Do not say it was done.`));
    }
    if (needsReply) sendFollowUp(feed.join('\n\n'), { hops: hops + 1, taint });
  }

  // The user's click. Accepted from the chat window only (enforced by the IPC layer); here the card is the authority, not the caller.
  async function decide({ id, hash, decision, confirm: secondClick = false }) {
    const cards = list();
    const card = cards.find((c) => c.id === id);
    if (!card) return { ok: false, error: 'That card no longer exists.' };
    if (card.status !== 'pending') return { ok: false, error: `That card is already ${card.status}.` };
    if (typeof hash !== 'string' || hash !== card.hash || hashOf(card.tool, card.args) !== card.hash) { audit.log(card.tool, card.args, 'refused', 'hash mismatch'); return { ok: false, error: 'The card does not match what was approved. Nothing was done.' }; }
    if (decision === 'approve' && card.echo && secondClick !== true) { audit.log(card.tool, card.args, 'refused', 'echo card needs the second click'); return { ok: false, needsConfirm: true, error: `This text is copied word for word from ${card.echo.source}, which was read this turn. Confirm to send it.` }; }
    const set = (patch) => { const all = readCards(); const c = all.find((x) => x.id === id); Object.assign(c, patch); writeCards(all); emit({ type: 'card', card: c }); return c; };
    if (decision !== 'approve') {
      set({ status: 'denied', decided_at: new Date(now()).toISOString() });
      audit.log(card.tool, card.args, 'denied', card.id);
      sendFollowUp(label(card.tool, 'The user denied this action. It was not done.'), { hops: (card.hops || 0) + 1, taint: chains.get(card.id) || null }); chains.delete(card.id);   // the click continues the same round budget
      return { ok: true, status: 'denied' };
    }
    set({ status: 'running', decided_at: new Date(now()).toISOString() });   // single flight: a second click finds it no longer pending
    sending.add(card.id);
    let r;
    try {
      const def = byName.get(card.tool);
      if (def.snapshot && card.guard !== undefined && (await def.snapshot(card.args).catch(() => null)) !== card.guard) r = { isError: true, text: 'Failed: what the card pointed at changed after it was shown. Nothing was run.' };
      else r = await run(card.tool, card.args);   // the handler re-checks the write grant itself
    } catch (e) { r = { isError: true, text: `Failed: ${String((e && e.message) || e)}` }; }
    finally { sending.delete(card.id); }
    const ts = new Date(now()).toISOString();
    let parsed = null;
    if (!r.isError) { try { parsed = JSON.parse(r.text); } catch { /* not JSON */ } }
    const receipt = parsed && parsed.receipt ? parsed.receipt : null;
    const reply = parsed && parsed.reply !== undefined ? parsed.reply : null;
    const rec = { id: card.id, ts, action: card.tool, destination: card.preview.destination, status: r.isError ? 'failed' : 'delivered', result: r.isError ? reasonOf(r.text) : String(r.text || '').slice(0, 300), receipt, reply };
    const logged = sentFile ? appendReceipt(sentFile, rec) : false;
    // A launched session: the card keeps its ids and says "running" until the process ends (settleRun) or is found gone (expire).
    const session = parsed && parsed.launch_id ? { launch_id: parsed.launch_id, session_id: parsed.session_id, pid: parsed.pid, repo: parsed.repo, path: parsed.path, started_at: parsed.started_at } : null;
    const done = set({ status: r.isError ? 'failed' : 'executed', outcome: clip(r.text), sent_at: r.isError ? null : ts, failed_reason: r.isError ? reasonOf(r.text) : null, receipt, reply, receipt_logged: logged, ...(session && !r.isError ? { session, run_state: 'running' } : {}) });
    emit({ type: 'receipt', card: done, receipt: rec });
    // The reply is read once, at the end of the send's wait. If it was still pending, look once more later (read only), update the card, and
    // never touch the send record. Best effort: an app that exits before then simply keeps "no reply captured".
    if (lateReply && !r.isError && reply === 'pending' && receipt) {
      const t = setTimeout(async () => {
        try { const got = await lateReply(card); if (got) { const all = readCards(); const c = all.find((x) => x.id === id); if (c && c.status === 'executed' && (!c.reply || c.reply === 'pending')) { c.reply = got; writeCards(all); emit({ type: 'card', card: c }); } } } catch { /* optional */ }
      }, lateReplyMs);
      if (t.unref) t.unref();
    }
    // Back into her session as a labelled tool result, so she confirms in her own words from the record, never from intent.
    const confirm = r.isError ? r.text : `${r.text}\n\n[receipt] ${rec.status} at ${ts}${receipt ? `; Firm event ${receipt.event_id}${receipt.acked_at ? ' acked' : receipt.delivered_at ? ' delivered to Management' : ' recorded'}` : ''}${reply ? `; Management's reply: ${reply}` : ''}${logged ? '' : ' (receipt log could not be written)'}`;
    sendFollowUp(label(card.tool, confirm), { hops: (card.hops || 0) + 1, taint: chains.get(card.id) || null }); chains.delete(card.id);
    return { ok: true, status: done.status };
  }

  // A launched session's process ended: record how, on its card, so the card settles like every other.
  function settleRun({ launch_id, code, signal, error, stderr }) {
    const all = readCards();
    const c = all.find((x) => x.session && x.session.launch_id === launch_id);
    if (!c) return false;
    c.run_state = code === 0 ? 'finished' : 'failed';
    c.run_exit = { code, signal, ended_at: new Date(now()).toISOString(), ...(code === 0 ? {} : { reason: String(error || stderr || (signal ? `signal ${signal}` : `exit code ${code}`)).slice(0, 200) }) };
    writeCards(all); emit({ type: 'card', card: c });
    audit.log(c.tool, c.args, c.run_state, `session ${c.session.session_id}`);
    return true;
  }

  // End of a conversation: every pending card is cancelled (approving one later would run a write into a new conversation).
  function cancelPending(why = 'cancelled') {
    const all = readCards();
    let n = 0;
    for (const c of all) if (c.status === 'pending') { chains.delete(c.id); c.status = 'cancelled'; c.decided_at = new Date(now()).toISOString(); c.by = why; n++; emit({ type: 'card', card: c }); audit.log(c.tool, c.args, 'cancelled', c.id); }
    if (n) writeCards(all);
    return n;
  }
  return { parse: (text, opts) => parseActions(text, names, opts), process, decide, list, names, cancelPending, settleRun, MAX_ACTIONS, receipts: () => readReceipts(sentFile) };
}

module.exports = { parseActions, createActionEngine, previewOf, hashOf, renderReceipts, readReceipts, MAX_ACTIONS, MAX_HOPS, CARD_TTL_MS, RECEIPT_WINDOW_MS, RECEIPT_LINES, RUNNING_STALE_MS, LATE_REPLY_MS };
