#!/usr/bin/env node
'use strict';
// Generate art from docs/art-prompts/ with Codex's built-in image tool, into a staging folder (nothing in the repo changes).
//   node scripts/gen-art-codex.js <stage-dir> env|character [slug ...] [--jobs 3]
// env:       the Environment prompt → env-<slug>.png
// character: Option A (edits the pet's current sheet, attached) → <slug>-cutout.png
// Review the results, then import them in the panel (Species & art) or copy them into renderer/assets.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const jobsAt = args.indexOf('--jobs');
const jobs = jobsAt >= 0 ? Number(args.splice(jobsAt, 2)[1]) || 3 : 3;
const [stage, kind, ...only] = args;
if (!stage || !['env', 'character'].includes(kind)) { console.error('usage: gen-art-codex.js <stage-dir> env|character [slug ...] [--jobs N]'); process.exit(2); }
fs.mkdirSync(stage, { recursive: true });

const promptDir = path.join(ROOT, 'docs', 'art-prompts');
const slugs = fs.readdirSync(promptDir).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => f.replace(/\.md$/, ''))
  .filter((s) => !only.length || only.includes(s));

const blocks = (slug) => [...fs.readFileSync(path.join(promptDir, `${slug}.md`), 'utf8').matchAll(/```text\n([\s\S]*?)```/g)].map((m) => m[1]);

function job(slug) {
  const b = blocks(slug);
  const out = kind === 'env' ? `env-${slug}.png` : `${slug}-cutout.png`;
  const text = kind === 'env' ? b[0] : b[1];
  if (!text) return Promise.resolve({ slug, ok: false, why: 'no prompt found' });
  if (fs.existsSync(path.join(stage, out))) return Promise.resolve({ slug, ok: true, why: 'already there' });
  const promptFile = `${out}.prompt.txt`;
  fs.writeFileSync(path.join(stage, promptFile), text);
  const atlas = path.join(ROOT, 'renderer', 'assets', `${slug}-sprite-atlas.png`);
  const attach = kind === 'character' && fs.existsSync(atlas) ? ['-i', atlas] : [];
  const instruction = `Use your built-in image generation tool to create ONE image following the prompt in ${promptFile} (read that file${attach.length ? '; the attached image is the existing sprite sheet it refers to' : ''}). Save the resulting PNG in this directory as ${out}. Do nothing else.`;
  return new Promise((resolve) => {
    const log = fs.createWriteStream(path.join(stage, `${out}.log`));
    const p = spawn('codex', ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-C', stage, ...attach, instruction], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.pipe(log); p.stderr.pipe(log);
    const t = setTimeout(() => p.kill(), 10 * 60 * 1000);
    p.on('close', () => { clearTimeout(t); resolve({ slug, ok: fs.existsSync(path.join(stage, out)), why: '' }); });
  });
}

(async () => {
  const queue = [...slugs];
  const results = [];
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) { const r = await job(queue.shift()); results.push(r); console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.slug} ${r.why}`); }
  }));
  console.log(`${results.filter((r) => r.ok).length}/${results.length} generated into ${stage}`);
})();
