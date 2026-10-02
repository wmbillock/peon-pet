#!/usr/bin/env node
// Install a generated sprite atlas as a new pet.
//   node scripts/import-character.js <name> <atlas.png>
//   node scripts/import-character.js <name> --strips r1.png r2.png r3.png r4.png r5.png r6.png
const os = require('os');
const path = require('path');
const { importCharacter } = require('../lib/character-import');

const [name, ...rest] = process.argv.slice(2);
const destRoot = process.env.PEON_PET_CHARACTERS
  || path.join(os.homedir(), 'Library', 'Application Support', 'Peon Pet', 'characters');

const usage = 'Usage: import-character.js <name> <atlas.png>  |  <name> --strips <6 row images in order>';
if (!name || !rest.length) { console.error(usage); process.exit(1); }

const opts = rest[0] === '--strips' ? { strips: rest.slice(1).map((p) => path.resolve(p)) } : { atlas: path.resolve(rest[0]) };

importCharacter({ name, destRoot, ...opts })
  .then(({ dir, size, cell, warnings }) => {
    warnings.forEach((w) => console.warn(`warning: ${w}`));
    console.log(`Installed "${name}" → ${dir}  (${size}×${size}, ${cell}px cells)`);
    console.log('Open the control panel and click it under "Pet" (reopen the panel if it was already open).');
  })
  .catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
