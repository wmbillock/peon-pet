#!/usr/bin/env node
'use strict';
// Copy the tracked tree to <outdir>, leaving out local-only species art and internal Firm notes.
//   node scripts/make-dist.js /tmp/peon-pet-dist [--dry]
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { excluded } = require('../lib/dist-filter');

const root = path.join(__dirname, '..');
const out = process.argv[2];
const dry = process.argv.includes('--dry');
if (!out) { console.error('usage: make-dist.js <outdir> [--dry]'); process.exit(2); }

const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const skip = new Set(excluded(files));
for (const f of files) {
  if (skip.has(f) || !fs.existsSync(path.join(root, f))) continue;
  if (!dry) { fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true }); fs.copyFileSync(path.join(root, f), path.join(out, f)); }
}
console.log(`${dry ? 'would copy' : 'copied'} ${files.length - skip.size} files; left out ${skip.size}:`);
for (const f of skip) console.log(`  ${f}`);
