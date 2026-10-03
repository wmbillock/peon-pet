const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('../lib/live-agents');

describe('process parsing', () => {
  const PS = `
 1611   920 22:45:59 /Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex -c x app-server
28515 27909    02:29 /Users/me/dev/the-firm/backend/.venv/lib/python3.12/site-packages/claude_agent_sdk/_bundled/claude --output-format stream-json
64823 61017 04:28:21 claude --resume libretto
 6480  1639 22:43:30 /Users/me/.local/bin/claude --settings /Users/me/.config/x.json --resume
62233 61038 04:30:15 claude --resume Euphonia
81604 61048 04:24:12 claude --resume
 4242     1 00:10 /usr/bin/python3 /Users/me/scripts/claude-notes.py
 4343     1 00:11 claude -p summarize this
`;
  test('parsePs reads pid/ppid/etime/command', () => {
    const rows = A.parsePs(PS);
    expect(rows).toHaveLength(8);
    expect(rows[2]).toMatchObject({ pid: 64823, ppid: 61017, command: 'claude --resume libretto' });
  });

  test('classifyProcess separates masters, workers, and non-agents', () => {
    expect(A.classifyProcess('claude --resume libretto')).toEqual({ agent: 'claude', role: 'master' });
    expect(A.classifyProcess('/Users/me/.local/bin/claude --settings /x.json --resume')).toEqual({ agent: 'claude', role: 'master' });
    expect(A.classifyProcess('/v/site-packages/claude_agent_sdk/_bundled/claude --output-format stream-json')).toEqual({ agent: 'claude', role: 'worker' });
    expect(A.classifyProcess('claude -p summarize this')).toEqual({ agent: 'claude', role: 'worker' });
    expect(A.classifyProcess('/usr/bin/python3 /Users/me/scripts/claude-notes.py')).toBeNull();
    expect(A.classifyProcess('/Applications/ChatGPT.app/.../codex -c x app-server')).toBeNull();
  });

  test('resumeArg returns the name, or null for a bare --resume', () => {
    expect(A.resumeArg('claude --resume Euphonia')).toBe('Euphonia');
    expect(A.resumeArg('claude --resume')).toBeNull();
    expect(A.resumeArg('claude --resume --verbose')).toBeNull();
    expect(A.resumeArg('claude --resume=abc')).toBe('abc');
    expect(A.resumeArg('claude')).toBeNull();
  });

  test('parseLsofCwd maps pids to cwds, handling spaces', () => {
    const m = A.parseLsofCwd('p6480\nfcwd\nn/Users/me/Claude/Projects/Notes and Performance\np81604\nfcwd\nn/Users/me/dev/peon-pet\n');
    expect(m.get(6480)).toBe('/Users/me/Claude/Projects/Notes and Performance');
    expect(m.get(81604)).toBe('/Users/me/dev/peon-pet');
  });

  test('scanLiveAgents combines ps + lsof via an injected runner', async () => {
    const run = async (cmd) => (cmd === 'ps' ? PS : 'p64823\nfcwd\nn/a/b\np28515\nfcwd\nn/w/c\np81604\nfcwd\nn/d\n');
    const live = await A.scanLiveAgents({ run });
    expect(live).toEqual(expect.arrayContaining([
      { pid: 64823, agent: 'claude', role: 'master', cwd: '/a/b', resume: 'libretto' },
      { pid: 28515, agent: 'claude', role: 'worker', cwd: '/w/c', resume: null },
      { pid: 81604, agent: 'claude', role: 'master', cwd: '/d', resume: null },
    ]));
    expect(live.some((p) => p.pid === 62233)).toBe(false);   // no cwd resolved → dropped
  });

  test('scanLiveAgents survives a failing ps', async () => {
    expect(await A.scanLiveAgents({ run: async () => '' })).toEqual([]);
  });
});

test('encodeProjectDir matches Claude\'s directory naming', () => {
  expect(A.encodeProjectDir('/Users/someone/Notes/Projects and Performance')).toBe('-Users-someone-Notes-Projects-and-Performance');
  expect(A.encodeProjectDir('/Users/someone/.firm/worktrees/ws_1/_base')).toBe('-Users-someone--firm-worktrees-ws-1--base');
});

