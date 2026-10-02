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
function excluded(files, slugs = localOnlySlugs()) {
  const named = (f) => slugs.some((s) => { const base = f.split('/').pop(); return base === s || base.startsWith(`${s}-`) || base.startsWith(`${s}.`); });
  return files.filter((f) => named(f) || INTERNAL.some((re) => re.test(f)));
}

module.exports = { localOnlySlugs, excluded };
