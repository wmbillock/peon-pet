'use strict';
// The tools the euphonia-bridge MCP server offers. Names follow lib/euphonia/tool-class.js so a dashboard "read" grant allows
// only the read tools: read verbs (get/list/view/search/check) mean read; everything else is a write.
// Defence in depth: each call re-checks grants.json ITSELF (an unexpired grant for `euphonia-bridge` at the needed level), and
// every call, allowed or refused, is audited. Authority settings (grants, tool access, voice focus, restricted) are not reachable.
const { classifyTool } = require('../tool-class');
const gh = require('./gh');

const SERVER = 'euphonia-bridge';
const ASSISTANT_PREFIX = '[Assistant] ';
const INBOX_ACTIONS = /^(reply|ask|cancel|pause|retry|raise|approve|changes|allow|reject|answer|override|option:\d{1,2})$/;
const COSMETIC_KEYS = ['name', 'soundPack', 'border', 'species'];

const str = (v, what, max = 200) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max || v.includes('\0')) throw new Error(`${what} is required (text, at most ${max} characters)`);
  return v;
};
const slug = (v, what) => { if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v)) throw new Error(`${what} is not a valid identifier`); return v; };

function createTools({ firm, ghRun, cosmetics }) {
  const j = (v) => JSON.stringify(v, null, 2);
  const asJson = (stdout) => { try { return JSON.parse(stdout); } catch { return stdout.trim(); } };

  const defs = [
    { name: 'firm_get_status', description: 'Read The Firm status: workstreams (state, counts, cost in USD) and what each in-flight workstream is doing now.', schema: {}, run: async () => {
      const [workstreams, now] = await Promise.all([firm.workstreams(), firm.now().catch(() => null)]);
      return j({ workstreams: (workstreams || []).map((w) => ({ id: w.id, title: w.title, status: w.status, counts: w.counts, cost_usd: w.cost_usd })), now });
    } },
    { name: 'firm_list_inbox', description: 'Read The Firm inbox: everything waiting on the user (id, kind, workstream, question, buttons).', schema: {}, run: async () => j(await firm.inbox()) },
    { name: 'firm_get_workstream', description: 'Read one Firm workstream by id.', schema: { id: { type: 'string', description: 'workstream id, e.g. ws_28b136' } }, required: ['id'], run: async (a) => j(await firm.workstream(slug(a.id, 'id'))) },
    { name: 'github_view_pr', description: 'Read one pull request in Affirm/affirm-builders (state, review decision, merge state).', schema: { number: { type: 'integer' } }, required: ['number'], run: async (a) => j(asJson(await ghRun(gh.commands.viewPr(a)))) },
    { name: 'github_list_prs', description: 'List pull requests in Affirm/affirm-builders.', schema: { state: { type: 'string', enum: gh.PR_STATES }, limit: { type: 'integer' } }, run: async (a) => j(asJson(await ghRun(gh.commands.listPrs(a)))) },
    { name: 'github_list_issues', description: 'List issues in Affirm/affirm-builders that carry an allowed label (the-firm).', schema: { label: { type: 'string', enum: gh.LABELS }, state: { type: 'string', enum: gh.ISSUE_STATES }, limit: { type: 'integer' } }, required: ['label'], run: async (a) => j(asJson(await ghRun(gh.commands.listIssues(a)))) },
    { name: 'github_check_pr', description: 'Read the CI checks of one pull request in Affirm/affirm-builders.', schema: { number: { type: 'integer' } }, required: ['number'], run: async (a) => j(asJson(await ghRun(gh.commands.prChecks(a)))) },

    { name: 'firm_send_to_management', description: `WRITE. Send a message to The Firm's Management as the user. The text is prefixed "${ASSISTANT_PREFIX.trim()}" so Management can tell it was relayed. Only after the user approved the exact text in chat.`, schema: { text: { type: 'string' } }, required: ['text'], write: true, run: async (a) => {
      const text = ASSISTANT_PREFIX + str(a.text, 'text', 4000);
      return j(await firm.sendToManagement(text));
    } },
    { name: 'firm_respond_inbox', description: `WRITE. Press a button on a Firm inbox card as the user. Any text is prefixed "${ASSISTANT_PREFIX.trim()}" (it appears after The Firm's own [Inbox] label). Only after the user approved the exact action and text in chat.`, schema: { id: { type: 'string' }, action: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'action'], write: true, run: async (a) => {
      const id = slug(a.id, 'id');
      if (typeof a.action !== 'string' || !INBOX_ACTIONS.test(a.action)) throw new Error('action is not an allowed inbox action');
      const text = ASSISTANT_PREFIX + (a.text ? str(a.text, 'text', 4000) : 'relayed by the assistant');
      return j(await firm.respondInbox(id, a.action, text));
    } },
    { name: 'firm_file_task', description: 'WRITE. File a task for The Firm as a GitHub issue in Affirm/affirm-builders labelled the-firm. Returns the issue URL. Only after the user approved the exact title and body in chat.', schema: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'], write: true, run: async (a) => {
      const out = (await ghRun(gh.commands.createIssue({ title: a.title, body: `${a.body}\n\n_Filed by the user's assistant (Euphonia) for The Firm's intake._` }))).trim();
      const url = (out.match(/https:\/\/github\.com\/Affirm\/affirm-builders\/issues\/\d+/) || [])[0];
      if (!url) throw new Error('GitHub did not return an issue URL');
      return j({ url });
    } },
    { name: 'pet_set_cosmetics', description: 'WRITE (cosmetic only). Set the pet\'s name, sound pack, border or species. No other setting is reachable. Only after the user approved the change in chat.', schema: { name: { type: 'string' }, soundPack: { type: 'string' }, border: { type: 'string' }, species: { type: 'string' } }, write: true, run: async (a) => {
      const patch = {};
      for (const k of Object.keys(a || {})) { if (!COSMETIC_KEYS.includes(k)) throw new Error(`${k} is not a cosmetic setting`); patch[k] = a[k]; }
      if (!Object.keys(patch).length) throw new Error('Nothing to change');
      return j(cosmetics(patch));
    } },
  ];
  for (const d of defs) d.class = classifyTool(d.name);
  return defs;
}

// grants: () => active grant entries (already filtered by expiry by the caller or here). Needs `level` or better.
function grantAllows(grants, need, nowMs = Date.now()) {
  const g = (grants || []).find((x) => x && x.server === SERVER && (!x.expires_at || Date.parse(x.expires_at) > nowMs));
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
    if (!verdict.ok) { audit.log(name, args, 'refused', verdict.reason); return { isError: true, text: `Refused: ${verdict.reason}. The owner grants access in the dashboard under Euphonia > Tool access.` }; }
    if (need === 'write' && audit.log(name, args, 'attempt') === false) return { isError: true, text: 'Refused: the audit log could not be written, and writes are never made unrecorded.' };
    try {
      const text = await d.run(args);
      audit.log(name, args, 'ok');
      return { isError: false, text };
    } catch (e) {
      audit.log(name, args, 'error', e.message);
      return { isError: true, text: `Failed: ${e.message}` };
    }
  };
}

module.exports = { createTools, createRunner, grantAllows, SERVER, ASSISTANT_PREFIX, INBOX_ACTIONS, COSMETIC_KEYS };
