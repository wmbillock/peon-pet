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

function createActionEngine({ defs, run, grants, cardsFile, now = () => Date.now(), sendFollowUp, emit = () => {}, audit }) {
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
    const feed = [];
    for (const e of parsed.errors) feed.push(`[tool result: invalid action]\n${fail(e)}`);
    if (!parsed.actions.length && !feed.length) return;
    if (hops >= MAX_HOPS) { emit({ type: 'notice', turnId, text: `Stopped after ${MAX_HOPS} automatic tool rounds. Ask again to continue.` }); audit.log('action', {}, 'refused', 'hop limit'); return; }
    for (const a of parsed.actions) {
      const need = level(a.tool);
      if (need === 'read') { const r = await run(a.tool, a.args); feed.push(label(a.tool, r.text)); continue; }
      const g = live();
      if (!g || g.level !== 'write') {
        audit.log(a.tool, a.args, 'refused', 'no write grant');
        feed.push(label(a.tool, `Refused: ${a.tool} is a write and needs write access to ${SERVER}${g ? ' (only read is granted)' : ''}. The owner grants it in the dashboard under Euphonia > Tool access. Nothing was sent or changed.`));
        continue;
      }
      const cards = list();
      const hash = hashOf(a.tool, a.args);
      const dup = cards.find((c) => c.status === 'pending' && c.hash === hash);
      if (dup) { feed.push(label(a.tool, 'An identical approval card is already waiting. Nothing was done yet.')); continue; }
      const card = { id: crypto.randomBytes(5).toString('hex'), tool: a.tool, args: a.args, hash, preview: previewOf(a.tool, a.args), status: 'pending', turnId, created_at: new Date(now()).toISOString(), expires_at: new Date(now() + CARD_TTL_MS).toISOString() };
      writeCards([...cards, card]);
      audit.log(a.tool, a.args, 'card', card.id);
      emit({ type: 'card', card });
      feed.push(label(a.tool, `Waiting for the user to approve a card in the chat window (expires in 10 minutes). Nothing has been done. Do not say it was done.`));
    }
    const needsReply = feed.some((f) => !/Waiting for the user to approve/.test(f)) ;
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
      sendFollowUp(label(card.tool, 'The user denied this action. It was not done.'), { hops: 0 });
      return { ok: true, status: 'denied' };
    }
    set({ status: 'running', decided_at: new Date(now()).toISOString() });   // single flight: a second click finds it no longer pending
    const r = await run(card.tool, card.args);   // the handler re-checks the write grant itself
    const done = set({ status: r.isError ? 'failed' : 'executed', outcome: clip(r.text) });
    sendFollowUp(label(card.tool, r.text), { hops: 0 });
    return { ok: true, status: done.status };
  }

  return { parse: (text) => parseActions(text, names), process, decide, list, names, MAX_ACTIONS };
}

module.exports = { parseActions, createActionEngine, previewOf, hashOf, MAX_ACTIONS, MAX_HOPS, CARD_TTL_MS };
