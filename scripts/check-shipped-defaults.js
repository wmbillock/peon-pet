#!/usr/bin/env node
'use strict';
// Fails (exit 1) when a shipped default references a third-party or unpublished species or a sound pack. Run before publishing.
const { findViolations, collectDefaults } = require('../lib/shipped-defaults');

const bad = findViolations();
const total = collectDefaults(require('path').join(__dirname, '..')).length;
if (!bad.length) { console.log(`ok: ${total} shipped defaults checked, none reference third-party or unpublished assets`); process.exit(0); }
console.error(`FAIL: ${bad.length} shipped default(s) reference assets that must stay local:`);
for (const v of bad) console.error(`  ${v.kind} "${v.value}" in ${v.where}: ${v.why}`);
process.exit(1);
