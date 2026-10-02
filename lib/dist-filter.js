'use strict';
// Which tracked files must stay out of a distribution: art and docs for species flagged `localOnly`
// (third-party characters), plus the Firm integration notes that reference internal systems.
const SPECIES = require('./species-defaults');

const INTERNAL = [/^docs\/firm\//, /^lib\/firm-patch\.js$/, /^scripts\/prepare-firm-patch\.js$/, /^tests\/firm-patch\.test\.js$/];

function localOnlySlugs(defaults = SPECIES) {
  const table = defaults.SPECIES_DEFAULTS || defaults.DEFAULTS || defaults;
  return Object.entries(table).filter(([, v]) => v && v.localOnly).map(([slug]) => slug);
}

// files: repo-relative paths (e.g. from `git ls-files`). → the subset to leave out.
// Environment images that belong to local-only species (listed in scripts/art-cutout-envs.json).
function localOnlyEnvFiles() {
  try {
    const m = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'scripts', 'art-cutout-envs.json'), 'utf8'));
    return (m.environments || []).filter((e) => e.localOnly).map((e) => e.path);
  } catch { return []; }
}

function excluded(files, slugs = localOnlySlugs(), envFiles = localOnlyEnvFiles()) {
  const named = (f) => slugs.some((s) => { const base = f.split('/').pop(); return base === s || base.startsWith(`${s}-`) || base.startsWith(`${s}.`); });
  return files.filter((f) => named(f) || envFiles.includes(f) || INTERNAL.some((re) => re.test(f)));
}

module.exports = { localOnlySlugs, excluded };
