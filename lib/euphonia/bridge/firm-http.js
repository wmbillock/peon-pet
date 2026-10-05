'use strict';
// The Firm's local HTTP surface, as verified on origin/pricing/the-firm/develop (projects/the-firm/backend/src/firm/):
//   GET  /api/workstreams, /api/workstreams/{id}, /api/now, /api/inbox     main.py (reads; no token)
//   GET  /api/session -> { token }                                         local_auth.py
//   POST /api/inbox/{item_id}/respond { action, text }  + X-Firm-Token     main.py -> inbox.respond (a message to Management as the user)
//   WS   /ws/threads/management  {type:'message', text}                    ws.py (Origin + firm-token.<token> subprotocol)
const { sendOnce } = require('./ws-client');

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/;

function createFirmHttp({ baseUrl = 'http://127.0.0.1:8420', fetchImpl = fetch, wsSend = sendOnce, timeoutMs = 4000 } = {}) {
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
  const token = async () => { const s = await call('/api/session'); if (!s || !s.token) throw new Error('The Firm gave no session token'); return s.token; };
  return {
    origin,
    workstreams: () => call('/api/workstreams'),
    workstream: (id) => { if (!ID_RE.test(id)) throw new Error('Invalid workstream id'); return call(`/api/workstreams/${encodeURIComponent(id)}`); },
    now: () => call('/api/now'),
    inbox: () => call('/api/inbox'),
    async respondInbox(id, action, text) {
      if (!ID_RE.test(id)) throw new Error('Invalid inbox id');
      return call(`/api/inbox/${encodeURIComponent(id)}/respond`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Firm-Token': await token() }, body: JSON.stringify({ action, text }),
      });
    },
    async sendToManagement(text) {
      return wsSend({ origin, path: '/ws/threads/management', token: await token(), text });
    },
  };
}

module.exports = { createFirmHttp, ID_RE };
