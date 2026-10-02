'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

const SESSIONS_DIR = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
const SCAN_INTERVAL_MS = 1000;
const FILE_POLL_INTERVAL_MS = 500;
const FRESH_MS = 10 * 60 * 1000;         // only follow rollouts touched in the last 10 min
const PERMISSION_TIMEOUT_MS = 7000;
const SUBAGENT_IDLE_MS = 30000;          // spawned threads pause while the model thinks; be patient
const PENDING_CALLS = new Set(['function_call', 'custom_tool_call', 'tool_search_call']);
const CALL_OUTPUTS = new Set(['function_call_output', 'custom_tool_call_output', 'tool_search_output']);

const pad = (n) => String(n).padStart(2, '0');

// Codex writes rollouts to <root>/YYYY/MM/DD/ using the local date. A live session can cross
// midnight, but we keep following files we already registered, so today + yesterday is enough.
function dayDirs(root, now = new Date()) {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return [now, yesterday].map((d) => path.join(root, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate())));
}

/**
 * Watches Codex rollout transcripts (~/.codex/sessions) and emits the same events as JsonlWatcher,
 * each tagged `agent: 'codex'`:
 *   'session-event'  { sessionId, event, cwd?, timestamp, agent }
 *   'subagent-event' { sessionId, parentToolId, event, agent }
 *
 * Main sessions drive the pet. Guardian (auto-review) threads are ignored; spawned worker threads
 * (source.subagent.thread_spawn) become sub-agent windows.
 */
class CodexWatcher extends EventEmitter {
  constructor({ sessionsDir = SESSIONS_DIR } = {}) {
    super();
    this.sessionsDir = sessionsDir;
    this._files = new Map();  // filePath → state
    this._interval = null;
    this._startup = false;
  }

  start() {
    this._startup = true;
    this._scan();
    this._startup = false;
    this._interval = setInterval(() => this._scan(), SCAN_INTERVAL_MS);
  }

  stop() {
    if (this._interval) clearInterval(this._interval);
    for (const s of this._files.values()) this._teardown(s);
    this._files.clear();
  }

  // Sessions mid-turn or with unresolved tool calls (keeps the pet awake through long runs).
  getActiveSessionIds() {
    const active = new Set();
    for (const s of this._files.values()) {
      if (s.kind === 'main' && (s.turnActive || s.pendingTools.size > 0)) active.add(s.sessionId);
    }
    return active;
  }

