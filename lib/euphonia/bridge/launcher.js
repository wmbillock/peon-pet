'use strict';
// claude_run_brief: start a Claude Code session on a brief Euphonia wrote, after the user clicked an approval card.
// Everything that matters is enforced HERE, not in the prompt:
//   - the brief must be a .md file that really lives inside Euphonia's own kb (realpath, so no `..` and no symlink out);
//   - the working directory must be on `claudeRunRepos` in config.json (empty = the feature is off). Only the owner edits that list;
//     it is not reachable through setConfig, and her file tools cannot write config.json;
//   - the prompt is fixed by the app (`Read <brief>. Do it. Stop before pushing.`): she supplies a path and a repo, nothing else, and no
//     flags, tools or environment;
//   - the session is started with no permission-widening flag: `claude -p <prompt> --session-id <uuid> --output-format stream-json
//     --verbose` in the repo. Print mode cannot ask anyone, so any tool the user's own settings do not already allow is denied, which
//     is the safe direction;
//   - one session per directory, counting `claude` processes this app did not start (found by ps + lsof cwd), and at most
//     MAX_LAUNCHED running at once.
// A session this app started is tracked until its process exits; the card records how it ended.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MAX_LAUNCHED = 2;            // launched sessions running at once
const BRIEF_HEAD_CHARS = 500;      // how much of the brief the card shows
const PATH_RE = /^[A-Za-z0-9._\/ @+=,:-]+$/;   // the path goes into the prompt text, so no quotes, newlines or shell/markup characters
const CLAUDE_CMD_RE = /(^|\/)claude(\s|$)/;
const promptFor = (briefPath) => `Read ${briefPath}. Do it. Stop before pushing.`;

const realDir = (p) => { try { const r = fs.realpathSync(p); return fs.statSync(r).isDirectory() ? r : null; } catch { return null; } };

