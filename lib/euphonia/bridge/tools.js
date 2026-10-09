'use strict';
// The actions behind the euphonia-bridge capability (not an MCP server: see actions.js). Names follow lib/euphonia/tool-class.js so a dashboard "read" grant allows
// only the read tools: read verbs (get/list/view/search/check) mean read; everything else is a write.
// Defence in depth: each call re-checks grants.json ITSELF (an unexpired grant for `euphonia-bridge` at the needed level), and
// every call, allowed or refused, is audited. Authority settings (grants, tool access, voice focus, restricted) are not reachable.
const { classifyTool } = require('../tool-class');
const gh = require('./gh');
const { INBOX_ID_RE } = require('./firm-http');

const SERVER = 'euphonia-bridge';
const ASSISTANT_PREFIX = '[Assistant] ';
const FIRM_BASE = 'pricing/the-firm/develop';   // every Firm PR must target this base; main is held
const FIRM_BRANCH_RE = /^(firm|the-firm|ws)[/_-]/i;
const MAX_WATCH = 10;
const INBOX_ACTIONS = /^(reply|ask|cancel|pause|retry|raise|approve|changes|allow|reject|answer|override|option:\d{1,2})$/;
const COSMETIC_KEYS = ['name', 'soundPack', 'border', 'species'];

const str = (v, what, max = 200) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max || v.includes('\0')) throw new Error(`${what} is required (text, at most ${max} characters)`);
  return v;
};
const slug = (v, what) => { if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v)) throw new Error(`${what} is not a valid identifier`); return v; };
const inboxId = (v) => { if (typeof v !== 'string' || !INBOX_ID_RE.test(v)) throw new Error('id is not a valid inbox item id'); return v; };

