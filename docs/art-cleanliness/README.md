# Pet art cleanliness pass — 2026-10-09

Open the local comparison at `docs/art-cleanliness/preview.html` through a local HTTP server. Its before/after PNGs and full provenance are retained under `output/art-cleanliness/` in the development checkout.

The original fixed 6×6 slicing cut through several generated poses. Feet and other pieces appeared at the top of the next animation row. Repaired all 64 installed atlases and regenerated their 64 dock icons from the working pose. The repair measures transparent gutters in the original generated sheets, keeps connected tongues/tails/props with their owning frame, removes faint matte residue and isolated specks, and supplies transparent margins. Colors, recognizable designs, props, musical staff, sleep marks, row order, six frames per row, atlas dimensions and local-only flags are preserved. Scaling is uniform within each sheet.

The renderer uses shared UV coordinates inset by half a source texel after the texture loads. Extras use their actual texture height. This prevents adjacent-cell sampling at different window sizes.

## Validation

- Base inspected: `96b8b19c63a8966f0ec51ba050429fe816248141`.
- 64 sheets, 2,304 populated frames, zero visible pixels in reserved padding; every retained original source pixel has a frame owner.
- All six states on all 64 sheets inspected in contact sheets. Hidden Electron/Three.js comparison rendered all six states for Marvin, Mega Man, blue-tongue skink, orc and Lisa Hayes at 64px and 200px. Captured before/after screenshots; no browser console errors.
- Seven targeted suites passed: 76 tests covering gutter recovery, fragment cleanup, UV boundaries, importer, catalog, runtime resolution and local-only distribution filtering. Renderer module syntax check passed.
- Numerical results and hashes: [validation.json](validation.json). Original source paths, full rectangles, source backup, rendered comparison and screenshots are in the local `output/art-cleanliness/` bundle.

Run `node scripts/clean-pet-art.js output/art-cleanliness/sources.json <new-staging-directory>` to reproduce the cleanup. It writes a staging bundle; review it before copying the atlas/icon pairs into `renderer/assets/`. Use original generated PNGs or the preserved source backup, not an already repaired sheet. This pass repairs slicing and contamination; it preserves the original animation and any drawing quirks intrinsic to the source.

No artwork was pushed or published. The original tracked assets remain recoverable in the base revision.
