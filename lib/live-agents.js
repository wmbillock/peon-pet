'use strict';
// Find which agent sessions are alive and which are "masters".
//
// Masters are interactive `claude` CLI processes you started (including `claude --resume <name>`).
// Workers are headless runs spawned by other software (e.g. the Agent SDK's bundled binary or
// `claude -p`). A master stays on screen while its process lives, even when its transcript has been
// quiet for hours — the transcript alone can't tell "idle" from "closed".
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// "/Users/me/.firm/x y" → "-Users-me--firm-x-y" (how Claude names its per-project transcript dirs).
const encodeProjectDir = (cwd) => String(cwd).replace(/[^a-zA-Z0-9]/g, '-');

// `ps -axo pid=,ppid=,etime=,command=` → [{ pid, ppid, command }]
function parsePs(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), etime: m[3], command: m[4] });
  }
  return out;
}

const resumeArg = (command) => {
  const m = /(?:^|\s)--resume(?:=|\s+)([^\s-][^\s]*)/.exec(command);
  return m ? m[1] : null;
};

// → null (not an agent) | { agent, role }
function classifyProcess(command) {
  const argv0 = command.trim().split(/\s+/)[0] || '';
  const base = path.basename(argv0);
  if (/claude_agent_sdk/.test(argv0) || /(^|\s)(-p|--print)(\s|$)/.test(command)) {
    return base === 'claude' || /claude_agent_sdk/.test(argv0) ? { agent: 'claude', role: 'worker' } : null;
  }
  if (base === 'claude') return { agent: 'claude', role: 'master' };
  return null;   // Codex masters and everything else: not handled yet
}

// lsof -Fpn output ("p123\nfcwd\nn/some/dir\n…") → Map(pid → cwd)
function parseLsofCwd(text) {
  const map = new Map();
  let pid = null;
  for (const line of String(text).split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid !== null && !map.has(pid)) map.set(pid, line.slice(1));
  }
  return map;
}

const defaultRun = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err && !stdout ? '' : stdout));
});

// → [{ pid, agent, role, cwd, resume }]
async function scanLiveAgents({ run = defaultRun } = {}) {
  const procs = parsePs(await run('ps', ['-axww', '-o', 'pid=,ppid=,etime=,command=']))
    .map((p) => ({ ...p, cls: classifyProcess(p.command) }))
    .filter((p) => p.cls);
  if (!procs.length) return [];
  const cwds = parseLsofCwd(await run('lsof', ['-a', '-d', 'cwd', '-p', procs.map((p) => p.pid).join(','), '-Fpn']));
  return procs
    .filter((p) => cwds.has(p.pid))
    .map((p) => ({ pid: p.pid, agent: p.cls.agent, role: p.cls.role, cwd: cwds.get(p.pid), resume: resumeArg(p.command) }));
}

