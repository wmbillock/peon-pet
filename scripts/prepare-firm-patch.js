#!/usr/bin/env node
// Build a patch that adds Peon Pet's feature requests to The Firm's ROADMAP.md and swarm/TASKS.md,
// against the *current* develop, and check that it applies. Read-only: it never touches a working
// tree, branch or remote (the apply check uses a throwaway index).
//
//   node scripts/prepare-firm-patch.js [--repo ~/dev/affirm-builders] [--ref origin/pricing/the-firm/develop]
//   → docs/firm/firm-pr.patch
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { parseEntries, parseTaskRows, maxTaskId, insertRoadmapEntries, appendTaskRows } = require('../lib/firm-patch');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const repo = arg('--repo', path.join(os.homedir(), 'dev', 'affirm-builders'));
const ref = arg('--ref', 'origin/pricing/the-firm/develop');
const OUT = path.join(__dirname, '..', 'docs', 'firm', 'firm-pr.patch');
const ROADMAP = 'projects/the-firm/ROADMAP.md';
const TASKS = 'projects/the-firm/swarm/TASKS.md';
const CLAIMS = 'projects/the-firm/swarm/claims/';

const git = (args, env = {}) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

const requests = fs.readFileSync(path.join(__dirname, '..', 'docs', 'firm', 'ROADMAP-entries.md'), 'utf8');
const baseSha = git(['rev-parse', '--short=10', ref]).trim();
const roadmap = git(['show', `${ref}:${ROADMAP}`]);
const tasks = git(['show', `${ref}:${TASKS}`]);
const claims = git(['ls-tree', '--name-only', ref, CLAIMS]);

const newRoadmap = insertRoadmapEntries(roadmap, parseEntries(requests));
const tasked = appendTaskRows(tasks, parseTaskRows(requests), maxTaskId(tasks, claims));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'firm-patch-'));
let patch = '';
for (const [file, before, after] of [[ROADMAP, roadmap, newRoadmap], [TASKS, tasks, tasked.text]]) {
  if (before === after) continue;
  const a = path.join(tmp, 'a'), b = path.join(tmp, 'b');
  fs.writeFileSync(a, before); fs.writeFileSync(b, after);
  const d = spawnSync('diff', ['-u', '-L', `a/${file}`, '-L', `b/${file}`, a, b], { encoding: 'utf8' });
  if (d.status === 2) throw new Error(`diff failed: ${d.stderr}`);
  patch += d.stdout;
}
if (!patch) { console.log('Nothing to add: The Firm already has every entry.'); process.exit(0); }
fs.writeFileSync(OUT, patch);

// Does it apply to that ref? Check against a throwaway index, not the working tree.
const index = path.join(tmp, 'index');
git(['read-tree', ref], { GIT_INDEX_FILE: index });
const chk = spawnSync('git', ['-C', repo, 'apply', '--cached', '--check', OUT], { encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: index } });
fs.rmSync(tmp, { recursive: true, force: true });
if (chk.status !== 0) { console.error(`Patch does NOT apply to ${ref}:\n${chk.stderr}`); process.exit(1); }

const adds = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
console.log(`Wrote ${path.relative(process.cwd(), OUT)} against ${ref} @ ${baseSha}`);
console.log(`  ROADMAP.md: ${parseEntries(requests).length} entries at the top of "## Next"`);
console.log(`  TASKS.md:   ${tasked.added.length} rows (${tasked.added.map((r) => r.slice(2, 8)).join(', ')})`);
console.log(`  ${adds} added lines; applies cleanly (checked against a throwaway index)`);
