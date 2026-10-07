const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyTool, classifyBash } = require('../lib/tool-actions');
const { diffThreads } = require('../lib/lifecycle');
const { createMonitor } = require('../lib/monitor');
const { createLedger } = require('../lib/ledger');

describe('classifyTool', () => {
  test('edits are code, tests or notes by path; reads and searches are neutral actions', () => {
    expect(classifyTool('Edit', { file_path: '/w/app/main.js' })).toBe('edit-code');
    expect(classifyTool('Write', { file_path: '/w/app/tests/a.test.js' })).toBe('write-tests');
    expect(classifyTool('Edit', { file_path: '/w/app/test_thing.py' })).toBe('write-tests');
    expect(classifyTool('Write', { file_path: '/w/docs/notes.md' })).toBe('write-notes');
    expect(classifyTool('Read', { file_path: '/x' })).toBe('read');
    expect(classifyTool('Grep', {})).toBe('search');
  });
  test('shell commands that merge, deploy, approve or test are named; ordinary ones are ignored', () => {
    expect(classifyBash('gh pr merge 12 --squash')).toBe('merge');
    expect(classifyBash('kubectl apply -f x.yaml')).toBe('deploy');
    expect(classifyBash('gh pr review 3 --approve')).toBe('approve');
    expect(classifyBash('gh pr comment 3 -b hi')).toBe('comment');
    expect(classifyBash('npx jest tests/a')).toBe('run-tests');
    expect(classifyBash('git push origin x')).toBe('edit-code');
    expect(classifyBash('ls -la')).toBeNull();
    expect(classifyTool('TodoWrite', {})).toBeNull();
    expect(classifyTool('Task', {})).toBe('spawn-agent');
  });
});

describe('diffThreads', () => {
  const t = (id, status, extra = {}) => ({ id, status, role: 'worker', title: id, ...extra });
  test('the first poll makes no events; later polls report spawns and status changes only', () => {
    expect(diffThreads(null, [t('a', 'running')])).toEqual([]);
    const ev = diffThreads([t('a', 'running'), t('b', 'idle')], [t('a', 'done'), t('b', 'idle'), t('c', 'running')]);
    expect(ev.map((e) => `${e.id}:${e.kind}`)).toEqual(['a:done', 'c:spawned', 'c:started']);
  });
});

describe('monitor', () => {
  let ledger, file;
  const worker = { slug: 'tinkerer', name: 'Tinkerer', category: 'worker', allow: [], deny: [] };
  const inspector = { slug: 'skeptic', name: 'Skeptic', category: 'inspector', allow: [], deny: [] };
  const types = { s1: worker, s2: inspector, t9: worker };
  beforeEach(() => { file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mon-')), 'l.jsonl'); ledger = createLedger({ file }); });
  const make = (extra = {}) => createMonitor({ ledger, typeOf: (id) => types[id] || null, ...extra });

  test('an out-of-role tool call is a violation with its hand-off, once per window; allowed work is not', () => {
    let t = 0; const m = make({ now: () => (t += 1000) });
    expect(m.toolUse({ sessionId: 's1', tool: 'Edit', input: { file_path: '/a/b.js' } })).toBeNull();         // a worker may edit
    expect(m.toolUse({ sessionId: 's2', tool: 'Edit', input: { file_path: '/a/b.js' } })).toMatchObject({ decision: 'delegate', action: 'edit-code' });
    expect(m.toolUse({ sessionId: 's2', tool: 'Edit', input: { file_path: '/a/c.js' } })).toBeNull();          // same action, same window: not re-logged
    expect(m.toolUse({ sessionId: 's1', tool: 'Bash', input: { command: 'gh pr merge 4' } })).toMatchObject({ action: 'merge' });
    const s = ledger.summary();
    expect(s.get('skeptic')).toMatchObject({ violations: 1, credits: 0 });
    expect(s.get('tinkerer')).toMatchObject({ violations: 1 });
    expect(s.get('skeptic').recent[0].note).toMatch(/hand to worker/);
  });

  test('your own sessions (no kind) and unknown tools are never judged', () => {
    const m = make();
    expect(m.toolUse({ sessionId: 'mine', tool: 'Edit', input: { file_path: '/a.js' } })).toBeNull();
    expect(m.toolUse({ sessionId: 's2', tool: 'SomethingNew', input: {} })).toBeNull();
    expect(ledger.summary().size).toBe(0);
  });

  test('a finished task earns its kind one credit, found by thread id or its session', () => {
    const m = make();
    m.lifecycle([{ kind: 'done', id: 't9', title: 'Add the thing' }, { kind: 'done', id: 't9', title: 'Add the thing' }, { kind: 'done', id: 'x', sessionId: 's1', title: 'Other' }]);
    expect(ledger.summary().get('tinkerer')).toMatchObject({ credits: 2, violations: 0 });
    expect(m.recent(5)).toHaveLength(3);
    expect(m.recent(5)[0].kind).toBe('done');
  });
});
