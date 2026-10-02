# Retro robot sprite atlas

[Open the 3072×3072 PNG](../../renderer/assets/retro-robot-sprite-atlas.png).

Created 2026-10-02 with the built-in image generation tool, followed by a user-authorized local nearest-neighbor resize. This is the source art; use the existing importer to make it selectable in the app.

## Artifact and checks

- Layout: 6 columns × 6 rows; 36 cells of exactly 512×512 pixels.
- Row order: sleeping, waking, typing, alarmed, celebrate, annoyed.
- Generator output: 1254×1254 pixels (209×209 cells). Each cell was resized independently with Canvas image smoothing disabled. Upscaling preserves the generated detail; it does not add new detail.
- Checks: PNG readback dimensions, full opacity, and nearest-neighbor pixel comparison for all 36 cells. The generated grid and row actions were visually inspected. Pixel-identical scenery and seamless animation loops are not certified by these checks.
- The final image edit made the front laptop display visible. Yellow expression marks remain despite the removal request.

Source SHA-256: `fa60a0802cbbfffaffb01ec8bbf26fa403dce66272f25df72ec275f80b7cf90f`.

Final SHA-256: `fb85160c3d52dfd422457264474c7f60a774bec81836df86aa444b69a87aecb1`.

## Reuse for another description

1. Generate a prompt with `node scripts/character-prompt.js --name <name> --desc "<description>"`. This robot is also available as `--brief retro-robot`.
2. Use the built-in image tool; inspect the grid, action sequence, camera, and prop placement. Use a targeted image edit when needed.
3. Check the saved PNG dimensions. If the grid is correct but the size is wrong, resize each cell independently with nearest-neighbor sampling using the recipe below. Resizing cannot repair an incorrect grid or prop drift.
4. Verify the final PNG and commit it with its prompt and validation record on a task branch.
5. To install this asset: `node scripts/import-character.js retro-robot renderer/assets/retro-robot-sprite-atlas.png`. The importer creates a separate runtime copy capped at 1536×1536 and a dock icon.

## Original request

The first generation call expanded these instructions into individual poses and kept sleep text in row 1 to follow the final text restriction.

```text
Pixel art sprite sheet. EXACTLY 6 columns × 6 rows (36 cells; not 8 columns, not 5 rows). Each cell is exactly 512×512 pixels.
Total image size: 3072×3072 pixels, a perfect square. No borders, gaps, or labels between cells.

CHARACTER: A tiny retro robot…

FIXED SCENE (identical in every frame, never changes):
- a cozy, dimly lit room matching the character's world, warm light from the right side
- A desk in a MIRRORED isometric view: it recedes toward the upper-RIGHT, the character sits on the FAR side, the near edge of the desk is at the BOTTOM-RIGHT of the frame.
- A laptop on the desk with its screen opening toward the LOWER-LEFT; the viewer sees the FRONT of the screen on the left.
- The character faces toward the LOWER-LEFT, always SEATED behind the desk.

ROW 1 — SLEEPING (frames 1-6): The character is fully asleep at the desk in all 6 frames. Head slumped onto arms on the desk, eyes closed throughout. Z, ZZ, ZZZ sleep bubbles float upward, cycling larger and smaller across the frames for a gentle breathing/snoring loop.

ROW 2 — WAKING (frames 1-6): The character is startled awake. Frame 1: head down asleep with a ZZZ bubble. Frame 3: eyes snapping open, head jerking up. Frame 6: fully upright, alert, blinking.

ROW 3 — TYPING (frames 1-6): The character is typing on the laptop. Leaning forward slightly, hands moving on the keyboard, subtle head movement. Must loop seamlessly.

ROW 4 — ALARMED (frames 1-6): The character is shocked. Frame 1: normal. Frame 2: eyes go wide. Frame 4: lurching backward in the chair, arms up. Frame 6: arms raised, mouth open, alarmed expression.

ROW 5 — CELEBRATE (frames 1-6): The character is celebrating. Frame 1: normal seated. Frame 3: fist pump, big grin. Frames 5-6: both arms raised overhead, huge grin, leaning back in triumph.

ROW 6 — ANNOYED (frames 1-6): The character is frustrated. Frame 1: normal. Frames 2-3: pinching brow, eyes closed, grimacing. Frames 4-6: full face-palm with one hand, head shaking, slumped in the chair.

CRITICAL RULES:
- The desk and laptop are at the EXACT SAME angle and position in ALL frames. The camera NEVER moves.
- The character is in the SAME place in the frame in every cell, so animation frames line up.
- Pixel art style with clean dark outlines. Consistent palette throughout.
- Keep the top 10% of every cell free of important details (a status-dot overlay is drawn there).
- Opaque scene background filling the whole cell (no transparency, no checkerboard).
- No text, labels, borders or UI chrome on the image. Only the sleep Z bubbles in the sleeping row.
```

