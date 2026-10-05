const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildToolPolicy, isAllowed } = require('../lib/euphonia/authority');
const { seedKb } = require('../lib/euphonia/kb');
const { pickCue } = require('../lib/euphonia/voice');
const approvals = require('../lib/euphonia/approvals');
const { createStreamParser } = require('../lib/euphonia/stream');

const hubDir = '/Users/x/Claude';
const kbDir = '/Users/x/.euphonia/x/kb';
const policy = buildToolPolicy({ hubDir, kbDir });

test('hub path write is denied, kb path write is allowed, hub read is allowed', () => {
  const ctx = { hubDir, kbDir };
  expect(isAllowed(policy, 'Write', `${hubDir}/HOME.md`, ctx)).toBe(false);
  expect(isAllowed(policy, 'Edit', `${hubDir}/Projects/a.md`, ctx)).toBe(false);
  expect(isAllowed(policy, 'Write', `${kbDir}/log.md`, ctx)).toBe(true);
  expect(isAllowed(policy, 'Edit', `${kbDir}/sub/page.md`, ctx)).toBe(true);
  expect(isAllowed(policy, 'Read', `${hubDir}/HOME.md`, ctx)).toBe(true);
  expect(isAllowed(policy, 'Write', `${kbDir}/../config.json`, ctx)).toBe(false);   // traversal out of kb
  expect(isAllowed(policy, 'Write', '/Users/x/.euphonia/x/kb-evil/a.md', ctx)).toBe(false);   // prefix trick
  expect(isAllowed(policy, 'Bash', `${kbDir}/a`, ctx)).toBe(false);
});

test('rule strings: writes scoped to kb, hub write denies, no shell or network', () => {
  expect(policy.allowedTools).toEqual(['Read', 'Grep', 'Glob', `Edit(/${kbDir}/**)`, `Write(/${kbDir}/**)`]);
  expect(policy.disallowedTools).toEqual(expect.arrayContaining([`Edit(/${hubDir}/**)`, `Write(/${hubDir}/**)`, 'Bash', 'WebFetch', 'WebSearch', 'mcp__*']));
  expect(policy.allowedTools.join()).not.toMatch(/Bash|Web|mcp/);
  expect(policy.tools).toEqual(['Read', 'Grep', 'Glob', 'Edit', 'Write']);
  expect(policy.addDirs).toEqual([hubDir]);
  expect(policy.permissionMode).toBe('dontAsk');
});

test('kb seeding is idempotent and never overwrites', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-')) + '/kb';
  expect(seedKb(dir, { user: 'w' }).sort()).toEqual(['INDEX.md', 'identity.md', 'log.md']);
  fs.writeFileSync(path.join(dir, 'identity.md'), 'MINE');
  fs.appendFileSync(path.join(dir, 'log.md'), '\n- learned a thing\n');
  const log = fs.readFileSync(path.join(dir, 'log.md'), 'utf8');
  expect(seedKb(dir, { user: 'w' })).toEqual([]);
  expect(fs.readFileSync(path.join(dir, 'identity.md'), 'utf8')).toBe('MINE');
  expect(fs.readFileSync(path.join(dir, 'log.md'), 'utf8')).toBe(log);
  fs.rmSync(path.join(dir, 'INDEX.md'));
  expect(seedKb(dir, { user: 'w' })).toEqual(['INDEX.md']);   // only what is missing
});

test('approvals seam always says not granted', () => {
  expect(approvals.isGranted('hub.write', { origin: 'agent' }).granted).toBe(false);
  expect(approvals.isGranted('hub.write', { origin: 'user' }).granted).toBe(false);
});

test('voice cue prefers task.complete and never leaves the pack dir', () => {
  const peon = fs.mkdtempSync(path.join(os.tmpdir(), 'peon-'));
  const pk = path.join(peon, 'packs', 'p'); fs.mkdirSync(path.join(pk, 'sounds'), { recursive: true });
  fs.writeFileSync(path.join(pk, 'sounds', 'done.mp3'), 'x');
  fs.writeFileSync(path.join(pk, 'sounds', 'hi.mp3'), 'x');
  fs.writeFileSync(path.join(peon, 'secret.mp3'), 'x');
  fs.writeFileSync(path.join(pk, 'openpeon.json'), JSON.stringify({ categories: {
    'session.start': { sounds: [{ file: 'hi.mp3' }] },
    'task.complete': { sounds: [{ file: '../../secret.mp3' }, { file: 'done.mp3' }] },
  } }));
  expect(pickCue('p', peon)).toBe(path.join(pk, 'sounds', 'done.mp3'));
  expect(pickCue('../p', peon)).toBeNull();
  expect(pickCue('missing', peon)).toBeNull();
});

test('stream parser falls back to whole assistant text when no partials arrive', () => {
  const out = [];
  const p = createStreamParser((e) => out.push(e));
  p.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'whole' }] } }) + '\nnot json\n');
  p.end();
  expect(out).toEqual([{ kind: 'delta', text: 'whole' }]);
});

test('MCP tools are neither allowed nor available, and are denied by name', () => {
  const mcp = 'mcp__slack__slack_send_message';
  expect(policy.tools).not.toContain(mcp);
  expect(policy.allowedTools).not.toContain(mcp);
  expect(policy.allowedTools.some((r) => r.startsWith('mcp__'))).toBe(false);
  expect(policy.disallowedTools).toContain('mcp__*');
  expect(policy.permissionMode).toBe('dontAsk');   // anything not allowed is denied, so an MCP call has no path
  expect(isAllowed(policy, mcp, '/x', { hubDir, kbDir })).toBe(false);
});
