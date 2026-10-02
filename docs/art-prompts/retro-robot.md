# Retro Robot (`retro-robot`)

**Doing:** soldering a circuit board with a smoking soldering iron, tiny sparks flashing and its antenna blinking

**Where:** a cluttered 1980s robotics garage workshop

## 1 · Environment

Square (1:1) image. New chat, no attachment. Save as `env-retro-robot.png`.

```text
Pixel art environment background ("Robotics garage"). A single square (1:1) image. NO characters, NO people or animals, NO text or UI.

SCENE: A cluttered 1980s robotics garage workshop: a pegboard wall of tools, a shelf of half-built robot heads and gears, an oscilloscope showing a green waveform, a hanging work lamp, coiled cables on a concrete floor, blueprint posters.

COMPOSITION:
- Fixed camera, slightly elevated three-quarter view, painted to be seen at small size (about 200px), so use bold readable shapes.
- Leave a clear, uncluttered STAGE in the lower-centre of the frame, about 55% of the width and 45% of the height, where a small character will be placed later. Floor or ground continues through the stage; nothing tall stands there.
- Put detail and props toward the edges and back wall. Warm light from the right side.
- Keep the top 10% of the image calm (a status-dot overlay is drawn there).
- Pixel art style with clean outlines, a consistent limited palette, fully opaque.
```

Import: **Species & art** tab → *Environments* → name it `Robotics garage`, paste the description, *Import image…*.

## 2 · Character (cutout on magenta)

### Option A — edit the existing sheet (recommended)

Attach `renderer/assets/retro-robot-sprite-atlas.png`. The grid is already valid, so the model only has to redraw the character and swap the background. Save as `retro-robot-cutout.png`.

```text
I have attached an existing pixel-art sprite sheet of this character: A tiny retro robot with a rounded white-and-cream body, a dark glass visor face with two glowing blue eyes, a bobbing antenna with a small light, and orange ear pods.

Edit it into a NEW sheet. Keep the layout EXACTLY: a perfect square image, 6 columns × 6 rows of equal square cells, the same row order (1 sleeping, 2 waking, 3 working, 4 alarmed, 5 celebrate, 6 annoyed), 6 frames per row, and the character in the same place and scale in every cell. Keep the character's exact design: colors, proportions, face and outline style.

CHANGES:
1. BACKGROUND: in every cell, replace everything that is not the character with ONE flat solid #FF00FF (magenta). No scene, no floor, no furniture, no shadows, no gradients, no glow. No magenta on the character itself. (A separate environment image is added later.)
2. ACTIVITY: the character is no longer at a computer. Row 3 (working) shows them soldering a circuit board with a smoking soldering iron, tiny sparks flashing and its antenna blinking, with subtle looping motion. Props that stay with the character: a small workbench with a circuit board and a soldering iron.
3. Adapt the other rows to this activity and setting: the character sleeps, wakes, gets alarmed, celebrates and gets annoyed in the same place they work. Intended environment (do NOT draw it): a cluttered 1980s robotics garage workshop.
4. Remove the desk and laptop entirely (unless the activity uses them). Keep the top 10% of each cell calm.

No text, labels or borders, except the Z sleep bubbles in row 1.
```

### Option B — from scratch

Use if Option A drifts from the character. Attach the sheet above only as a *reference* and say “use it for the character design only”.

```text
Pixel art sprite sheet. EXACTLY 6 columns × 6 rows (36 cells; not 8 columns, not 5 rows).
The image is a perfect SQUARE (1:1) made of 36 equal square cells. No borders, gaps, or labels between cells.

CHARACTER: A tiny retro robot with a rounded white-and-cream body, a dark glass visor face with two glowing blue eyes, a bobbing antenna with a small light, and orange ear pods.

FIXED STAGE (identical in every frame, never changes):
- The character stays at one fixed spot, facing the LOWER-LEFT of the frame.
- Intended environment (do NOT draw it, it is added later): a cluttered 1980s robotics garage workshop
- Lighting matches that environment: warm light from the right side.

ROW 1 — SLEEPING (frames 1-6): The character is fully asleep at their workspace in all 6 frames. Head slumped, eyes closed throughout, resting on whatever suits the character. Z, ZZ, ZZZ sleep bubbles float upward, cycling larger and smaller across the frames for a gentle breathing/snoring loop.

ROW 2 — WAKING (frames 1-6): The character is startled awake. Frame 1: asleep with a ZZZ bubble. Frame 3: eyes snapping open, head jerking up. Frame 6: fully upright, alert, blinking.

ROW 3 — TYPING (frames 1-6): The character is busy at their work: soldering a circuit board with a smoking soldering iron, tiny sparks flashing and its antenna blinking. Subtle continuous motion so it loops seamlessly.

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

1. **Species & art** → *Retro Robot* → tick *Backdrop is magenta #FF00FF* → *Replace sheet…* → pick `retro-robot-cutout.png`.
2. Set *Sheet type* to **Cutout**, *Activity* to the line above, *Setting* to **Free-form**, and *Environment* to **Robotics garage**.
3. *Show contact sheet* to check all six rows; the magenta should be gone.
4. Undo any time: delete the folder `~/Library/Application Support/Peon Pet/characters/retro-robot/` to fall back to the bundled art.
