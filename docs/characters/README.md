# Character sprite sheets

Open a sheet below or use the [character importer](../character-generation.md) to install it. All source sheets are opaque 3072×3072 PNGs: 6 columns × 6 rows, 512×512 cells.

| Character | Sprite sheet | Prompt and validation |
|---|---|---|
| Retro robot | [PNG](../../renderer/assets/retro-robot-sprite-atlas.png) | [Record](retro-robot.md) |
| Terra — Final Fantasy VI | [PNG](../../renderer/assets/terra-ff6-sprite-atlas.png) | [Record](terra-ff6.md) |
| Talking weeping willow | [PNG](../../renderer/assets/weeping-willow-sprite-atlas.png) | [Record](weeping-willow.md) |
| Bearded dragon | [PNG](../../renderer/assets/bearded-dragon-sprite-atlas.png) | [Record](bearded-dragon.md) |
| Clipart-style trumpet | [PNG](../../renderer/assets/clipart-trumpet-sprite-atlas.png) | [Record](clipart-trumpet.md) |
| Eighth note | [PNG](../../renderer/assets/eighth-note-sprite-atlas.png) | [Record](eighth-note.md) |
| LCD talking creature | [PNG](../../renderer/assets/lcd-creature-sprite-atlas.png) | [Record](lcd-creature.md) |

The six-character batch was generated with the built-in image tool, visually reviewed, and resized cell by cell using nearest-neighbor sampling. See [machine-readable validation](validation-2026-10-02.json).

For a new description, use `node scripts/character-prompt.js --name <name> --desc "<description>"`. These characters are also saved as named briefs; run `node scripts/character-prompt.js --list`.

If a layout edit still produces the wrong column count, use a valid six-by-six sheet as the edit target and replace only the character. This repaired the trumpet and LCD sheets; the resulting sheets share the bearded dragon room layout.
Validation: all 216 cells passed pixel comparison (56,623,104 pixels total), all six briefs emitted complete prompts, and all six existing character-generation/import tests passed.
