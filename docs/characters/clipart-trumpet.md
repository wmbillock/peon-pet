# Clipart-style trumpet

[Open the sprite sheet](../../renderer/assets/clipart-trumpet-sprite-atlas.png).

Generated 2026-10-02 using the built-in image generation tool. Final source art has 6 columns × 6 rows with the standard sleeping, waking, typing, alarmed, celebrate, and annoyed row order. Each cell was resized separately with nearest-neighbor sampling to 512×512; the final PNG is 3072×3072.

## Verification

- Visually checked the character, six full columns, six rows, and action sequence.
- Read back all 9,437,184 output pixels: zero mismatched channels against nearest-neighbor source sampling and zero non-opaque pixels.
- Numerical checks cover dimensions, sampling and opacity; they do not establish pixel-identical scenery, exact pose compliance, or seamless motion.
- Source output: 1254×1254. Upscaling preserves generated detail without adding new detail.

Source SHA-256: `0aa343f3861a4186d7006d570c5d03bc685e652eb84e755047f052785ae5aa32`.

Final SHA-256: `903c5137067616eaa32eabe24367d9eb9f9a1e336e0f38d91626bd24b1ac65ef`.

## Use

`node scripts/import-character.js clipart-trumpet renderer/assets/clipart-trumpet-sprite-atlas.png`

The importer installs a separate runtime copy capped at 1536×1536 plus a dock icon. This commit supplies the source atlas and prompt, without changing the currently selected pet.

## Generation prompt

```text
Create one production pixel-art animation sprite sheet. EXACTLY SIX COLUMNS by SIX ROWS, 36 equal square cells. Target total PNG size EXACTLY 3072 x 3072, cells 512 x 512. Six pictures across and six down, never 8 columns or 5 rows. No margins, borders, gutters, separator lines or labels. The room backgrounds fill the square cells edge to edge. A single consistent character design in all 36 cells.

STYLE: crisp retro pixel art, deliberate square pixels, clean dark outlines, readable face and silhouettes, consistent limited palette. Opaque cozy dim room with warm light from the RIGHT. No transparency. No blurry painted rendering.

FIXED CAMERA AND SCENE:
The character is ALWAYS SEATED on the far side of a desk, facing LOWER-LEFT. MIRRORED isometric desk recedes toward UPPER-RIGHT, with its nearest edge at BOTTOM-RIGHT. Laptop display is on the LEFT and the viewer sees a luminous blank FRONT DISPLAY with a dark bezel, NOT a back panel or a logo. Screen opens toward LOWER-LEFT. Keyboard sits on the desk toward the seated character. Lock the camera, desk corners, chair/base position, keyboard, laptop screen, lighting, background and every prop at identical cell-relative coordinates in all 36 frames. Only character head/face/arms and sleeping bubbles animate. Treat the environment as one static duplicated background layer.
Reserve the top 10% of EVERY cell (top 52 px at final size) as quiet empty background. No foliage, antenna, flag, raised hands, sleep bubbles or important details in this top zone. Scale character and desk to fit the most extended pose below it. Character remains seated; body base does not translate.

READ LEFT TO RIGHT. SIX FRAMES IN EACH OF THE FOLLOWING SIX ROWS:
ROW 1 SLEEPING: All six frames FULLY ASLEEP, eyes closed, head or equivalent face area slumped onto arms on desk. Gentle breathing. Small Z, rising ZZ, larger ZZZ, rising ZZZ, smaller ZZ, small Z; seamless loop. These are the ONLY text glyphs in the entire sheet, and only in row 1.
ROW 2 WAKING: Frame1 head down asleep, no bubble; frame2 begins stirring; frame3 eyes SNAP OPEN and head jerks up; frame4 straightens; frame5 alert upright; frame6 upright alert with blink. Never standing.
ROW 3 TYPING: All six frames slightly leaning forward, eyes on laptop; alternate small left/right hand motions over keyboard and subtle head bob. SEAMLESS repeating six-frame loop. Same seated base.
ROW 4 ALARMED: Frame1 normal; frame2 eyes wide; frame3 hands start up; frame4 lurch backward in chair with arms raised; frame5 more alarmed; frame6 arms raised and mouth open. Remain seated. Convey surprise through face and pose, no punctuation symbols.
ROW 5 CELEBRATE: Frame1 normal; frame2 grin begins; frame3 one fist pump and big grin; frame4 raising both hands; frame5 and frame6 both arms overhead and huge grin, leaning back in seated triumph. Hands stay below top reserved zone.
ROW 6 ANNOYED: Frame1 normal; frame2 and frame3 one hand pinches brow, eyes closed, grimacing; frame4 full one-hand face-palm with head slumped; frame5 and frame6 full face-palm with small alternating head shake.

CRITICAL: Exactly 6 columns x 6 rows. Identical static scene geometry and prop placement in every frame. Consistent identity, colors, camera angle and character scale. Distinct, readable animation poses following the exact row order. No lettering, captions, watermark, icons, punctuation or UI chrome, except Z / ZZ / ZZZ in the first row. Do not draw cell outlines. No checkerboard.

CHARACTER FOR THIS ENTIRE SHEET:
An anthropomorphic golden brass TRUMPET in a bold simple clipart style translated into crisp pixel art. Immediately recognizable trumpet anatomy: long looped horizontal brass tubing, THREE piston valves in a row, small mouthpiece at one end, large flared trumpet bell at the other. Consistent instrument shape in all 36 frames. Expressive cartoon eyes and brows integrated near the bell, a talking mouth on the bell face. Two thin flexible cartoon arms with simple gloved hands and tiny feet allow sitting, typing and face-palm. Flat gold fills, two or three shaded tones, strong clean dark outline, playful classic clipart readability; not a humanoid carrying an instrument, not a saxophone or trombone.

ROOM DESIGN (identical across this sheet):
A cozy music practice room, muted warm wall colors, amber lamp on right, small wooden desk. Keep environment simple so the golden trumpet silhouette reads clearly. No printed music, letters or musical glyph decorations.
```