// Latest session title written into a transcript: a user's /rename wins over the auto title.
function titleOfFile(file, { readFileSync = fs.readFileSync, statSync = fs.statSync } = {}) {
  let text;
  try {
    const { size } = statSync(file);
    const fd = fs.openSync(file, 'r');
    const len = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch { return { custom: null, ai: null }; }
  let custom = null, ai = null;
  for (const line of text.split('\n')) {
    if (!line.includes('-title"')) continue;
    try {
      const o = JSON.parse(line);
      if (o.type === 'custom-title' && o.customTitle) custom = o.customTitle;
      else if (o.type === 'ai-title') ai = o.aiTitle || o.title || ai;
    } catch { /* partial line at the chunk boundary */ }
  }
  return { custom, ai };
}

/**
 * Match live master processes to transcripts. Processes sharing a cwd claim that project's
 * transcripts: a `--resume <name>` process takes the transcript titled <name>; the rest take the
 * most recently active unclaimed ones.  → [{ file, sessionId, pid, title }]
 */
function matchMasters({ procs, projectsDir = path.join(os.homedir(), '.claude', 'projects'), titleOf = titleOfFile, scanLimit = 40 }) {
  const byCwd = new Map();
  for (const p of procs) if (p.agent === 'claude' && p.role === 'master') byCwd.set(p.cwd, [...(byCwd.get(p.cwd) || []), p]);
  const out = [];
  for (const [cwd, group] of byCwd) {
    const dir = path.join(projectsDir, encodeProjectDir(cwd));
    let files;
    try {
      files = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'))
        .map((n) => ({ file: path.join(dir, n), mtime: fs.statSync(path.join(dir, n)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime).slice(0, scanLimit);
    } catch { continue; }
    const claimed = new Set();
    const titles = new Map(files.map((f) => [f.file, titleOf(f.file)]));
    const claim = (proc, f) => {
      claimed.add(f.file);
      const t = titles.get(f.file) || {};
      out.push({ file: f.file, sessionId: path.basename(f.file, '.jsonl'), pid: proc.pid, title: t.custom || t.ai || null });
    };
    // Named resumes first so they get their own transcript, then everyone else by recency.
    const named = group.filter((p) => p.resume);
    const rest = group.filter((p) => !p.resume);
    for (const p of named) {
      const hit = files.find((f) => !claimed.has(f.file) && (titles.get(f.file) || {}).custom === p.resume);
      if (hit) claim(p, hit); else rest.push(p);
    }
    for (const p of rest) {
      const next = files.find((f) => !claimed.has(f.file));
      if (next) claim(p, next);
    }
  }
  return out;
}

// ---- Claude's own session registry: ~/.claude/sessions/<pid>.json -------------------------------
// One file per live session: exact session id, cwd, the name you gave it, idle/busy status, and the
// entrypoint ('cli' = a terminal session you started; 'sdk-*' = launched by other software such as
// The Firm). This is authoritative, unlike guessing from the process list.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

const roleForEntrypoint = (entrypoint) => (/^sdk/i.test(entrypoint || '') ? 'worker' : 'master');

function readSessionRegistry({ dir = path.join(os.homedir(), '.claude', 'sessions'), isAlive = pidAlive } = {}) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!/^\d+\.json$/.test(n)) continue;
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch { continue; }
    const pid = Number(d.pid);
    if (!Number.isInteger(pid) || !UUID_RE.test(String(d.sessionId || '')) || typeof d.cwd !== 'string' || !isAlive(pid)) continue;
    out.push({
      pid, sessionId: d.sessionId, cwd: d.cwd,
      name: d.name || null, nameSource: d.nameSource || null,         // 'user' = you named it
      status: d.status === 'busy' ? 'busy' : 'idle',
      entrypoint: d.entrypoint || null, kind: d.kind || null,
      role: roleForEntrypoint(d.entrypoint),
      startedAt: Number(d.startedAt) || 0, updatedAt: Number(d.updatedAt) || 0,
    });
  }
  return out;
}

// Where a registry session's transcript lives (null if it hasn't written one yet).
function transcriptFor(entry, projectsDir = path.join(os.homedir(), '.claude', 'projects')) {
  const file = path.join(projectsDir, encodeProjectDir(entry.cwd), `${entry.sessionId}.jsonl`);
  return fs.existsSync(file) ? file : null;
}

// Codex has no session registry like Claude's, so a Codex session counts as a live master while its rollout was
// written to recently — unless it was started by a script (`codex exec`), which is a worker.
// mains: CodexWatcher.getMainSessions() → [{ sessionId, cwd, mtime }] of masters still considered live.
const CODEX_LIVE_MS = 30 * 60 * 1000;
function codexMasters(mains, now = Date.now(), windowMs = CODEX_LIVE_MS) {
  return mains
    .filter((m) => now - m.mtime <= windowMs && !/exec/i.test(m.originator || ''))
    .map(({ sessionId, cwd, mtime }) => ({ sessionId, cwd, mtime }));
}

module.exports = { codexMasters, CODEX_LIVE_MS, readSessionRegistry, transcriptFor, roleForEntrypoint, pidAlive, encodeProjectDir, parsePs, classifyProcess, resumeArg, parseLsofCwd, scanLiveAgents, titleOfFile, matchMasters };