describe('matchMasters', () => {
  let root;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  const cwd = '/Users/me/Notes and Performance';
  const mk = (id, ageSec, title) => {
    const dir = path.join(root, A.encodeProjectDir(cwd));
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${id}.jsonl`);
    const lines = [{ type: 'user', cwd }];
    if (title) lines.push({ type: 'custom-title', customTitle: title, sessionId: id });
    fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const t = new Date(Date.now() - ageSec * 1000);
    fs.utimesSync(f, t, t);
    return f;
  };
  const master = (pid, resume = null) => ({ pid, agent: 'claude', role: 'master', cwd, resume });

  test('a named resume claims the transcript with that title, even if it is idle for hours', () => {
    mk('active-1', 5, null);
    mk('euphonia', 3 * 3600, 'Euphonia');
    mk('libretto', 5 * 3600, 'libretto');
    const m = A.matchMasters({ procs: [master(1, 'Euphonia'), master(2, 'libretto'), master(3)], projectsDir: root });
    const byPid = Object.fromEntries(m.map((x) => [x.pid, x]));
    expect(byPid[1]).toMatchObject({ sessionId: 'euphonia', title: 'Euphonia' });
    expect(byPid[2]).toMatchObject({ sessionId: 'libretto', title: 'libretto' });
    expect(byPid[3].sessionId).toBe('active-1');   // the unnamed one takes the most recent unclaimed
  });

  test('never assigns one transcript to two processes; extra processes get nothing', () => {
    mk('only', 5, null);
    const m = A.matchMasters({ procs: [master(1), master(2)], projectsDir: root });
    expect(m).toHaveLength(1);
  });

  test('an unmatched name falls back to recency; workers and missing dirs are ignored', () => {
    mk('a', 5, null);
    const m = A.matchMasters({ procs: [master(1, 'ghost'), { pid: 9, agent: 'claude', role: 'worker', cwd, resume: null },
      { pid: 8, agent: 'claude', role: 'master', cwd: '/nowhere', resume: null }], projectsDir: root });
    expect(m.map((x) => x.sessionId)).toEqual(['a']);
  });

  test('titleOfFile prefers custom over ai titles and uses the latest', () => {
    const f = mk('t', 1, null);
    fs.appendFileSync(f, [{ type: 'ai-title', aiTitle: 'Auto one' }, { type: 'custom-title', customTitle: 'Mine' }, { type: 'ai-title', aiTitle: 'Auto two' }].map((l) => JSON.stringify(l)).join('\n') + '\n');
    expect(A.titleOfFile(f)).toEqual({ custom: 'Mine', ai: 'Auto two' });
    expect(A.titleOfFile(path.join(root, 'missing.jsonl'))).toEqual({ custom: null, ai: null });
  });
});

describe('session registry', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const put = (name, obj) => fs.writeFileSync(path.join(dir, name), typeof obj === 'string' ? obj : JSON.stringify(obj));
  const UUID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

  test('reads live sessions, classifies by entrypoint, and carries name/status', () => {
    put('100.json', { pid: 100, sessionId: UUID(1), cwd: '/a/notes', entrypoint: 'cli', name: 'ITACS 2 Master Session', nameSource: 'user', status: 'idle', startedAt: '5', updatedAt: '9' });
    put('200.json', { pid: 200, sessionId: UUID(2), cwd: '/a/firm', entrypoint: 'sdk-py', name: 'the-firm-fd', nameSource: 'derived', status: 'busy' });
    const r = A.readSessionRegistry({ dir, isAlive: () => true });
    const by = Object.fromEntries(r.map((x) => [x.pid, x]));
    expect(by[100]).toMatchObject({ role: 'master', name: 'ITACS 2 Master Session', nameSource: 'user', status: 'idle', startedAt: 5, updatedAt: 9 });
    expect(by[200]).toMatchObject({ role: 'worker', status: 'busy', entrypoint: 'sdk-py' });
  });

  test('skips dead pids, key files, garbage, bad ids, and a missing dir', () => {
    put('300.json', { pid: 300, sessionId: UUID(3), cwd: '/x', entrypoint: 'cli' });
    put('300.abcdef.key', 'secret');
    put('400.json', 'not json');
    put('500.json', { pid: 500, sessionId: 'nope', cwd: '/x', entrypoint: 'cli' });
    put('600.json', { pid: 600, sessionId: UUID(6), cwd: '/x', entrypoint: 'cli' });
    expect(A.readSessionRegistry({ dir, isAlive: (p) => p !== 600 }).map((x) => x.pid)).toEqual([300]);
    expect(A.readSessionRegistry({ dir: path.join(dir, 'nope') })).toEqual([]);
  });

  test('transcriptFor finds the transcript by encoded cwd + session id', () => {
    const proj = path.join(dir, 'projects', A.encodeProjectDir('/a/notes'));
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, `${UUID(1)}.jsonl`), '{}\n');
    expect(A.transcriptFor({ cwd: '/a/notes', sessionId: UUID(1) }, path.join(dir, 'projects'))).toBe(path.join(proj, `${UUID(1)}.jsonl`));
    expect(A.transcriptFor({ cwd: '/a/notes', sessionId: UUID(9) }, path.join(dir, 'projects'))).toBeNull();
  });

  test('pidAlive is true for this process and false for an impossible pid', () => {
    expect(A.pidAlive(process.pid)).toBe(true);
    expect(A.pidAlive(2 ** 22 + 12345)).toBe(false);
  });
});

describe('codexMasters', () => {
  const { codexMasters } = require('../lib/live-agents');
  const now = 1_000_000_000;
  test('recently written interactive sessions are masters; scripted and stale ones are not', () => {
    const mains = [
      { sessionId: 'tui', cwd: '/w/a', originator: 'codex-tui', mtime: now - 60_000 },
      { sessionId: 'app', cwd: '/w/b', originator: null, mtime: now - 10 * 60_000 },
      { sessionId: 'exec', cwd: '/w/c', originator: 'codex_exec', mtime: now - 1000 },
      { sessionId: 'old', cwd: '/w/d', originator: 'codex-tui', mtime: now - 3 * 3600_000 },
    ];
    expect(codexMasters(mains, now).map((m) => m.sessionId)).toEqual(['tui', 'app']);
  });
});