### Edit 1

Targeted visual correction.

Reference: exec-f9111db9-16ca-4f42-94a1-abcd3eaaae6a.png.

```text
Repair the LAYOUT of Image 1. Image 1 is the Clipart-style trumpet sprite sheet; its rightmost column was accidentally clipped. Keep its character design and room, but REBUILD the sprite sheet as EXACTLY SIX COMPLETE EQUALLY SIZED SQUARE COLUMNS by SIX COMPLETE SQUARE ROWS. Image 2 is ONLY a grid/layout template: use its exact 6x6 square cell divisions, NEVER its lizard character or terrarium scene. Do not introduce a lizard. All 36 frames including the entire sixth column must be fully visible. Do not merely stretch or crop the existing sheet. Reconstruct missing sixth poses from the specified action sequence.
Image 1 currently uses cells that are too wide. Reduce each scene width and recrop/redraw its composition into equal SQUARE cells. At 1254x1254 working resolution the cell boundaries MUST be x=0,209,418,627,836,1045,1254 and y=0,209,418,627,836,1045,1254. Not 235-pixel-wide columns. At the requested final3072x3072 resolution use512x512 cells.
An anthropomorphic golden brass TRUMPET in a bold simple clipart style translated into crisp pixel art. Immediately recognizable trumpet anatomy: long looped horizontal brass tubing, THREE piston valves in a row, small mouthpiece at one end, large flared trumpet bell at the other. Consistent instrument shape in all 36 frames. Expressive cartoon eyes and brows integrated near the bell, a talking mouth on the bell face. Two thin flexible cartoon arms with simple gloved hands and tiny feet allow sitting, typing and face-palm. Flat gold fills, two or three shaded tones, strong clean dark outline, playful classic clipart readability; not a humanoid carrying an instrument, not a saxophone or trombone.
A cozy music practice room, muted warm wall colors, amber lamp on right, small wooden desk. Keep environment simple so the golden trumpet silhouette reads clearly. No printed music, letters or musical glyph decorations.
Rows: 1 all six asleep eyes closed with Z/ZZ/ZZZ bubbles; 2 six-step wakeup from head down to alert blink; 3 six-step subtle typing loop; 4 normal, eyes wide, beginning recoil, arms raised recoil, shock, final arms raised mouth open; 5 normal, smile, fist pump, both hands starting up, both arms overhead grinning, both arms overhead grinning; 6 normal, brow pinch, brow pinch, face-palm, face-palm left shake, face-palm right shake.
Seated in every frame. Exactly the same camera, desk, lamp, laptop and background anchors in each cell. Front laptop screen is visible to the left and character behind desk faces lower-left. Every character including raised hands fits entirely within its cell, with the top10% of each cell clear of important details. Opaque pixel art, clean outlines. No separators, gaps, borders, labels or text except sleep Z bubbles. Count SIX FULL characters in EVERY row before finalizing.
```

### Edit 2

First layout repair still produced five columns; replacing the character in a valid six-by-six sheet.

Reference: exec-2ac78d69-b384-4936-a30c-2ac6e24dae66.png.

```text
This is a precise character replacement edit of the attached COMPLETE SIX-COLUMN, SIX-ROW sprite sheet.
KEEP THE EXISTING GRID AND CANVAS UNCHANGED. There are SIX frames per row and SIX rows. Preserve every cell boundary exactly; each cell is one SIXTH of the image width and one SIXTH of its height. Do not rescale the whole composition, do not widen any cell, do not remove a column. In this 1254x1254 image each square cell is209x209. No cropping.

ONLY REPLACE THE BEARDED DRAGON LIZARD IN EACH OF THE 36 CELLS with this new character:
An anthropomorphic golden brass TRUMPET in a bold simple clipart style translated into crisp pixel art. Immediately recognizable trumpet anatomy: long looped horizontal brass tubing, THREE piston valves in a row, small mouthpiece at one end, large flared trumpet bell at the other. Consistent instrument shape in all 36 frames. Expressive cartoon eyes and brows integrated near the bell, a talking mouth on the bell face. Two thin flexible cartoon arms with simple gloved hands and tiny feet allow sitting, typing and face-palm. Flat gold fills, two or three shaded tones, strong clean dark outline, playful classic clipart readability; not a humanoid carrying an instrument, not a saxophone or trombone.
Fit the new character inside the SAME small bounding region occupied by the lizard, with the same center/base and same head/hand action from the corresponding lizard frame. If the character is wide, make the CHARACTER smaller, NEVER make the cell wider. No remaining lizard, reptile tail, reptile legs, scales or beard.

Keep the EXACT existing laptop, desk, background, lighting, camera, props and chair in each cell. The new character is always seated behind the desk. Six sleeping frames in first row; six waking frames in second row; six typing frames in third row; six shocked frames in fourth row; six celebrating frames in fifth row; six annoyed face-palm frames in last row. Inherit the distinct face expression and gestures of EACH corresponding source cell. Sleeping eyes closed. Celebrating last two frames both arms raised, big grin. Annoyed last three face-palm. No text except first row Z sleep bubbles.
Use crisp pixel art with clear dark outlines, solid opaque background, top10% clearance, no labels or borders.
Before returning count EXACTLY SIX COMPLETE trumpet characters PER ROW, not five. All SIX in the sixth column are completely visible.
```
