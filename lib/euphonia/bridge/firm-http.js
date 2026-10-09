'use strict';
// The Firm's local HTTP surface, as read from the live source at acdf42c54d (projects/the-firm/backend/src/firm/). Loopback-only
// (HOST=127.0.0.1). Reads need no token. Writes need the per-process token from GET /api/session (local_auth.py): the header
// X-Firm-Token on a POST, and on the WebSocket the subprotocol `firm, firm-token.<token>` plus an allowed Origin; a missing or
// wrong token is refused with 403 before anything is sent.
//   GET  /api/session -> { token }                                                                                  local_auth.py
//   GET  /api/workstreams, /api/workstreams/{id}, /api/inbox, /api/prs, /api/projects, /api/health, /api/stats   main.py, restart.py
//   GET  /api/events?since_id=N&limit=N (cap 500) | ?latest=1&limit=N      main.py -> store.list_events / latest_events (oldest first)
//        rows: { id, ts, kind, actor, target_agent, payload, delivered_at, acked_at }; actor is user | scheduler | system | a thread id
//   GET  /api/threads/{id}/messages                                        main.py -> manager.get_transcript (type, role, text, audience)
//   POST /api/inbox/{item_id}/respond { action, text } + X-Firm-Token -> { sent: text|null, item }   inbox.respond (a message to Management as the user)
//   WS   /ws/threads/management (Origin + token subprotocol)  client frame {type:'message', text}; no ack, no id; a failure is {type:'system', text, audience:'chat'}
// Receipts: the server returns no id for a sent message, so after a send the events feed is polled for the `user_message` event
// (actor user, target_agent management, payload.text equal to the text sent); its id/ts is the receipt and delivered_at/acked_at
// say whether Management picked it up. Management's reply is the next chat-audience assistant message in the transcript.
const { sendOnce } = require('./ws-client');

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;                 // workstream and thread ids
// Inbox item ids are compound (`plan_ok:ws_28b136:1`, `branch_drift:/Users/x/repo:main:warn`): colons and paths are normal
// (the route is /api/inbox/{item_id:path}). Still one URL path segment after encodeURIComponent.
const INBOX_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:/@ -]{0,255}$/;
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/;
const MANAGEMENT = 'management';
const EVENTS_CAP = 500;
const RECEIPT_WAIT_MS = 20000;
const RECEIPT_STEP_MS = 1000;

const int = (v, what, max) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`${what} must be an integer between 0 and ${max}`); return n; };