  _scan() {
    for (const dir of dayDirs(this.sessionsDir)) {
      let names;
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const name of names) {
        if (!/^rollout-.*\.jsonl$/.test(name)) continue;
        const filePath = path.join(dir, name);
        if (this._files.has(filePath)) continue;
        let mtime;
        try { mtime = fs.statSync(filePath).mtimeMs; } catch { continue; }
        if (Date.now() - mtime > FRESH_MS) continue;  // not remembered, so a resumed old rollout is picked up later
        this._register(filePath, mtime);
      }
    }
  }

  _register(filePath, mtime) {
    const state = {
      filePath, mtime, startup: this._startup,
      offset: 0, lineBuffer: '',
      kind: null,                // 'main' | 'subagent' | 'ignore' (decided by session_meta)
      sessionId: null, cwd: null,
      pendingTools: new Set(), turnActive: false,
      permissionTimer: null, idleTimer: null, subToolId: null, subStopped: false,
      replaying: true,           // initial catch-up read: update state, emit nothing historical
      fsWatcher: null, pollInterval: null,
    };
    this._files.set(filePath, state);
    this._read(state);
    state.replaying = false;
    if (state.kind === 'main') {
      if (state.turnActive) this._emitSession(state, 'UserPromptSubmit');
      this._armPermissionTimer(state);
    } else if (state.kind === 'subagent') {
      this._armIdleTimer(state);
    }
    if (state.kind === 'ignore' || state.subStopped) { this._teardown(state); return; }
    const read = () => this._read(state);
    try { state.fsWatcher = fs.watch(filePath, read); } catch { /* polling covers it */ }
    state.pollInterval = setInterval(read, FILE_POLL_INTERVAL_MS);
  }

  _teardown(state) {
    try { state.fsWatcher?.close(); } catch { /* already closed */ }
    clearInterval(state.pollInterval);
    clearTimeout(state.permissionTimer);
    clearTimeout(state.idleTimer);
  }

  _read(state) {
    let buf;
    try {
      const fd = fs.openSync(state.filePath, 'r');
      const size = fs.fstatSync(fd).size;
      if (size <= state.offset) { fs.closeSync(fd); return; }
      buf = Buffer.alloc(size - state.offset);
      fs.readSync(fd, buf, 0, buf.length, state.offset);
      state.offset = size;
      fs.closeSync(fd);
    } catch { return; }

    const lines = (state.lineBuffer + buf.toString('utf8')).split('\n');
    state.lineBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      this._process(rec, state);
    }
    if (state.kind === 'subagent' && !state.replaying && !state.subStopped) this._armIdleTimer(state);
  }

  _emitSession(state, event, extra = {}) {
    if (state.replaying || state.kind !== 'main') return;
    this.emit('session-event', { sessionId: state.sessionId, event, timestamp: Date.now(), agent: 'codex', ...extra });
  }

  _process(rec, state) {
    const p = rec.payload && typeof rec.payload === 'object' ? rec.payload : {};
    if (rec.type === 'session_meta') return this._handleMeta(p, state);
    if (state.kind === 'subagent') {
      if (rec.type === 'event_msg' && (p.type === 'task_complete' || p.type === 'turn_aborted')) this._stopSubagent(state);
      return;
    }
    if (state.kind !== 'main') return;

    if (rec.type === 'turn_context') {
      if (!state.cwd && p.cwd) this._setCwd(state, p.cwd);
    } else if (rec.type === 'event_msg') {
      if (p.type === 'task_started') {
        state.turnActive = true;
        this._emitSession(state, 'UserPromptSubmit');
      } else if (p.type === 'task_complete') {
        this._finishTurn(state, 'Stop');
      } else if (p.type === 'turn_aborted') {
        this._finishTurn(state, 'PostToolUseFailure');  // interrupted → annoyed
      }
    } else if (rec.type === 'response_item') {
      if (PENDING_CALLS.has(p.type)) {
        const exempt = p.namespace === 'collaboration' || /^(wait|spawn|send|close)_/.test(p.name || '');
        if (!exempt && (p.call_id || p.id)) state.pendingTools.add(p.call_id || p.id);
        if (!state.replaying) this._armPermissionTimer(state);
      } else if (CALL_OUTPUTS.has(p.type)) {
        state.pendingTools.delete(p.call_id);
        if (state.pendingTools.size === 0) { clearTimeout(state.permissionTimer); state.permissionTimer = null; }
      } else if (p.type === 'message' && p.role === 'assistant') {
        this._emitSession(state, 'UserPromptSubmit');
      }
    }
  }

  _handleMeta(p, state) {
    if (state.kind) return;  // only the first session_meta counts
    const sub = p.source && typeof p.source === 'object' ? p.source.subagent : null;
    if (sub && sub.other === 'guardian') { state.kind = 'ignore'; return; }
    if (sub) {
      state.kind = 'subagent';
      state.sessionId = p.session_id || p.id;
      state.subToolId = `cx_${p.id}`;
      if (!state.startup) this.emit('subagent-event', { sessionId: state.sessionId, parentToolId: state.subToolId, event: 'SubagentStart', agent: 'codex' });
      else state.subStopped = true;  // already running at startup: don't resurrect old workers
      return;
    }
    state.kind = 'main';
    state.sessionId = p.session_id || p.id;
    if (!state.sessionId) { state.kind = 'ignore'; return; }
    if (p.cwd) state.cwd = p.cwd;
    // Announced even during the catch-up read so the pet registers the session.
    this.emit('session-event', {
      sessionId: state.sessionId, event: state.startup ? 'SessionSeen' : 'SessionStart',
      cwd: state.cwd, timestamp: state.startup ? state.mtime : Date.now(), agent: 'codex',
    });
    if (state.cwd) this.emit('session-event', { sessionId: state.sessionId, event: 'SessionCwd', cwd: state.cwd, timestamp: Date.now(), agent: 'codex' });
  }

  _setCwd(state, cwd) {
    state.cwd = cwd;
    this.emit('session-event', { sessionId: state.sessionId, event: 'SessionCwd', cwd, timestamp: Date.now(), agent: 'codex' });
  }

  _finishTurn(state, event) {
    state.pendingTools.clear();
    state.turnActive = false;
    clearTimeout(state.permissionTimer);
    state.permissionTimer = null;
    this._emitSession(state, event);
  }

  _armPermissionTimer(state) {
    if (state.pendingTools.size === 0 || state.permissionTimer) return;
    state.permissionTimer = setTimeout(() => {
      state.permissionTimer = null;
      if (state.pendingTools.size > 0) this._emitSession(state, 'PermissionRequest');
    }, PERMISSION_TIMEOUT_MS);
  }

  _armIdleTimer(state) {
    if (state.subStopped) return;
    clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => this._stopSubagent(state), SUBAGENT_IDLE_MS);
  }

  _stopSubagent(state) {
    if (state.subStopped) return;
    state.subStopped = true;
    this.emit('subagent-event', { sessionId: state.sessionId, parentToolId: state.subToolId, event: 'SubagentStop', agent: 'codex' });
    this._teardown(state);
  }
}

module.exports = { CodexWatcher, dayDirs, SESSIONS_DIR };