function createTools({ firm, ghRun, cosmetics }) {
  const j = (v) => JSON.stringify(v, null, 2);
  const asJson = (stdout) => { try { return JSON.parse(stdout); } catch { return stdout.trim(); } };

  const defs = [
    { name: 'firm_get_status', description: 'Read The Firm status: workstreams (state, counts, cost in USD) and how many inbox cards wait on the user.', schema: {}, run: async () => {
      const [workstreams, inbox] = await Promise.all([firm.workstreams(), firm.inbox().catch(() => null)]);
      return j({ workstreams: (workstreams || []).map((w) => ({ id: w.id, title: w.title, status: w.status, counts: w.counts, cost_usd: w.cost_usd })), inbox_waiting: Array.isArray(inbox) ? inbox.length : null });
    } },
    { name: 'firm_list_events', description: 'Read The Firm event log: id, ts, kind, actor (user, scheduler, system or a thread id), target_agent, payload, delivered_at, acked_at. since: an event id (integer) or an ISO timestamp; workstream: keep only events mentioning that id.', schema: { since: { type: ['integer', 'string'], description: 'event id, or ISO timestamp' }, workstream: { type: 'string' }, limit: { type: 'integer' } }, run: async (a = {}) => {
      const limit = a.limit === undefined ? 100 : a.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('limit must be 1-500');
      let rows;
      if (a.since === undefined || a.since === null || a.since === '') rows = await firm.events({ latest: true, limit });
      else if (Number.isInteger(a.since) || /^\d{1,12}$/.test(String(a.since))) rows = await firm.events({ sinceId: Number(a.since), limit });
      else {
        const t = Date.parse(String(a.since));
        if (!Number.isFinite(t)) throw new Error('since must be an event id or an ISO timestamp');
        rows = (await firm.events({ latest: true, limit: 500 })).filter((e) => Date.parse(e.ts) >= t).slice(-limit);
      }
      if (a.workstream !== undefined) { const ws = slug(a.workstream, 'workstream'); rows = rows.filter((e) => JSON.stringify(e).includes(ws)); }
      return j(rows);
    } },
    { name: 'firm_list_inbox', description: 'Read The Firm inbox: everything waiting on the user (id, kind, workstream, question, buttons).', schema: {}, run: async () => j(await firm.inbox()) },
    { name: 'firm_get_workstream', description: 'Read one Firm workstream by id.', schema: { id: { type: 'string', description: 'workstream id, e.g. ws_28b136' } }, required: ['id'], run: async (a) => j(await firm.workstream(slug(a.id, 'id'))) },
    { name: 'github_view_pr', description: 'Read one pull request in Affirm/affirm-builders (state, review decision, merge state).', schema: { number: { type: 'integer' } }, required: ['number'], run: async (a) => j(asJson(await ghRun(gh.commands.viewPr(a)))) },
    { name: 'github_list_prs', description: 'List pull requests in Affirm/affirm-builders.', schema: { state: { type: 'string', enum: gh.PR_STATES }, limit: { type: 'integer' } }, run: async (a) => j(asJson(await ghRun(gh.commands.listPrs(a)))) },
    { name: 'github_check_pr', description: 'Read one pull request\'s CI checks together with its base, head, state, draft flag, merge state and review decision (Affirm/affirm-builders).', schema: { number: { type: 'integer' } }, required: ['number'], run: async (a) => {
      const [pr, checks] = await Promise.all([ghRun(gh.commands.viewPr(a)).then(asJson).catch((e) => ({ error: e.message })), ghRun(gh.commands.prChecks(a)).then(asJson).catch((e) => ({ error: e.message }))]);
      return j({ pr, checks });
    } },
    { name: 'github_firm_pr_watch', description: `Read the open PRs that are Firm work (The Firm's own PR record, else PRs labelled the-firm or on a Firm branch) with base, head, state, draft, merge state, review decision and checks; flags any whose base is not ${FIRM_BASE}.`, schema: {}, run: async () => {
      let record = null, recordError = null;
      try { record = await firm.prs(); } catch (e) { recordError = e.message; }
      const open = Array.isArray(record) ? record.filter((r) => r && r.pr_number && !r.merged_at && String(r.pr_state || '').toLowerCase() !== 'closed' && String(r.pr_state || '').toLowerCase() !== 'merged') : null;
      let prs;
      if (open) {
        prs = [];
        for (const r of open.slice(0, MAX_WATCH)) {
          const live = await ghRun(gh.commands.viewPr({ number: r.pr_number })).then(asJson).catch((e) => ({ number: Number(r.pr_number), error: e.message }));
          prs.push({ ...live, workstream_id: r.workstream_id, firm_title: r.title, firm_branch: r.branch, firm_base_branch: r.base_branch, firm_status: r.status });
        }
      } else {
        const all = asJson(await ghRun(gh.commands.listFirmPrs({})));
        prs = (Array.isArray(all) ? all : []).filter((p) => (p.labels || []).some((l) => gh.FIRM_LABELS.includes(typeof l === 'string' ? l : l && l.name)) || FIRM_BRANCH_RE.test(String(p.headRefName || '')) || p.baseRefName === FIRM_BASE);
      }
      const flagged = prs.filter((p) => p.baseRefName && p.baseRefName !== FIRM_BASE).map((p) => ({ number: p.number, baseRefName: p.baseRefName, headRefName: p.headRefName, url: p.url, problem: `base is ${p.baseRefName}, not ${FIRM_BASE}` }));
      return j({ required_base: FIRM_BASE, source: open ? 'the-firm /api/prs' : `gh pr list (The Firm record unavailable${recordError ? `: ${recordError}` : ''})`, prs, flagged, note: flagged.length ? `${flagged.length} PR(s) are not based on ${FIRM_BASE}; merges to main are held.` : 'every watched PR targets the Firm base' });
    } },

    { name: 'firm_send_to_management', description: `WRITE. Send a message to The Firm's Management as the user. The text is prefixed "${ASSISTANT_PREFIX.trim()}" so Management can tell it was relayed. Only after the user approved the exact text in chat.`, schema: { text: { type: 'string' } }, required: ['text'], write: true, run: async (a) => {
      const text = ASSISTANT_PREFIX + str(a.text, 'text', 4000);
      const r = await firm.sendToManagement(text);
      if (r && Array.isArray(r.notes) && r.notes.length) throw new Error(`The Firm refused the message: ${r.notes.join(' | ').slice(0, 300)}`);
      return j(r);
    } },
    { name: 'firm_respond_inbox', description: `WRITE. Press a button on a Firm inbox card as the user. Any text is prefixed "${ASSISTANT_PREFIX.trim()}" (it appears after The Firm's own [Inbox] label). Only after the user approved the exact action and text in chat.`, schema: { id: { type: 'string' }, action: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'action'], write: true, run: async (a) => {
      const id = inboxId(a.id);
      if (typeof a.action !== 'string' || !INBOX_ACTIONS.test(a.action)) throw new Error('action is not an allowed inbox action');
      const text = ASSISTANT_PREFIX + (a.text ? str(a.text, 'text', 4000) : 'relayed by the assistant');
      return j(await firm.respondInbox(id, a.action, text));
    } },
    { name: 'pet_set_cosmetics', description: 'WRITE (cosmetic only). Set the pet\'s name, sound pack, border or species. No other setting is reachable. Only after the user approved the change in chat.', schema: { name: { type: 'string' }, soundPack: { type: 'string' }, border: { type: 'string' }, species: { type: 'string' } }, write: true, run: async (a) => {
      const patch = {};
      for (const k of Object.keys(a || {})) { if (!COSMETIC_KEYS.includes(k)) throw new Error(`${k} is not a cosmetic setting`); if (typeof a[k] !== 'string') throw new Error(`${k} must be text`); patch[k] = a[k]; }
      if (!Object.keys(patch).length) throw new Error('Nothing to change');
      return j(cosmetics(patch));
    } },
  ];
  // The level a tool needs is declared (`write: true`) AND must agree with the name classifier the grant path uses, so a
  // rename can never silently downgrade a write to a read.
  for (const d of defs) {
    d.class = d.write ? 'write' : 'read';
    if (classifyTool(d.name) !== d.class) throw new Error(`bridge tool ${d.name} is declared ${d.class} but its name classifies as ${classifyTool(d.name)}`);
  }
  return defs;
}

