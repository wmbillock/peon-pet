// Runs the REAL peon.sh (a patched copy of the installed one) against fixture voice-focus.json files, with afplay stubbed on PATH,
// so no sound is ever played. Skips when peon-ping is not installed or the patch no longer applies (e.g. after an upgrade).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK_DIR = path.join(os.homedir(), '.claude', 'hooks', 'peon-ping');
const BACKUP = path.join(HOOK_DIR, 'peon.sh.bak-voice-focus');
const PATCH = path.join(__dirname, '../docs/euphonia/peon-ping-voice-focus.patch');
const live = fs.existsSync(path.join(HOOK_DIR, 'peon.sh')) ? fs.realpathSync(path.join(HOOK_DIR, 'peon.sh')) : null;

let work, script, env, playlog;
let ready = false;

beforeAll(() => {
  if (!live || !fs.existsSync(BACKUP) || !fs.existsSync(PATCH)) return;
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'pvf-'));
  // a libexec lookalike: every sibling of the installed peon.sh, plus our patched copy
  const lib = path.join(work, 'libexec');
  fs.mkdirSync(lib);
  for (const f of fs.readdirSync(path.dirname(live))) if (f !== 'peon.sh') fs.symlinkSync(path.join(path.dirname(live), f), path.join(lib, f));
  script = path.join(lib, 'peon.sh');
  fs.copyFileSync(BACKUP, script);
  const p = spawnSync('patch', [script, PATCH], { encoding: 'utf8' });
  if (p.status !== 0) return;
  fs.chmodSync(script, 0o755);
  const peon = path.join(work, 'peon');
  fs.mkdirSync(path.join(peon, 'packs/p/sounds'), { recursive: true });
  fs.writeFileSync(path.join(peon, 'packs/p/sounds/a.mp3'), 'x');
  const snd = { sounds: [{ file: 'sounds/a.mp3', label: 'a' }] };
  fs.writeFileSync(path.join(peon, 'packs/p/openpeon.json'), JSON.stringify({ cesp_version: '1.0', name: 'p', display_name: 'P', categories: { 'task.complete': snd, 'session.start': snd, 'task.acknowledge': snd } }));
  fs.writeFileSync(path.join(peon, 'config.json'), JSON.stringify({ volume: 0.5, enabled: true, default_pack: 'p', active_pack: 'p', use_sound_effects_device: false, desktop_notifications: false, categories: { 'task.complete': true, 'session.start': true, 'task.acknowledge': true } }));
  const bin = path.join(work, 'bin');
  fs.mkdirSync(bin);
  playlog = path.join(work, 'play.log');
  fs.writeFileSync(path.join(bin, 'afplay'), '#!/bin/sh\necho "$@" >> "$PLAYLOG"\n', { mode: 0o755 });
  fs.mkdirSync(path.join(work, 'home'));
  env = { PATH: `${bin}:${process.env.PATH}`, HOME: path.join(work, 'home'), CLAUDE_PEON_DIR: peon, PEON_TEST: '1', PLAYLOG: playlog, PEON_VOICE_FOCUS_FILE: path.join(work, 'voice-focus.json') };
  ready = true;
});

const ISO = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const focusFile = () => path.join(work, 'voice-focus.json');
const clear = () => { fs.rmSync(focusFile(), { force: true }); fs.writeFileSync(playlog, ''); };
function fire(sessionId) {
  fs.writeFileSync(playlog, '');
  fs.rmSync(path.join(env.CLAUDE_PEON_DIR, '.state.json'), { force: true });   // peon-ping debounces a repeated Stop for 5 s
  const r = spawnSync('bash', [script], { input: JSON.stringify({ hook_event_name: 'Stop', session_id: sessionId, cwd: '/tmp/proj' }), env, encoding: 'utf8', timeout: 90000 });
  return { played: fs.readFileSync(playlog, 'utf8').trim().length > 0, status: r.status, err: r.stderr };
}
const write = (obj, { ageMs = 0, raw } = {}) => {
  fs.writeFileSync(focusFile(), raw !== undefined ? raw : JSON.stringify(obj));
  if (ageMs) { const t = (Date.now() - ageMs) / 1000; fs.utimesSync(focusFile(), t, t); }
};
const fresh = (o = {}) => ({ mode: 'active-display', agentId: 'agent-1', sessionIds: ['S-focused', 'S-child'], updatedAt: ISO(), ...o });

const t = (name, fn) => test(name, async () => { if (!ready) { console.warn(`skipped (peon-ping or its patch unavailable): ${name}`); return; } clear(); await fn(); }, 120000);

t('baseline: no file -> the cue plays (fails open)', () => {
  expect(fire('S-other').played).toBe(true);
});
t('focused session plays', () => { write(fresh()); expect(fire('S-focused').played).toBe(true); });
t("focused agent's sub-agent session plays", () => { write(fresh()); expect(fire('S-child').played).toBe(true); });
t('non-focused session is silent', () => { write(fresh()); const r = fire('S-other'); expect(r.played).toBe(false); expect(r.status).toBe(0); });
t('focus on a pet that is no hook session (empty list): every hook session is silent', () => { write(fresh({ agentId: 'euphonia', sessionIds: [] })); expect(fire('S-other').played).toBe(false); });
t('stale file (old mtime) plays', () => { write(fresh(), { ageMs: 120000 }); expect(fire('S-other').played).toBe(true); });
t('stale updatedAt with a fresh mtime plays', () => { write(fresh({ updatedAt: ISO(120000) })); expect(fire('S-other').played).toBe(true); });
t('mode all plays', () => { write(fresh({ mode: 'all' })); expect(fire('S-other').played).toBe(true); });
t('corrupt file plays', () => { write(null, { raw: '{"mode": "active-disp' }); expect(fire('S-other').played).toBe(true); });
t('file without a session list plays', () => { const f = fresh(); delete f.sessionIds; write(f); expect(fire('S-other').played).toBe(true); });
t('unreadable shapes play', () => { write(null, { raw: '[1,2,3]' }); expect(fire('S-other').played).toBe(true); write(null, { raw: '' }); expect(fire('S-other').played).toBe(true); });
t('a hook with no session id plays', () => { write(fresh()); expect(fire('').played).toBe(true); });

test('when peon-ping and the patch are present, the patch applies cleanly (a skip here would hide a broken patch)', () => {
  if (live && fs.existsSync(BACKUP) && fs.existsSync(PATCH)) expect(ready).toBe(true);
});

test('the patch is idempotent: the marker appears exactly once and re-applying is refused', () => {
  if (!ready) return;
  expect(fs.readFileSync(script, 'utf8').split('PEON_PET_VOICE_FOCUS_V1').length - 1).toBe(1);
  const again = spawnSync('patch', ['--dry-run', '--forward', script, PATCH], { encoding: 'utf8' });
  expect(again.status).not.toBe(0);   // already applied
});