function createFirmHttp({ baseUrl = 'http://127.0.0.1:8420', fetchImpl = fetch, wsSend = sendOnce, timeoutMs = 4000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), receiptWaitMs = RECEIPT_WAIT_MS, receiptStepMs = RECEIPT_STEP_MS } = {}) {
  let u;
  try { u = new URL(baseUrl); } catch { throw new Error(`Invalid Firm URL: ${baseUrl}`); }
  if (u.protocol !== 'http:' || !LOOPBACK.test(u.hostname)) throw new Error('The Firm URL must be http on localhost');
  const origin = u.origin;
  const call = async (path, init = {}) => {
    const res = await fetchImpl(`${origin}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    let body = null;
    try { body = await res.json(); } catch { /* empty or not JSON */ }
    if (!res.ok) throw new Error(`The Firm replied HTTP ${res.status}${body && body.detail ? `: ${String(body.detail).slice(0, 200)}` : ''}`);
    return body;
  };
  const events = ({ sinceId = 0, limit = 100, latest = false } = {}) => call(latest ? `/api/events?latest=1&limit=${int(limit, 'limit', EVENTS_CAP)}` : `/api/events?since_id=${int(sinceId, 'since_id', Number.MAX_SAFE_INTEGER)}&limit=${int(limit, 'limit', EVENTS_CAP)}`);
  const messages = (threadId = MANAGEMENT) => { if (!ID_RE.test(threadId)) throw new Error('Invalid thread id'); return call(`/api/threads/${encodeURIComponent(threadId)}/messages`); };
  const token = async () => { const s = await call('/api/session'); if (!s || !s.token) throw new Error('The Firm gave no session token'); return s.token; };   // fetched per write, never cached
  const lastEventId = async () => { try { const e = await events({ latest: true, limit: 1 }); return Array.isArray(e) && e.length ? Number(e[e.length - 1].id) || 0 : 0; } catch { return null; } };

  // After a send: find the user_message event for `text`, then Management's first chat reply after it. Bounded by receiptWaitMs.
  async function receiptFor(text, sinceId, { startedAt = Date.now() } = {}) {
    const out = { receipt: null, reply: 'pending' };
    if (sinceId == null) return { ...out, note: 'events feed unreachable before the send; no receipt possible' };
    let cursor = sinceId;
    const deadline = startedAt + receiptWaitMs;
    for (;;) {
      let batch = [];
      try { batch = await events({ sinceId: cursor, limit: 200 }); } catch { batch = []; }
      for (const e of Array.isArray(batch) ? batch : []) {
        cursor = Math.max(cursor, Number(e.id) || cursor);
        if (!out.receipt && e.kind === 'user_message' && e.actor === 'user' && e.target_agent === MANAGEMENT && e.payload && e.payload.text === text) {
          out.receipt = { event_id: e.id, ts: e.ts, delivered_at: e.delivered_at || null, acked_at: e.acked_at || null };
        } else if (out.receipt && e.id === out.receipt.event_id) {
          out.receipt.delivered_at = e.delivered_at || out.receipt.delivered_at; out.receipt.acked_at = e.acked_at || out.receipt.acked_at;
        }
      }
      if (out.receipt) {
        try {
          const msgs = await messages(MANAGEMENT);
          const list = Array.isArray(msgs) ? msgs : [];
          const i = list.findIndex((m) => m && m.type === 'text' && m.role === 'user' && m.text === text);
          const reply = i >= 0 ? list.slice(i + 1).find((m) => m && m.type === 'text' && m.role !== 'user' && m.audience !== 'activity' && m.text) : null;
          if (reply) { out.reply = String(reply.text).slice(0, 600); return out; }
        } catch { /* the reply is optional */ }
      }
      if (Date.now() >= deadline) return out;
      await sleep(receiptStepMs);
    }
  }

  return {
    origin,
    workstreams: () => call('/api/workstreams'),
    workstream: (id) => { if (!ID_RE.test(id)) throw new Error('Invalid workstream id'); return call(`/api/workstreams/${encodeURIComponent(id)}`); },
    inbox: () => call('/api/inbox'),
    prs: () => call('/api/prs'),
    projects: () => call('/api/projects'),
    health: () => call('/api/health'),
    stats: () => call('/api/stats'),
    events,
    messages,
    async respondInbox(id, action, text) {
      if (!INBOX_ID_RE.test(id)) throw new Error('Invalid inbox id');
      const before = await lastEventId();
      const r = await call(`/api/inbox/${encodeURIComponent(id)}/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Firm-Token': await token() }, body: JSON.stringify({ action, text }) });
      const sent = r && typeof r.sent === 'string' ? r.sent : null;
      return { ...(r || {}), ...(sent ? await receiptFor(sent, before) : { receipt: null, reply: null }) };
    },
    async sendToManagement(text) {
      const before = await lastEventId();
      const r = await wsSend({ origin, path: `/ws/threads/${MANAGEMENT}`, token: await token(), text });
      if (r.notes && r.notes.length) return { ...r, receipt: null, reply: null, note: 'The Firm answered with a system notice (see notes); treat the send as refused unless a receipt follows.' };
      return { ...r, ...(await receiptFor(text, before)) };
    },
  };
}

module.exports = { createFirmHttp, ID_RE, INBOX_ID_RE, MANAGEMENT, RECEIPT_WAIT_MS };
