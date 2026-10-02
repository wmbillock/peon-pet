# Terra — Final Fantasy VI

[Open the sprite sheet](../../renderer/assets/terra-ff6-sprite-atlas.png).

Generated 2026-10-02 using the built-in image generation tool. Final source art has 6 columns × 6 rows with the standard sleeping, waking, typing, alarmed, celebrate, and annoyed row order. Each cell was resized separately with nearest-neighbor sampling to 512×512; the final PNG is 3072×3072.

## Verification

- Visually checked the character, six full columns, six rows, and action sequence.
- Read back all 9,437,184 output pixels: zero mismatched channels against nearest-neighbor source sampling and zero non-opaque pixels.
- Numerical checks cover dimensions, sampling and opacity; they do not establish pixel-identical scenery, exact pose compliance, or seamless motion.
- Source output: 1254×1254. Upscaling preserves generated detail without adding new detail.

Source SHA-256: `7ef76929e5d5adc3b4ef751c1b8ea3be44d0fb8763ee87dc54ce2a3dc622ec94`.

Final SHA-256: `12ed2fbfaf57effbfcdbeec38d8f2940537ed02d4f59b9c66001f0fe24b15b92`.

## Use

`node scripts/import-character.js terra-ff6 renderer/assets/terra-ff6-sprite-atlas.png`

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
Terra Branford from Final Fantasy VI, closely matching her iconic original green-haired SNES-era appearance. Young adult heroine with pale skin, long mint-green hair in a high swept ponytail with loose curled bangs, red hair tie, red strapless fitted outfit, purple cape/scarf flowing behind her shoulders, violet boots and gold accents. Large expressive green eyes, delicate recognizable face; charming small chibi proportions translated faithfully into FFVI-style pixel art. Keep the green hair, red outfit, purple cape, and recognizable silhouette in every frame.

ROOM DESIGN (identical across this sheet):
A cozy Final Fantasy VI-inspired magitek study, warm brass lamp on right, dark wood, a few books, subtle stone-wall texture. The modern laptop is part of the requested desk animation. No weapons in hands.
```
