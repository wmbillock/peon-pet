# 45-character expansion

Five characters per collection, building on the existing cutout sprites and reusable environments. All generated PNGs remain in the local asset bundle; the public PR carries definitions, prompts, preview and validation only.

| Collection | Five generated characters |
|---|---|
| Lizards, reptiles and feeder insects | Leopard gecko, Panther chameleon, Blue-tongue skink, Dubia roach, House cricket |
| Super Mario Bros. | 1-Up Mushroom, Fire Flower, Princess Peach, Super Star, Super Mushroom |
| Ska music | Ska hepcat, Living trombone, Living tenor sax, Offbeat quarter note, Checkerboard bot |
| Local Legends — song-inspired mascots | Speed of Blight sprite, We Are the Stars sprite, Cooler by the Lake sprite, Camp Song sprite, Ballroom moon sprite |
| General video games | Link, Samus Aran, Sonic, Mega Man, Pac-Man |
| The Hitchhiker's Guide to the Galaxy | Arthur Dent, Ford Prefect, Zaphod Beeblebrox, Trillian, Babel fish |
| The Fifth Element | Leeloo, Korben Dallas, Ruby Rhod, Diva Plavalaguna, Mangalore |
| Robotech | Rick Hunter, Lisa Hayes, Lynn Minmei, VF-1S Valkyrie, Zentraedi battlepod |
| Original creations from this chat | Willow maestro, Brass-scale dragon, CRT garden spirit, Starchart python, Checker comet |

## Local preview and integration

1. Open [the preview](preview.html) from the local bundle. Select a collection, state and frame; inspect the six-frame working loop and pose alignment.
2. Read [scripts/character-library.json](../../scripts/character-library.json). Copy only generated entries' atlas and icon PNGs into their matching renderer/assets paths. Preserve alpha; do not chroma-key.
3. Merge generated entries into scripts/art-selection.json's species array, preserving existing entries. The current lib/art-catalog.js reads that existing manifest; this expansion manifest is a handoff and is not automatically loaded. Preserve localOnly, layout: cutout, setting: free, activity and defaultEnv.
4. Leave any draft-needs-art entries unregistered. Preserve existing user selections and overrides. The recommended backgrounds come from the previous art selection and the 60-background library.
5. Preview each character in the app before changing defaults. Distribution filtering must respect localOnly for all franchise characters.

## Format

Every final atlas is a 3072×3072 RGBA PNG with exactly six columns and six rows of 512×512 cells. Each source cell is sampled with nearest-neighbor into a 384×384 content box at (64,64). All four margins are transparent, including the top 12.5% reserved for status overlays. Each icon is 256×256, sampled from the first working frame. No desk or scene is baked into these new sprites.

The generator's sampled RGBA values are copied directly. Numerical checks measure geometry, cell population, padding, PNG integrity and exact RGBA readback; they do not certify anatomical accuracy, character likeness, seamless animation or fixed pose anchors. Review those in the gallery.

## Creative provenance

The Local Legends group uses original mascots inspired by song titles, not portraits of band members or official band artwork. [The band's own catalog](https://locallegendsska.bandcamp.com/album/greatest-hits) supplies the titles; [Cactus Club's band page](https://www.cactusclubmilwaukee.com/artists/local-legends/) supplies the Milwaukee ska/punk context. No lyrics were used.

The five personal originals combine interests expressed in this chat: weeping willows, brass and ska, reptiles, retro computer creatures, and science fiction. They are new designs: Willow maestro, Brass-scale dragon, CRT garden spirit, Starchart python and Checker comet.

See [exact prompts](prompts.json) and [validation](validation.json). Built-in image_gen produced the artwork. Local normalization only changes file geometry and preserves sampled alpha.

## Review notes

All nine collections have five generated sheets. The Mario collection uses Peach, Fire Flower, Super Star, Super Mushroom and 1-Up Mushroom. Nine earlier character choices were rejected by the image tool; their null-asset definitions are retained in the manifest's drafts array and must not be registered.

The roach's detached reaction marks were removed. Super Star's fourth row was repaired to use wide alarmed eyes. Peach's attempted cleanup was rejected, so small decorative reaction marks remain on its original sheet. Some annoyed rows return toward neutral in their sixth frame rather than holding a full face-palm; exact pose timing and seamless loops still require animation review before runtime defaults change.

## Validation result

All 45 final atlases and 45 icons passed geometry/hash checks. The app importer accepted all 45 as cutouts at its native 1536×1536 size, with no warnings. Manifest conversion matched all 45 species; distribution filtering excluded all 50 files belonging to the 25 local-only franchise entries. The three relevant existing suites passed 20 tests on base d8a9a49051907192cf14146871579f7a2356e051. Gallery JavaScript syntax and all 90 image references passed checks; browser visual execution was not completed.

## Local artwork source

The full local-artwork commit is `2ba1019748f2ea95b4af7f76d9d9ff40cd681734` on local branch `codex/character-library-45`. Retrieve the 90 PNG paths from that local commit or from the saved bundle. That commit was not pushed. This public PR contains definitions and review files only.
