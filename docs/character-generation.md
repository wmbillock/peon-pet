# Making a new pet

1. **Get a prompt.**
   ```bash
   node scripts/character-prompt.js --list                      # ready-made briefs
   node scripts/character-prompt.js --brief wizard-cat | pbcopy # full 6×6 atlas prompt
   node scripts/character-prompt.js --name robot --desc "A tiny retro robot ..." | pbcopy
   ```
2. **Paste it into an image model** (GPT-4o / DALL·E 3 tend to hold the grid best; Gemini often returns 8 columns).
   If you have a character reference image, attach it.
3. **If the grid is wrong**, generate one row at a time (6 prompts, `--row 1` … `--row 6`; attach the first good
   row as a reference for the rest so the character and camera stay consistent).
4. **Install it.**
   ```bash
   node scripts/import-character.js wizard-cat ~/Downloads/atlas.png
   node scripts/import-character.js wizard-cat --strips r1.png r2.png r3.png r4.png r5.png r6.png
   ```
   The importer rejects wrong-shaped images, downsizes to 1536×1536 (256px cells), and writes the dock/menu-bar icon.
5. **Pick it** in the control panel under *Pet*. It switches live.

Row order (fixed by the renderer): sleeping, waking, typing, alarmed, celebrate, annoyed — 6 frames each.
The scene is baked into the atlas, so the background must be opaque. Keep the top ~10% of each cell calm: the
session dots are drawn there.

See the [retro robot generation record](characters/retro-robot.md) for a checked-in 3072×3072 atlas, its prompt, and a nearest-neighbor resize recipe.
