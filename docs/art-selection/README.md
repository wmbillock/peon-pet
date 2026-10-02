# Sprite and background selection

Open [the local preview](preview.html) to inspect the generated sprites on each background at 200px. The preview requires the PNGs from the local asset bundle.

## Package

The public PR contains definitions, prompts, a preview, and validation receipts. The PNGs stay local. The catalog has 10 themed species definitions: 9 have generated art; R2-D2 remains a draft without art. There are 4 generated environments, including the requested performance stage.

| Theme | Species | Local art | Suggested background |
|---|---|---|---|
| The Big Lebowski | The Dude | [PNG](../../renderer/assets/the-dude-sprite-atlas.png) | rug-lounge |
| Star Wars | R2-D2 | Draft; no PNG | starship-bridge |
| Star Trek | Spock | [PNG](../../renderer/assets/spock-sprite-atlas.png) | starship-bridge |
| Battlestar Galactica | Classic Cylon | [PNG](../../renderer/assets/classic-cylon-sprite-atlas.png) | starship-bridge |
| The Hitchhiker's Guide to the Galaxy | Marvin | [PNG](../../renderer/assets/marvin-sprite-atlas.png) | starship-bridge |
| Brass instruments | French horn | [PNG](../../renderer/assets/french-horn-sprite-atlas.png) | performance-stage |
| Music notes | Sixteenth note | [PNG](../../renderer/assets/sixteenth-note-sprite-atlas.png) | performance-stage |
| Bearded dragons | Red bearded dragon | [PNG](../../renderer/assets/red-bearded-dragon-sprite-atlas.png) | desert-terrarium |
| Ball pythons | Banana ball python | [PNG](../../renderer/assets/banana-ball-python-sprite-atlas.png) | desert-terrarium |
| Video games | Kirby | [PNG](../../renderer/assets/kirby-sprite-atlas.png) | rug-lounge |

| Environment | Local image |
|---|---|
| Performance stage | [PNG](../../renderer/assets/env-performance-stage.png) |
| Starship bridge | [PNG](../../renderer/assets/env-starship-bridge.png) |
| Rug lounge | [PNG](../../renderer/assets/env-rug-lounge.png) |
| Desert terrarium | [PNG](../../renderer/assets/env-desert-terrarium.png) |

## Integration handoff

1. Read `scripts/art-selection.json`. Treat `atlas` and `icon` as paths inside the local asset bundle. Do not register the R2-D2 draft as a ready species.
2. Copy the PNGs from the local bundle into the matching `renderer/assets/` paths. Preserve their alpha channels; no chroma key is needed.
3. Add ready species to `lib/bundled-characters.js` and `lib/species-defaults.js` using the manifest fields. Use `layout: cutout`, `setting: free`, and the supplied `defaultEnv`.
4. Register the four environments with `createEnvironStore` in `lib/pets-service.js`. Existing user overrides and pet selection should remain intact.
5. Verify the six animation rows in the local preview and then in the app before selecting a new pet. Preserve the existing `localOnly` convention from the species metadata.

## Asset format and validation

- Sprites: 3072×3072 RGBA, 6×6 cells at 512×512. Each source cell is resized by nearest-neighbor into a 384×384 box at (64,64), providing transparent safety margins and a clear top 12.5% for status dots.
- Icons: 256×256, first working frame, resized with nearest-neighbor sampling.
- Environments: 1024×1024, fully opaque, with a clear lower-centre placement area.
- Every sprite cell is populated; all padding is transparent; source alpha is preserved exactly at sampled coordinates. RGBA pixels are copied directly into a PNG encoder, avoiding premultiplied-color rounding.
- Numerical checks verify file geometry, alpha, and sampling. They do not certify exact pose timing, artistic fidelity, or seamless motion; inspect those in the preview.

The existing character-generation and species/environment suites passed (18 tests). The app importer accepted all 9 cutout sheets and 4 opaque backgrounds with no warnings. The preview script passed syntax validation; browser visual QA remains for integration.

See [exact prompts](prompts.json), [machine-readable validation](validation.json), and [the manifest](../../scripts/art-selection.json).