// grants: () => active grant entries (already filtered by expiry by the caller or here). Needs `level` or better.
function grantAllows(grants, need, nowMs = Date.now()) {
  const live = (grants || []).filter((x) => x && x.server === SERVER && (x.expires_at == null || Date.parse(x.expires_at) > nowMs));
  const g = live.find((x) => x.level === 'write') || live[0];   // the highest unexpired level counts
  if (!g) return { ok: false, reason: `no unexpired grant for ${SERVER}` };
  if (need === 'write' && g.level !== 'write') return { ok: false, reason: `${SERVER} has only a read grant; this tool needs write` };
  if (g.level !== 'read' && g.level !== 'write') return { ok: false, reason: 'invalid grant level' };
  return { ok: true };
}

function createRunner({ defs, readGrants, audit, now = () => Date.now() }) {
  const byName = new Map(defs.map((d) => [d.name, d]));
  return async function call(name, args = {}) {
    const d = byName.get(name);
    if (!d) { audit.log(name, args, 'refused', 'unknown tool'); return { isError: true, text: `Unknown tool: ${name}` }; }
    const need = d.class;   // the classifier, not the model, decides what level a tool needs
    const verdict = grantAllows(readGrants(), need, now());
    if (!verdict.ok) { audit.log(name, args, 'refused', verdict.reason); return { isError: true, text: `Refused: ${verdict.reason}. ${name} needs ${need} access to ${SERVER}. The owner grants it in the dashboard under Euphonia > Tool access.` }; }
    if (need === 'write' && audit.log(name, args, 'attempt') === false) return { isError: true, text: 'Refused: the audit log could not be written, and writes are never made unrecorded.' };
    try {
      const text = await d.run(args);
      audit.log(name, args, 'ok');
      return { isError: false, text };
    } catch (e) {
      const msg = String((e && e.message) || e || 'unknown error');
      audit.log(name, args, 'error', msg);
      return { isError: true, text: `Failed: ${msg}` };
    }
  };
}

module.exports = { createTools, createRunner, grantAllows, SERVER, ASSISTANT_PREFIX, INBOX_ACTIONS, COSMETIC_KEYS, FIRM_BASE };
