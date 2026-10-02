# Beardie (`bearded-dragon`)

**Doing:** basking motionless on a warm flat rock, tongue flicking now and then, slowly chewing a leaf of greens

**Where:** the inside of a glass desert terrarium lit by a glowing heat lamp

## 1 · Environment

Square (1:1) image. New chat, no attachment. Save as `env-bearded-dragon.png`.

```text
Pixel art environment background ("Desert terrarium"). A single square (1:1) image. NO characters, NO people or animals, NO text or UI.

SCENE: The inside of a large glass desert terrarium seen from the front: sandy substrate, stacked rocks and driftwood at the sides, a glowing heat lamp hanging at the top casting a warm cone of light, a water dish, small succulents, amber light.

COMPOSITION:
- Fixed camera, slightly elevated three-quarter view, painted to be seen at small size (about 200px), so use bold readable shapes.
- Leave a clear, uncluttered STAGE in the lower-centre of the frame, about 55% of the width and 45% of the height, where a small character will be placed later. Floor or ground continues through the stage; nothing tall stands there.
- Put detail and props toward the edges and back wall. Warm light from the right side.
- Keep the top 10% of the image calm (a status-dot overlay is drawn there).
- Pixel art style with clean outlines, a consistent limited palette, fully opaque.
```

Import: **Species & art** tab → *Environments* → name it `Desert terrarium`, paste the description, *Import image…*.

## 2 · Character (cutout on magenta)

### Option A — edit the existing sheet (recommended)

Attach `renderer/assets/bearded-dragon-sprite-atlas.png`. The grid is already valid, so the model only has to redraw the character and swap the background. Save as `bearded-dragon-cutout.png`.

```text
I have attached an existing pixel-art sprite sheet of this character: A recognizable BEARDED DRAGON LIZARD, a real-world Pogona-type reptile: sandy tan and warm ochre scales, broad triangular head, spiky cheek and throat beard, dark round eyes with expressive lids, squat torso, short clawed forelegs used as hands, long tapering tail. NO wings, NO fantasy horns, NO clothing, NO mammalian face. The beard darkens slightly when alarmed or annoyed.

Edit it into a NEW sheet. Keep the layout EXACTLY: a perfect square image, 6 columns × 6 rows of equal square cells, the same row order (1 sleeping, 2 waking, 3 working, 4 alarmed, 5 celebrate, 6 annoyed), 6 frames per row, and the character in the same place and scale in every cell. Keep the character's exact design: colors, proportions, face and outline style.

CHANGES:
1. BACKGROUND: in every cell, replace everything that is not the character with ONE flat solid #FF00FF (magenta). No scene, no floor, no furniture, no shadows, no gradients, no glow. No magenta on the character itself. (A separate environment image is added later.)
2. ACTIVITY: the character is no longer at a computer. Row 3 (working) shows them basking motionless on a warm flat rock, tongue flicking now and then, slowly chewing a leaf of greens, with subtle looping motion. Props that stay with the character: a flat sun-warmed rock and a small dish of greens.
3. Adapt the other rows to this activity and setting: the character sleeps, wakes, gets alarmed, celebrates and gets annoyed in the same place they work. Intended environment (do NOT draw it): the inside of a glass desert terrarium lit by a glowing heat lamp.
4. Remove the desk and laptop entirely (unless the activity uses them). Keep the top 10% of each cell calm.

No text, labels or borders, except the Z sleep bubbles in row 1.
```

### Option B — from scratch

Use if Option A drifts from the character. Attach the sheet above only as a *reference* and say “use it for the character design only”.

```text
Pixel art sprite sheet. EXACTLY 6 columns × 6 rows (36 cells; not 8 columns, not 5 rows).
The image is a perfect SQUARE (1:1) made of 36 equal square cells. No borders, gaps, or labels between cells.

CHARACTER: A recognizable BEARDED DRAGON LIZARD, a real-world Pogona-type reptile: sandy tan and warm ochre scales, broad triangular head, spiky cheek and throat beard, dark round eyes with expressive lids, squat torso, short clawed forelegs used as hands, long tapering tail. NO wings, NO fantasy horns, NO clothing, NO mammalian face. The beard darkens slightly when alarmed or annoyed.

FIXED STAGE (identical in every frame, never changes):
- The character stays at one fixed spot, facing the LOWER-LEFT of the frame.
- Intended environment (do NOT draw it, it is added later): the inside of a glass desert terrarium lit by a glowing heat lamp
- Lighting matches that environment: warm light from the right side.

ROW 1 — SLEEPING (frames 1-6): The character is fully asleep at their workspace in all 6 frames. Head slumped, eyes closed throughout, resting on whatever suits the character. Z, ZZ, ZZZ sleep bubbles float upward, cycling larger and smaller across the frames for a gentle breathing/snoring loop.

ROW 2 — WAKING (frames 1-6): The character is startled awake. Frame 1: asleep with a ZZZ bubble. Frame 3: eyes snapping open, head jerking up. Frame 6: fully upright, alert, blinking.

ROW 3 — TYPING (frames 1-6): The character is busy at their work: basking motionless on a warm flat rock, tongue flicking now and then, slowly chewing a leaf of greens. Subtle continuous motion so it loops seamlessly.

ROW 4 — ALARMED (frames 1-6): The character is shocked. Frame 1: normal. Frame 2: eyes go wide. Frame 4: lurching backward, arms up. Frame 6: arms raised, mouth open, alarmed expression.

ROW 5 — CELEBRATE (frames 1-6): The character is celebrating. Frame 1: normal. Frame 3: fist pump, big grin. Frames 5-6: both arms raised overhead, huge grin, leaning back in triumph.

ROW 6 — ANNOYED (frames 1-6): The character is frustrated. Frame 1: normal. Frames 2-3: pinching brow, eyes closed, grimacing. Frames 4-6: full face-palm with one hand, head shaking, slumped.

CRITICAL RULES:
- Background: ONE flat solid #FF00FF (magenta) colour filling every pixel that is not the character. No scene, no floor, no shadows, no gradients, no glow, no magenta anywhere on the character itself.
- Only objects the character is actively using (their work prop) appear with them. No room, no furniture beyond that.
- The whole character and its prop stay fully inside the cell with a small margin; never cropped.
- The camera NEVER moves. The character is in the SAME place in the frame in every cell so animation frames line up.
- Pixel art style with clean dark outlines. Consistent palette throughout.
- Keep the top 10% of every cell free of important details (a status-dot overlay is drawn there).
- No text, labels, borders or UI chrome on the image. Only the sleep Z bubbles in the sleeping row.
```

