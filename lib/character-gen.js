// Builds paste-ready image-model prompts for new pet sprite atlases.
// Row order matches ANIM_CONFIG in lib/anim-state.js.
const ROWS = [
  { anim: 'sleeping', text: 'fully asleep at the desk in all 6 frames. Head slumped onto arms on the desk, eyes closed throughout. Z, ZZ, ZZZ sleep bubbles float upward, cycling larger and smaller across the frames for a gentle breathing/snoring loop.' },
  { anim: 'waking', text: 'startled awake. Frame 1: head down asleep with a ZZZ bubble. Frame 3: eyes snapping open, head jerking up. Frame 6: fully upright, alert, blinking.' },
  { anim: 'typing', text: 'typing on the laptop. Leaning forward slightly, hands moving on the keyboard, subtle head movement. Must loop seamlessly.' },
  { anim: 'alarmed', text: 'shocked. Frame 1: normal. Frame 2: eyes go wide. Frame 4: lurching backward in the chair, arms up. Frame 6: arms raised, mouth open, alarmed expression.' },
  { anim: 'celebrate', text: 'celebrating. Frame 1: normal seated. Frame 3: fist pump, big grin. Frames 5-6: both arms raised overhead, huge grin, leaning back in triumph.' },
  { anim: 'annoyed', text: 'frustrated. Frame 1: normal. Frames 2-3: pinching brow, eyes closed, grimacing. Frames 4-6: full face-palm with one hand, head shaking, slumped in the chair.' },
];

const DEFAULT_SCENE = 'a cozy, dimly lit room matching the character\'s world, warm light from the right side';

const RULES = `CRITICAL RULES:
- The desk and laptop are at the EXACT SAME angle and position in ALL frames. The camera NEVER moves.
- The character is in the SAME place in the frame in every cell, so animation frames line up.
- Pixel art style with clean dark outlines. Consistent palette throughout.
- Keep the top 10% of every cell free of important details (a status-dot overlay is drawn there).
- Opaque scene background filling the whole cell (no transparency, no checkerboard).
- No text, labels, borders or UI chrome on the image. Only the sleep Z bubbles in the sleeping row.`;

const FIXED_SCENE = (scene) => `FIXED SCENE (identical in every frame, never changes):
- ${scene}
- A desk in a MIRRORED isometric view: it recedes toward the upper-RIGHT, the character sits on the FAR side, the near edge of the desk is at the BOTTOM-RIGHT of the frame.
- A laptop on the desk with its screen opening toward the LOWER-LEFT; the viewer sees the FRONT of the screen on the left.
- The character faces toward the LOWER-LEFT, always SEATED behind the desk.`;

function validateSpec({ name, description }) {
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) throw new Error('name must be letters, digits, - or _');
  if (!description || description.trim().length < 10) throw new Error('description is too short to be useful');
}

// Full 6×6 atlas prompt. cell = pixel size of one cell.
function buildAtlasPrompt({ name, description, scene = DEFAULT_SCENE, cell = 512 }) {
  validateSpec({ name, description });
  const total = cell * 6;
  return `Pixel art sprite sheet. EXACTLY 6 columns × 6 rows (36 cells; not 8 columns, not 5 rows). Each cell is exactly ${cell}×${cell} pixels.
Total image size: ${total}×${total} pixels, a perfect square. No borders, gaps, or labels between cells.

CHARACTER: ${description.trim()}

${FIXED_SCENE(scene)}

${ROWS.map((r, i) => `ROW ${i + 1} — ${r.anim.toUpperCase()} (frames 1-6): The character is ${r.text}`).join('\n\n')}

${RULES}`;
}

// One row as a 6×1 strip — the fallback when a model can't do the full grid.
function buildStripPrompt({ name, description, scene = DEFAULT_SCENE, row, cell = 512 }) {
  validateSpec({ name, description });
  const r = ROWS[row];
  if (!r) throw new Error(`row must be 0-${ROWS.length - 1}`);
  return `Pixel art animation strip. EXACTLY 6 frames in ONE horizontal row (6 columns × 1 row). Each frame is exactly ${cell}×${cell} pixels.
Total image size: ${cell * 6}×${cell} pixels. No borders, gaps, or labels between frames.

CHARACTER: ${description.trim()}

${FIXED_SCENE(scene)}

ANIMATION — ${r.anim.toUpperCase()} (frames 1-6): The character is ${r.text}

${RULES}
- Use the attached reference image (if provided) for the exact character design, scene and camera angle.`;
}

module.exports = { ROWS, buildAtlasPrompt, buildStripPrompt };
