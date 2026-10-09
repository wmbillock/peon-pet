'use strict';
// Read-only view of the owner's local Claude Code and Codex sessions. Nothing here starts, stops, resumes, messages or deletes a
// session, and nothing writes: the only fs calls are lstat/readdir/open(read)/read/realpath.
//   - Only files under the owner's `sessionRoots` (config.json; the model cannot write it) are read. Empty = feature off.
//   - Symlinks are never followed (a linked directory or file is skipped), and every file's realpath must stay under its root.
//   - Only user and assistant TEXT leaves this module, redacted and truncated; tool calls come back as names only, never
//     arguments or outputs, and no raw transcript line is ever returned.
// Claude Code: <root>/<encoded-cwd>/<session-id>.jsonl, one JSON record per line (type user|assistant|...; cwd, gitBranch,
// timestamp, isMeta on records; message.content is a string or blocks). Codex: <root>/YYYY/MM/DD/rollout-...-<id>.jsonl, first
// record type session_meta (payload.cwd, payload.git), turns are response_item/message with input_text/output_text blocks.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clean } = require('./redact');

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;   // a plain filename stem: no slash, dot, space or leading dash
const MAX_DEPTH = 4;
const ACTIVE_MS = 2 * 60 * 1000;
const FIRST_MESSAGE_CHARS = 200;
const TURN_CHARS = 600;
const SUMMARY_TURNS = 10;
const SUMMARY_TOOLS = 10;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const HEAD_BYTES = 256 * 1024;
const TAIL_START_BYTES = 1024 * 1024;
const TAIL_MAX_BYTES = 64 * 1024 * 1024;
const COUNT_CACHE_MAX = 200;
const OFF_MESSAGE = 'Local session visibility is off: sessionRoots in Euphonia\'s config.json is empty. The owner adds the session folders there (for example "~/.claude/projects", "~/.codex/sessions"); the app cannot change it for her.';