## Resize recipe

Use the existing Node Canvas dependency after loading the generated PNG as `image`. Confirm it is square and divisible by six, and visually confirm the grid before resizing. Write to a new destination.

```js
const sourceCell = image.width / 6;
const canvas = createCanvas(3072, 3072);
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;
for (let row = 0; row < 6; row++) {
  for (let column = 0; column < 6; column++) {
    ctx.drawImage(image, column * sourceCell, row * sourceCell, sourceCell, sourceCell,
      column * 512, row * 512, 512, 512);
  }
}
fs.writeFileSync(destination, canvas.toBuffer("image/png"), { flag: "wx" });
```

## Final image edit prompt

Applied using the built-in image tool with the first generated sheet as the reference and an opaque background:

```text
Edit this sprite sheet and preserve the EXACT 6 columns by 6 rows layout, all 36 robot poses, consistent cozy room and crisp pixel-art palette. Correct the laptop orientation IDENTICALLY in ALL 36 cells: the left upright laptop panel must display the FRONT luminous screen surface to the viewer, with a dark bezel and subtle blank warm-blue glowing display, no logo or text. The lid opens toward the LOWER-LEFT, with the keyboard to its upper-right toward the seated robot. The robot is behind the desk, facing LOWER-LEFT. Keep the desk's near edge at BOTTOM-RIGHT and desk receding UPPER-RIGHT. No camera or prop position differences between cells. All background and props must be exact repeated geometry.
Technical output requirement: save the final PNG at EXACTLY 3072 pixels wide and EXACTLY 3072 pixels tall. Each of six equal columns is 512 pixels, each of six equal rows is 512 pixels. Do not return a 1254-pixel preview-size file. Deliver the full 3072 x 3072 PNG.
Keep the six row animations: row1 sleeping in all six frames with Z/ZZ/ZZZ, row2 waking from head down to alert upright, row3 subtle looping typing, row4 alarmed with open mouth and raised arms at final frame, row5 celebratory seated fist pump then both arms overhead and huge grin, row6 brow pinch then one-hand full face-palm.
Do not add or remove rows or columns. No lettering except sleeping Z bubbles in row1. Remove exclamation marks or punctuation elsewhere; communicate emotions with pose and face. Top 52 pixels of each 512-square cell clear of important content. Fully opaque background edge to edge. No lines, margins, labels, borders, UI chrome, grid gaps, or transparency.
```

## Validation receipt

- Read back the final PNG: 3072×3072, six-by-six grid, 512×512 cells.
- Independently compared all 9,437,184 output pixels with the source using nearest-neighbor coordinate mapping: zero mismatched color channels and zero non-opaque pixels across all 36 cells.
- Existing character-generation and import tests: `tests/character-gen.test.js`, 6 passed.
- Robot brief: `node scripts/character-prompt.js --brief retro-robot` successfully emits the complete six-row prompt.
- Source implementation: `ecad183`; this change adds art, documentation, and a character brief without modifying the renderer or importer.