### If the grid comes out wrong

- Reply: “Keep exactly 6 columns × 6 rows of equal square cells; do not add or drop columns or rows. Same character position in every cell.”
- Or generate **one row at a time** (square-ish images are fine; 6 frames per row) — the *Row 1…6* buttons in the panel build those prompts.

## 3 · Import

1. **Species & art** → *Beardie* → tick *Backdrop is magenta #FF00FF* → *Replace sheet…* → pick `bearded-dragon-cutout.png`.
2. Set *Sheet type* to **Cutout**, *Activity* to the line above, *Setting* to **Free-form**, and *Environment* to **Desert terrarium**.
3. *Show contact sheet* to check all six rows; the magenta should be gone.
4. Undo any time: delete the folder `~/Library/Application Support/Peon Pet/characters/bearded-dragon/` to fall back to the bundled art.

## Extra · wave

A 3 columns × 2 rows grid, landscape (3:2). Attach the finished `bearded-dragon-cutout.png` as a reference. Save as `bearded-dragon-wave.png`.

```text
Pixel art animation sheet: ONE short animation of EXACTLY 6 frames, laid out as a grid of 3 columns × 2 rows (landscape 3:2 image). Read it left to right, top row first: frames 1-2-3 on the top row, frames 4-5-6 on the bottom row. Equal square cells, no borders, gaps or labels between them.

CHARACTER: A recognizable BEARDED DRAGON LIZARD, a real-world Pogona-type reptile: sandy tan and warm ochre scales, broad triangular head, spiky cheek and throat beard, dark round eyes with expressive lids, squat torso, short clawed forelegs used as hands, long tapering tail. NO wings, NO fantasy horns, NO clothing, NO mammalian face. The beard darkens slightly when alarmed or annoyed.

FIXED STAGE (identical in every frame, never changes):
- The character stays at one fixed spot, facing the LOWER-LEFT of the frame.
- Intended environment (do NOT draw it, it is added later): the inside of a glass desert terrarium lit by a glowing heat lamp
- Lighting matches that environment: warm light from the right side.

ANIMATION — WAVE (frames 1-6): The character, while basking motionless on a warm flat rock, tongue flicking now and then, slowly chewing a leaf of greens, raises one front arm and waves it in a slow, friendly circle, a beardie's classic acknowledging gesture, while the head stays level.
Frame 1 and frame 6 are the character's normal working pose, so the clip returns to idle cleanly. The motion peaks around frames 3-4. Everything except the moving part stays exactly where it is in the reference.

CRITICAL RULES:
- Background: ONE flat solid #FF00FF (magenta) colour filling every pixel that is not the character. No scene, no floor, no shadows, no gradients, no glow, no magenta anywhere on the character itself.
- Only objects the character is actively using (their work prop) appear with them. No room, no furniture beyond that.
- The whole character and its prop stay fully inside the cell with a small margin; never cropped.
- The camera NEVER moves. The character is in the SAME place in the frame in every cell so animation frames line up.
- Pixel art style with clean dark outlines. Consistent palette throughout.
- Keep the top 10% of every cell free of important details (a status-dot overlay is drawn there).
- No text, labels, borders or UI chrome on the image.
- Use the attached reference image (the character's existing sheet) for the exact design, scene and camera angle.
```

Import: *Extra animations* → name `wave` → tick the magenta box → *Import strip…* → choose when it plays (e.g. “a session starts”).

## Head bob (procedural)

The bundled bob was cut from the old baked art. After replacing the sheet, regenerate it from the new one:

```bash
node scripts/gen-headbob.js bearded-dragon --custom
```

If the head moves oddly, adjust the region (centre x, centre y, softness as fractions of the cell): `--region 0.5,0.42,0.12`.