const WRAPPER_RE = /^\s*(?:<[A-Za-z_][\w-]*[ >]|<command-|# AGENTS\.md|Caveat:)/;   // injected context and slash-command wrappers, not what the person typed
const PREFILTER_RE = /"type"\s*:\s*"(?:user|assistant|message)"/;
const safeName = (n) => (typeof n === 'string' && /^[\w:.-]{1,64}$/.test(n) ? n : 'unknown');

// -> { role: 'user'|'assistant', text, ts } | null. Text blocks only; thinking, tool_use and tool_result never appear.
function messageOf(rec, tool) {
  if (!rec || typeof rec !== 'object') return null;
  let role = null;
  let blocks = null;
  if (tool === 'codex') {
    const p = rec.payload;
    if (rec.type !== 'response_item' || !p || p.type !== 'message' || (p.role !== 'user' && p.role !== 'assistant') || !Array.isArray(p.content)) return null;
    role = p.role;
    blocks = p.content.filter((b) => b && (b.type === 'input_text' || b.type === 'output_text') && typeof b.text === 'string').map((b) => b.text);
  } else {
    if ((rec.type !== 'user' && rec.type !== 'assistant') || rec.isMeta || rec.isSidechain || !rec.message) return null;
    if (rec.type === 'user' && rec.origin && rec.origin.kind && rec.origin.kind !== 'human') return null;
    role = rec.type;
    const c = rec.message.content;
    if (typeof c === 'string') blocks = [c];
    else if (Array.isArray(c)) blocks = c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
    else return null;
  }
  if (role === 'user') blocks = blocks.filter((t) => !WRAPPER_RE.test(t));
  const text = blocks.join('\n').trim();
  return text ? { role, text, ts: typeof rec.timestamp === 'string' ? rec.timestamp : null } : null;
}

// -> tool names used by one record (names only).
function toolsOf(rec, tool) {
  if (!rec || typeof rec !== 'object') return [];
  if (tool === 'codex') {
    const p = rec.payload;
    if (rec.type === 'response_item' && p && /_call$/.test(String(p.type)) && p.type !== 'function_call_output') return [safeName(p.name || (p.type === 'local_shell_call' ? 'shell' : null))];
    return [];
  }
  const c = rec.type === 'assistant' && !rec.isSidechain && rec.message && rec.message.content;
  return Array.isArray(c) ? c.filter((b) => b && b.type === 'tool_use').map((b) => safeName(b.name)) : [];
}

const parseLine = (l) => { try { return JSON.parse(l); } catch { return null; } };

function expandRoot(r) {
  if (typeof r !== 'string' || !r.trim()) return null;
  const s = r.trim();
  const p = s === '~' ? os.homedir() : s.startsWith('~/') ? path.join(os.homedir(), s.slice(2)) : s;
  return path.isAbsolute(p) ? p : null;
}

function createSessions({ roots = () => [], now = () => Date.now() } = {}) {
  const counts = new Map();   // file -> { size, offset, count }: appended bytes are scanned once, so a busy 60 MB transcript is not re-read every tick

  async function resolveRoots() {
    const raw = roots();
    const wanted = (Array.isArray(raw) ? raw : []).map(expandRoot).filter(Boolean);
    if (!wanted.length) throw new Error(OFF_MESSAGE);
    const real = [];
    for (const r of wanted) {
      try { const rp = await fs.promises.realpath(r); if ((await fs.promises.stat(rp)).isDirectory()) real.push(rp); } catch { /* a missing root is skipped */ }
    }
    if (!real.length) throw new Error('None of the folders in sessionRoots exist or are readable, so no sessions can be listed.');
    return [...new Set(real)];
  }

  // Every *.jsonl under a root, never following a symlink. -> [{ file, root }]
  async function walk(root, want = null) {
    const out = [];
    async function go(dir, depth) {
      let entries;
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isSymbolicLink()) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (depth < MAX_DEPTH && e.name !== 'subagents') await go(full, depth + 1); }
        else if (e.isFile() && e.name.endsWith('.jsonl') && (!want || e.name === `${want}.jsonl`)) out.push({ file: full, root });
      }
    }
    await go(root, 0);
    return out;
  }

  async function contained(file, root) {
    const rp = await fs.promises.realpath(file);
    return rp === file && rp.startsWith(root + path.sep);   // the walk saw a regular path; a swap to a link since then is refused
  }

  async function readRange(file, start, length) {
    const fh = await fs.promises.open(file, 'r');
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, start);
      return buf.subarray(0, bytesRead).toString('utf8');
    } finally { await fh.close(); }
  }

  async function head(file, size) {
    const text = await readRange(file, 0, Math.min(size, HEAD_BYTES));
    const lines = text.split('\n');
    if (size > HEAD_BYTES) lines.pop();   // the last line is cut
    let tool = 'claude', cwd = null, branch = null, started = null, first = null;
    for (const l of lines) {
      if (!l) continue;
      const rec = parseLine(l);
      if (!rec) continue;
      if (rec.type === 'session_meta' && rec.payload) {
        tool = 'codex';
        cwd = cwd || rec.payload.cwd || null;
        branch = branch || (rec.payload.git && rec.payload.git.branch) || null;
        started = started || rec.payload.timestamp || rec.timestamp || null;
      } else {
        cwd = cwd || (typeof rec.cwd === 'string' ? rec.cwd : null);
        branch = branch || (typeof rec.gitBranch === 'string' && rec.gitBranch !== 'HEAD' ? rec.gitBranch : null);
        started = started || (typeof rec.timestamp === 'string' ? rec.timestamp : null);
      }
      if (!first) { const m = messageOf(rec, tool); if (m && m.role === 'user') first = m.text; }
      if (cwd && started && first) break;
    }
    return { tool, cwd, branch, started, first };
  }

  async function countMessages(file, size, tool) {
    let c = counts.get(file);
    if (!c || size < c.offset) c = { offset: 0, count: 0 };
    if (size > c.offset) {
      let pending = '';
      let consumed = c.offset;
      let count = c.count;
      const stream = fs.createReadStream(file, { start: c.offset, end: size - 1, encoding: 'utf8' });
      for await (const chunk of stream) {
        pending += chunk;
        let nl;
        while ((nl = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, nl);
          pending = pending.slice(nl + 1);
          consumed += Buffer.byteLength(line, 'utf8') + 1;
          if (PREFILTER_RE.test(line) && messageOf(parseLine(line), tool)) count++;
        }
      }
      c = { offset: consumed, count };
    }
    if (counts.size >= COUNT_CACHE_MAX) counts.delete(counts.keys().next().value);
    counts.set(file, c);
    return c.count;
  }

  async function describe({ file, root }, stat) {
    const id = path.basename(file, '.jsonl');
    const h = await head(file, stat.size);
    const last = stat.mtimeMs;
    return {
      id, tool: h.tool, cwd: h.cwd ? clean(h.cwd, 300) : null, branch: h.branch ? clean(h.branch, 100) : null,
      started: h.started, last_activity: new Date(last).toISOString(),
      messages: await countMessages(file, stat.size, h.tool),
      state: now() - last <= ACTIVE_MS ? 'active' : 'idle',   // a guess from the file's modified time, nothing more
      first_message: h.first ? clean(h.first, FIRST_MESSAGE_CHARS) : null,
    };
  }

  // { limit, since } -> { sessions: [...], total }
  async function list(args = {}) {
    const rs = await resolveRoots();
    let limit = DEFAULT_LIMIT;
    if (args.limit !== undefined && args.limit !== null) {
      if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > MAX_LIMIT) throw new Error(`limit must be 1-${MAX_LIMIT}`);
      limit = args.limit;
    }
    let sinceMs = null;
    if (args.since !== undefined && args.since !== null && args.since !== '') {
      sinceMs = Date.parse(String(args.since));
      if (!Number.isFinite(sinceMs)) throw new Error('since must be an ISO timestamp');
    }
    const found = [];
    for (const r of rs) for (const f of await walk(r)) {
      try { const st = await fs.promises.lstat(f.file); if (st.isFile() && (sinceMs === null || st.mtimeMs >= sinceMs)) found.push({ ...f, st }); } catch { /* vanished */ }
    }
    found.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    const rows = [];
    for (const f of found.slice(0, limit)) {
      try { if (await contained(f.file, f.root)) rows.push(await describe(f, f.st)); } catch { /* unreadable or vanished: skipped */ }
    }
    return { sessions: rows, total: found.length };
  }

  // { id } -> the last turns (text only, redacted, truncated) and the last tool NAMES.
  async function summary(args = {}) {
    const id = args.id;
    if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('id is not a valid session id (a plain filename without slashes or dots)');
    const rs = await resolveRoots();
    let hit = null;
    for (const r of rs) { const f = (await walk(r, id))[0]; if (f) { hit = f; break; } }
    if (!hit) throw new Error(`No session with id ${id} under the configured sessionRoots`);
    if (!(await contained(hit.file, hit.root))) throw new Error('That session file is not inside a configured sessionRoot');
    const st = await fs.promises.stat(hit.file);
    const h = await head(hit.file, st.size);
    let window = TAIL_START_BYTES;
    let turns = [];
    let tools = [];
    for (;;) {
      const start = Math.max(0, st.size - window);
      const text = await readRange(hit.file, start, st.size - start);
      const lines = text.split('\n');
      if (start > 0) lines.shift();   // the first line is cut
      turns = []; tools = [];
      for (const l of lines) {
        if (!l) continue;
        const rec = parseLine(l);
        if (!rec) continue;
        const m = PREFILTER_RE.test(l) ? messageOf(rec, h.tool) : null;
        if (m) turns.push(m);
        tools.push(...toolsOf(rec, h.tool));
      }
      if (turns.length >= SUMMARY_TURNS || start === 0 || window >= TAIL_MAX_BYTES) break;
      window *= 4;
    }
    return {
      id, tool: h.tool, cwd: h.cwd ? clean(h.cwd, 300) : null, branch: h.branch ? clean(h.branch, 100) : null,
      last_activity: new Date(st.mtimeMs).toISOString(), state: now() - st.mtimeMs <= ACTIVE_MS ? 'active' : 'idle',
      turns: turns.slice(-SUMMARY_TURNS).map((t) => ({ role: t.role, ts: t.ts, text: clean(t.text, TURN_CHARS) })),
      recent_tools: tools.slice(-SUMMARY_TOOLS),
    };
  }

  return { list, summary };
}

module.exports = { createSessions, messageOf, toolsOf, ID_RE, OFF_MESSAGE, ACTIVE_MS };
