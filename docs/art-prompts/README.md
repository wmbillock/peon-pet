# Art prompt pack

Every bundled pet currently has its scene painted into the sheet, and most share one of a few rooms. The plan here
redoes each as a **cutout character** (transparent, on a flat magenta backdrop) standing in its **own environment**,
doing something that suits it instead of typing on a laptop.

**21 images in total:** 10 environments + 10 character sheets + 1 extra animation.
🔒 = local-only (third-party character).

| # | Pet | Prompts | Environment file | Character file |
|---|-----|---------|------------------|----------------|
| 1 | Orc Peon | [orc.md](orc.md) | `env-orc.png` | `orc-cutout.png` |
| 2 | Capybara | [capybara.md](capybara.md) | `env-capybara.png` | `capybara-cutout.png` |
| 3 | Hello Kitty 🔒 | [hello-kitty.md](hello-kitty.md) | `env-hello-kitty.png` | `hello-kitty-cutout.png` |
| 4 | Retro Robot | [retro-robot.md](retro-robot.md) | `env-retro-robot.png` | `retro-robot-cutout.png` |
| 5 | Terra (FFVI) 🔒 | [terra-ff6.md](terra-ff6.md) | `env-terra-ff6.png` | `terra-ff6-cutout.png` |
| 6 | Weeping Willow | [weeping-willow.md](weeping-willow.md) | `env-weeping-willow.png` | `weeping-willow-cutout.png` |
| 7 | Beardie | [bearded-dragon.md](bearded-dragon.md) | `env-bearded-dragon.png` | `bearded-dragon-cutout.png`, `wave` |
| 8 | Trumpet | [clipart-trumpet.md](clipart-trumpet.md) | `env-clipart-trumpet.png` | `clipart-trumpet-cutout.png` |
| 9 | Eighth Note | [eighth-note.md](eighth-note.md) | `env-eighth-note.png` | `eighth-note-cutout.png` |
| 10 | LCD Pal | [lcd-creature.md](lcd-creature.md) | `env-lcd-creature.png` | `lcd-creature-cutout.png` |

## Using the ChatGPT desktop app

1. **One image per chat.** Start a fresh chat for each; long threads drift.
2. **Environment:** paste the prompt, no attachment. Ask for a *square* image. Save with the file name shown.
3. **Character:** attach the pet's current sheet (`renderer/assets/<slug>-sprite-atlas.png`) and paste *Option A*. Editing a sheet
   that already has the right grid is much more reliable than asking for a grid from nothing.
4. **Check it** before saving: 6 columns × 6 rows, character in the same place in every cell, background flat magenta.
   If it's wrong, use the follow-ups in each file rather than starting over.
5. **Extras** (waves etc.) are a *3×2 grid* because ChatGPT can't make a 6:1 strip.
6. **Import** in the panel (*Species & art*). The importer rejects wrong-shaped images and tells you why.

ChatGPT can't produce exact pixel sizes, so these prompts ask for a square 6×6 grid and let the importer scale.
The cells will be ~170–250px, which is plenty for a 200px window and the 64px Pixoo.

## Other ways to run this

- **Codex** (installed here) has a built-in image tool and produced the last batch. Give it `docs/art-prompts/` and ask it
  to generate each file into a staging folder.
- **OpenAI image API** with your key: a short script can generate all 21 in one go.

Regenerate this pack after editing `scripts/art-plan.json`: `node scripts/export-art-prompts.js`.
