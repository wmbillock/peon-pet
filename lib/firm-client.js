'use strict';
// Read-only client for The Firm's local backend (default http://127.0.0.1:8420).
// A thread there is one agent session: role (management, lead, worker, inspector, scout, plan,
// critique, review), workstream, and the Claude session_id that ties it to a transcript.

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/;

function parseBaseUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`Invalid Firm URL: ${url}`); }
  if (u.protocol !== 'http:' || !LOOPBACK.test(u.hostname)) throw new Error('The Firm URL must be http on localhost (127.0.0.1)');
  return u.origin;
}

function normalizeThread(t) {
  return {
    id: String(t.id),
    title: t.title || null,
    role: t.role || 'worker',
    status: t.status || 'unknown',
    cwd: t.cwd || null,
    sessionId: t.session_id || null,
    workstreamId: t.workstream_id || null,
    projectId: t.project_id || null,
    beadId: t.bead_id || null,
    createdAt: Number(t.created_at) || 0,
    updatedAt: Number(t.updated_at) || 0,
    lastMessage: t.last_message ? String(t.last_message).slice(0, 400) : null,
    contextPct: typeof t.context_pct === 'number' ? t.context_pct : null,
    costUsd: typeof t.cost_usd === 'number' ? t.cost_usd : null,
    model: t.model || null,
  };
}

function normalizeProject(p) {
  return { id: String(p.id), title: p.title || p.name || null };
}

function createFirmClient({ baseUrl = 'http://127.0.0.1:8420', fetchImpl = fetch, timeoutMs = 1500 } = {}) {
  const origin = parseBaseUrl(baseUrl);
  return {
    origin,
    // Project titles, so Firm agents group under real names. Optional: older backends may not have it.
    async projects() {
      const res = await fetchImpl(`${origin}/api/projects`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`The Firm replied HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? data.filter((p) => p && p.id).map(normalizeProject) : [];
    },
    async threads() {
      const res = await fetchImpl(`${origin}/api/threads`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`The Firm replied HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Unexpected reply from The Firm');
      return data.filter((t) => t && t.id).map(normalizeThread);
    },
  };
}

// Poll on an interval. Reports { available, threads, error } on every change; flips to unavailable
// only after two failures in a row so one slow reply doesn't flicker the dashboard.
function createFirmPoller({ client, intervalMs = 3000, onChange = () => {}, onTransition = () => {} }) {
  let state = { available: false, threads: [], projects: {}, error: null };
  let failures = 0;
  let ticks = 0;
  let timer = null;
  let stopped = false;

  const publish = (next) => {
    const changed = JSON.stringify(next) !== JSON.stringify(state);
    const flipped = next.available !== state.available;
    state = next;
    if (flipped) onTransition(state);
    if (changed) onChange(state);
  };

  async function tick() {
    try {
      const threads = await client.threads();
      failures = 0;
      // Project titles change rarely: fetch on the first poll, then every tenth.
      let projects = state.projects;
      if (client.projects && (ticks++ % 10 === 0)) {
        try { projects = Object.fromEntries((await client.projects()).map((p) => [p.id, p.title])); } catch { /* keep what we had */ }
      }
      publish({ available: true, threads, projects, error: null });
    } catch (e) {
      failures += 1;
      if (failures >= 2 || !state.available) publish({ available: false, threads: [], projects: {}, error: e.message });
    }
  }

  return {
    start() { stopped = false; tick(); timer = setInterval(() => { if (!stopped) tick(); }, intervalMs); },
    stop() { stopped = true; clearInterval(timer); },
    refresh: tick,
    get state() { return state; },
  };
}

module.exports = { createFirmClient, createFirmPoller, normalizeThread, normalizeProject, parseBaseUrl };
