#!/usr/bin/env node
// Write the paste-ready prompt pack for the planned art redo into docs/art-prompts/.
//   node scripts/export-art-prompts.js
const fs = require('fs');
const path = require('path');
const gen = require('../lib/character-gen');
const DEFAULTS = require('../lib/species-defaults');
const briefs = require('./character-briefs.json');
const plan = require('./art-plan.json');

const OUT = path.join(__dirname, '../docs/art-prompts');
const own = (o, k) => Object.hasOwn(o, k);
const fence = (text) => '```text\n' + text.trim() + '\n```';

const description = (entry) => entry.look || (own(briefs, entry.slug) ? briefs[entry.slug] : DEFAULTS[entry.slug].brief);
const envFile = (slug) => `env-${slug}.png`;
const sheetFile = (slug) => `${slug}-cutout.png`;

function speciesDoc(entry) {
  const slug = entry.slug;
  const d = DEFAULTS[slug];
  const desc = description(entry);
  const spec = { name: slug, description: desc, activity: entry.activity, scene: entry.scene, setting: 'free', layout: 'cutout' };

  const lines = [];
  lines.push(`# ${d.display} (\`${slug}\`)`);
  if (entry.localOnly) lines.push('', '> **Local only** — third-party character. Keep this out of anything you distribute.');
  lines.push('', `**Doing:** ${entry.activity}`, '', `**Where:** ${entry.scene}`, '');

  lines.push('## 1 · Environment', '',
    `Square (1:1) image. New chat, no attachment. Save as \`${envFile(slug)}\`.`, '',
    fence(gen.buildEnvironPrompt({ name: entry.env.name, description: entry.env.description })), '',
    `Import: **Species & art** tab → *Environments* → name it \`${entry.env.name}\`, paste the description, *Import image…*.`, '');

  lines.push('## 2 · Character (cutout on magenta)', '',
    '### Option A — edit the existing sheet (recommended)', '',
    `Attach \`renderer/assets/${slug}-sprite-atlas.png\`. The grid is already valid, so the model only has to redraw the character and swap the background. Save as \`${sheetFile(slug)}\`.`, '',
    fence(gen.buildEditPrompt({ name: slug, description: desc, activity: entry.activity, scene: entry.scene, setting: 'free', props: entry.props && entry.props !== 'none' ? entry.props : '' })), '',
    '### Option B — from scratch', '',
    'Use if Option A drifts from the character. Attach the sheet above only as a *reference* and say “use it for the character design only”.', '',
    fence(gen.buildAtlasPrompt(spec)), '',
    '### If the grid comes out wrong', '',
    '- Reply: “Keep exactly 6 columns × 6 rows of equal square cells; do not add or drop columns or rows. Same character position in every cell.”',
    '- Or generate **one row at a time** (square-ish images are fine; 6 frames per row) — the *Row 1…6* buttons in the panel build those prompts.', '');

  lines.push('## 3 · Import', '',
    `1. **Species & art** → *${d.display}* → tick *Backdrop is magenta #FF00FF* → *Replace sheet…* → pick \`${sheetFile(slug)}\`.`,
    `2. Set *Sheet type* to **Cutout**, *Activity* to the line above, *Setting* to **Free-form**, and *Environment* to **${entry.env.name}**.`,
    '3. *Show contact sheet* to check all six rows; the magenta should be gone.',
    '4. Undo any time: delete the folder `~/Library/Application Support/Peon Pet/characters/' + slug + '/` to fall back to the bundled art.', '');

  for (const x of entry.extras || []) {
    lines.push(`## Extra · ${x.name}`, '',
      `A 3 columns × 2 rows grid, landscape (3:2). Attach the finished \`${sheetFile(slug)}\` as a reference. Save as \`${slug}-${x.name}.png\`.`, '',
      fence(gen.buildExtraPrompt({ ...spec, name: x.name, action: x.action })), '',
      `Import: *Extra animations* → name \`${x.name}\` → tick the magenta box → *Import strip…* → choose when it plays (e.g. “a session starts”).`, '');
  }
  if (slug === 'bearded-dragon') {
    lines.push('## Head bob (procedural)', '',
      'The bundled bob was cut from the old baked art. After replacing the sheet, regenerate it from the new one:', '',
      '```bash\nnode scripts/gen-headbob.js bearded-dragon --custom\n```', '',
      'If the head moves oddly, adjust the region (centre x, centre y, softness as fractions of the cell): `--region 0.5,0.42,0.12`.', '');
  }
  return lines.join('\n');
}

function readme() {
  const rows = plan.species.map((e, i) => {
    const d = DEFAULTS[e.slug];
    const extra = (e.extras || []).map((x) => `, \`${x.name}\``).join('');
    return `| ${i + 1} | ${d.display}${e.localOnly ? ' 🔒' : ''} | [${e.slug}.md](${e.slug}.md) | \`${envFile(e.slug)}\` | \`${sheetFile(e.slug)}\`${extra ? `${extra}` : ''} |`;
  }).join('\n');
  const jobs = plan.species.length * 2 + plan.species.reduce((n, e) => n + (e.extras || []).length, 0);
  return `# Art prompt pack

Every bundled pet currently has its scene painted into the sheet, and most share one of a few rooms. The plan here
redoes each as a **cutout character** (transparent, on a flat magenta backdrop) standing in its **own environment**,
doing something that suits it instead of typing on a laptop.

**${jobs} images in total:** ${plan.species.length} environments + ${plan.species.length} character sheets + ${jobs - plan.species.length * 2} extra animation.
🔒 = local-only (third-party character).

| # | Pet | Prompts | Environment file | Character file |
|---|-----|---------|------------------|----------------|
${rows}

## Using the ChatGPT desktop app

1. **One image per chat.** Start a fresh chat for each; long threads drift.
2. **Environment:** paste the prompt, no attachment. Ask for a *square* image. Save with the file name shown.
3. **Character:** attach the pet's current sheet (\`renderer/assets/<slug>-sprite-atlas.png\`) and paste *Option A*. Editing a sheet
   that already has the right grid is much more reliable than asking for a grid from nothing.
4. **Check it** before saving: 6 columns × 6 rows, character in the same place in every cell, background flat magenta.
   If it's wrong, use the follow-ups in each file rather than starting over.
5. **Extras** (waves etc.) are a *3×2 grid* because ChatGPT can't make a 6:1 strip.
6. **Import** in the panel (*Species & art*). The importer rejects wrong-shaped images and tells you why.

ChatGPT can't produce exact pixel sizes, so these prompts ask for a square 6×6 grid and let the importer scale.
The cells will be ~170–250px, which is plenty for a 200px window and the 64px Pixoo.

## Other ways to run this

- **Codex** (installed here) has a built-in image tool and produced the last batch. Give it \`docs/art-prompts/\` and ask it
  to generate each file into a staging folder.
- **OpenAI image API** with your key: a short script can generate all ${jobs} in one go.

Regenerate this pack after editing \`scripts/art-plan.json\`: \`node scripts/export-art-prompts.js\`.
`;
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'README.md'), readme());
for (const e of plan.species) fs.writeFileSync(path.join(OUT, `${e.slug}.md`), speciesDoc(e));
console.log(`wrote ${plan.species.length + 1} files to ${path.relative(process.cwd(), OUT)}/`);