// Every running `claude` process and its working directory, from the OS. Throws if it cannot be read (the caller then refuses).
function systemProcs() {
  const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
  const procs = [];
  for (const l of out.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(l);
    if (!m || !CLAUDE_CMD_RE.test(m[2].split(/\s+-/)[0] + ' ')) continue;
    let cwd = null;
    try { const o = execFileSync('lsof', ['-a', '-d', 'cwd', '-p', m[1], '-Fn'], { encoding: 'utf8', timeout: 5000 }); const n = o.split('\n').find((x) => x.startsWith('n')); cwd = n ? n.slice(1) : null; } catch { /* gone, or not readable */ }
    procs.push({ pid: Number(m[1]), command: m[2].slice(0, 120), cwd });
  }
  return procs;
}
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function createLauncher({ kbDir, repos = () => [], spawnImpl, resolveBin = () => 'claude', env = () => process.env, listProcs = systemProcs, alive = pidAlive, now = () => Date.now(), maxLaunched = MAX_LAUNCHED }) {
  const listeners = new Set();   // called once per launched session when its process ends
  const running = new Map();   // launch_id -> { launch_id, session_id, pid, repo, path, started_at, child }

  const allowed = () => { const l = repos(); return Array.isArray(l) ? l.filter((r) => typeof r === 'string' && r.trim()).map(realDir).filter(Boolean) : []; };

  // → { brief, repo } as real paths, or throws with the reason in plain words. No side effects.
  function validate(args) {
    const a = args && typeof args === 'object' ? args : {};
    const extra = Object.keys(a).filter((k) => k !== 'path' && k !== 'repo');
    if (extra.length) throw new Error(`Only path and repo are accepted (not ${extra.slice(0, 3).join(', ')}): the prompt, flags and environment are fixed by the app.`);
    const list = Array.isArray(repos()) ? repos().filter((r) => typeof r === 'string' && r.trim()) : [];
    if (!list.length) throw new Error('Starting Claude Code sessions is off: claudeRunRepos in Euphonia\'s config.json is empty. Only the owner can add a repository there; Euphonia cannot. Nothing was started.');
    if (typeof a.path !== 'string' || !a.path.trim() || a.path.length > 400) throw new Error('path is required: the brief file, inside your kb, ending in .md.');
    if (typeof a.repo !== 'string' || !a.repo.trim() || a.repo.length > 400) throw new Error('repo is required: the working directory for the session.');
    if (a.path.split('/').includes('..')) throw new Error('path must not contain "..".');
    let kb;
    try { kb = fs.realpathSync(kbDir); } catch { throw new Error('The kb directory is not available.'); }
    let brief;
    try { brief = fs.realpathSync(path.resolve(kb, a.path)); } catch { throw new Error(`The brief does not exist: ${a.path.slice(0, 120)}`); }
    if (!(brief === kb || brief.startsWith(kb + path.sep))) throw new Error('The brief must be inside your kb (a path or symlink that leaves it is refused).');
    if (!/\.md$/i.test(brief)) throw new Error('The brief must be a .md file.');
    if (!fs.statSync(brief).isFile()) throw new Error('The brief is not a file.');
    if (!PATH_RE.test(brief) || brief.startsWith('-')) throw new Error('The brief path has characters that are not allowed in the fixed prompt (use letters, digits, . _ - / and spaces).');
    const repo = realDir(a.repo);
    if (!repo) throw new Error(`repo is not a directory: ${a.repo.slice(0, 120)}`);
    if (!allowed().includes(repo)) throw new Error(`${repo} is not on the owner's claudeRunRepos list in config.json. Only the owner adds a repository; Euphonia cannot.`);
    return { brief, repo };
  }
  const fingerprint = (args) => { const { brief, repo } = validate(args); return `${repo}\n${brief}\n${crypto.createHash('sha256').update(fs.readFileSync(brief)).digest('hex')}`; };   // the card remembers this; a click on changed content is refused
  function describe(args) {
    const { brief, repo } = validate(args);
    let head = '';
    try { head = fs.readFileSync(brief, 'utf8').slice(0, BRIEF_HEAD_CHARS).trim(); } catch { /* shown empty */ }
    return {
      destination: `Claude Code session in ${repo} (runs on this machine)`,
      text: `Working directory: ${repo}\nBrief: ${brief}\nPrompt that will run, fixed by the app:\n  ${promptFor(brief)}\nNo extra flags, tools or permissions. It starts, and keeps running, until it ends on its own.\n\nThe brief begins:\n${head}${fs.statSync(brief).size > BRIEF_HEAD_CHARS ? '\n[...]' : ''}`,
    };
  }

  // Start the session. Re-checks everything, because the click can come minutes after the card.
  async function launch(args) {
    const { brief, repo } = validate(args);
    if (running.size >= maxLaunched) throw new Error(`${running.size} launched sessions are already running (the limit is ${maxLaunched}): ${[...running.values()].map((r) => `${r.session_id} in ${r.repo}`).join('; ')}. Nothing was started.`);
    const mine = [...running.values()].find((r) => r.repo === repo);
    if (mine) throw new Error(`A session started from here is already running in ${repo} (session ${mine.session_id}, pid ${mine.pid}). Nothing was started.`);
    let procs;
    try { procs = listProcs(); } catch (e) { throw new Error(`Could not check which claude sessions are running (${String(e.message || e).slice(0, 120)}), so nothing was started.`); }
    const other = procs.find((p) => p.cwd && (p.cwd === repo || p.cwd.startsWith(repo + path.sep)));
    if (other) throw new Error(`A claude session is already running in ${repo} (pid ${other.pid}: ${other.command}). Nothing was started.`);
    const bin = resolveBin();
    const session_id = crypto.randomUUID();
    const prompt = promptFor(brief);
    const argv = ['-p', prompt, '--session-id', session_id, '--output-format', 'stream-json', '--verbose'];
    const child = spawnImpl(bin, argv, { cwd: repo, env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
    const rec = { launch_id: crypto.randomBytes(5).toString('hex'), session_id, pid: child.pid || null, repo, path: brief, started_at: new Date(now()).toISOString(), child };
    running.set(rec.launch_id, rec);
    let tail = '';
    if (child.stdout) child.stdout.on('data', () => {});   // drained, never kept: progress is read through sessions_get_summary
    if (child.stderr) child.stderr.on('data', (d) => { tail = (tail + d).slice(-500); });
    let ended = false;
    const end = (code, signal, error) => {
      if (ended) return; ended = true;
      running.delete(rec.launch_id);
      for (const fn of [...listeners]) { try { fn({ launch_id: rec.launch_id, session_id, code: code == null ? null : code, signal: signal || null, error: error ? String(error.message || error) : null, stderr: tail.trim() }); } catch { /* a bad listener must not block the others */ } }
    };
    child.on('error', (e) => end(null, null, e));
    child.on('close', (code, signal) => end(code, signal));
    return { launched: true, launch_id: rec.launch_id, session_id, pid: rec.pid, started_at: rec.started_at, repo, path: brief, prompt };
  }

  return {
    validate, fingerprint, describe, launch,
    onEnd: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    running: () => [...running.values()].map(({ child, ...r }) => r),
    // A launched session's card may say "running" only while a process is behind it: one this app holds, or a pid still alive.
    isLive: (session) => !!(session && (running.has(session.launch_id) || (session.pid && alive(session.pid)))),
  };
}

module.exports = { createLauncher, MAX_LAUNCHED, BRIEF_HEAD_CHARS, promptFor, systemProcs };
