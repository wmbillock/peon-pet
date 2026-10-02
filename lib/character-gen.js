// Builds paste-ready image-model prompts for new pet sprite atlases.
// Row order matches ANIM_CONFIG in lib/anim-state.js.
const ROWS = [
  { anim: 'sleeping', text: 'fully asleep at their workspace in all 6 frames. Head slumped, eyes closed throughout, resting on whatever suits the character. Z, ZZ, ZZZ sleep bubbles float upward, cycling larger and smaller across the frames for a gentle breathing/snoring loop.' },
  { anim: 'waking', text: 'startled awake. Frame 1: asleep with a ZZZ bubble. Frame 3: eyes snapping open, head jerking up. Frame 6: fully upright, alert, blinking.' },
  { anim: 'typing', text: 'busy at their work: {activity}. Subtle continuous motion so it loops seamlessly.' },
  { anim: 'alarmed', text: 'shocked. Frame 1: normal. Frame 2: eyes go wide. Frame 4: lurching backward, arms up. Frame 6: arms raised, mouth open, alarmed expression.' },
  { anim: 'celebrate', text: 'celebrating. Frame 1: normal. Frame 3: fist pump, big grin. Frames 5-6: both arms raised overhead, huge grin, leaning back in triumph.' },
  { anim: 'annoyed', text: 'frustrated. Frame 1: normal. Frames 2-3: pinching brow, eyes closed, grimacing. Frames 4-6: full face-palm with one hand, head shaking, slumped.' },
];

const DEFAULT_SCENE = 'a cozy, dimly lit room matching the character\'s world, warm light from the right side';
const DEFAULT_ACTIVITY = 'typing on a laptop, leaning forward slightly with hands moving on the keyboard';
const CHROMA_HEX = '#FF00FF';

const RULES_COMMON = `- The camera NEVER moves. The character is in the SAME place in the frame in every cell so animation frames line up.
- Pixel art style with clean dark outlines. Consistent palette throughout.
- Keep the top 10% of every cell free of important details (a status-dot overlay is drawn there).
- No text, labels, borders or UI chrome on the image. Only the sleep Z bubbles in the sleeping row.`;

// layout 'baked': the scene is painted into every cell (opaque).  'cutout': the character alone on
// a flat chroma-key backdrop, composited onto a separate environment by the app.
function rules(layout, setting) {
  const props = setting === 'desk' ? '- The desk and laptop are at the EXACT SAME angle and position in ALL frames.\n' : '';
  if (layout === 'cutout') {
    return `CRITICAL RULES:
${props}- Background: ONE flat solid ${CHROMA_HEX} (magenta) colour filling every pixel that is not the character. No scene, no floor, no shadows, no gradients, no glow, no magenta anywhere on the character itself.
- Only objects the character is actively using (their work prop) appear with them. No room, no furniture beyond that.
- The whole character and its prop stay fully inside the cell with a small margin; never cropped.
${RULES_COMMON}`;
  }
  return `CRITICAL RULES:
${props}- Opaque scene background filling the whole cell (no transparency, no checkerboard).
${RULES_COMMON}`;
}

function fixedScene({ scene, setting, layout }) {
  if (layout === 'cutout') {
    return `FIXED STAGE (identical in every frame, never changes):
- ${setting === 'desk' ? 'The character sits at a small desk with a laptop (both included in the sprite).' : 'The character stays at one fixed spot, facing the LOWER-LEFT of the frame.'}
- Intended environment (do NOT draw it, it is added later): ${scene}
- Lighting matches that environment: warm light from the right side.`;
  }
  if (setting === 'desk') {
    return `FIXED SCENE (identical in every frame, never changes):
- ${scene}
- A desk in a MIRRORED isometric view: it recedes toward the upper-RIGHT, the character sits on the FAR side, the near edge of the desk is at the BOTTOM-RIGHT of the frame.
- A laptop on the desk with its screen opening toward the LOWER-LEFT; the viewer sees the FRONT of the screen on the left.
- The character faces toward the LOWER-LEFT, always SEATED behind the desk.`;
  }
  return `FIXED SCENE (identical in every frame, never changes):
- ${scene}
- The character stays at one fixed spot in the frame, facing the LOWER-LEFT, in the same position and scale in every cell.
- The scene is specific to this character and what they do; props are painted into it and never move.`;
}

function validateSpec({ name, description }) {
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) throw new Error('name must be letters, digits, - or _');
  if (!description || description.trim().length < 10) throw new Error('description is too short to be useful');
}

const rowText = (r, activity) => r.text.replace('{activity}', activity);

// Full 6×6 atlas prompt. cell = pixel size of one cell.
function buildAtlasPrompt({ name, description, scene = DEFAULT_SCENE, activity = DEFAULT_ACTIVITY, setting = 'desk', layout = 'baked', cell = 512 }) {
  validateSpec({ name, description });
  const total = cell * 6;
  return `Pixel art sprite sheet. EXACTLY 6 columns × 6 rows (36 cells; not 8 columns, not 5 rows). Each cell is exactly ${cell}×${cell} pixels.
Total image size: ${total}×${total} pixels, a perfect square. No borders, gaps, or labels between cells.

CHARACTER: ${description.trim()}

${fixedScene({ scene, setting, layout })}

${ROWS.map((r, i) => `ROW ${i + 1} — ${r.anim.toUpperCase()} (frames 1-6): The character is ${rowText(r, activity)}`).join('\n\n')}

${rules(layout, setting)}`;
}

// One row as a 6×1 strip — the fallback when a model can't do the full grid.
function buildStripPrompt({ name, description, scene = DEFAULT_SCENE, activity = DEFAULT_ACTIVITY, setting = 'desk', layout = 'baked', row, cell = 512 }) {
  validateSpec({ name, description });
  const r = ROWS[row];
  if (!r) throw new Error(`row must be 0-${ROWS.length - 1}`);
  return `Pixel art animation strip. EXACTLY 6 frames in ONE horizontal row (6 columns × 1 row). Each frame is exactly ${cell}×${cell} pixels.
Total image size: ${cell * 6}×${cell} pixels. No borders, gaps, or labels between frames.

CHARACTER: ${description.trim()}

${fixedScene({ scene, setting, layout })}

ANIMATION — ${r.anim.toUpperCase()} (frames 1-6): The character is ${rowText(r, activity)}

${rules(layout, setting)}
- Use the attached reference image (if provided) for the exact character design, scene and camera angle.`;
}

// One extra 6-frame animation (a wave, a nod…) as a strip that continues from the working pose.
function buildExtraPrompt({ name, description, action, scene = DEFAULT_SCENE, activity = DEFAULT_ACTIVITY, setting = 'desk', layout = 'baked', cell = 512 }) {
  validateSpec({ name, description });
  if (!action || action.trim().length < 4) throw new Error('Describe the action (e.g. "waves one arm in a friendly hello")');
  return `Pixel art animation strip. EXACTLY 6 frames in ONE horizontal row (6 columns × 1 row). Each frame is exactly ${cell}×${cell} pixels.
Total image size: ${cell * 6}×${cell} pixels. No borders, gaps, or labels between frames.

CHARACTER: ${description.trim()}

${fixedScene({ scene, setting, layout })}

ANIMATION — ${String(name).toUpperCase()} (frames 1-6): The character, while ${activity}, ${action.trim()}.
Frame 1 and frame 6 are the character's normal working pose, so the clip returns to idle cleanly. The motion peaks around frames 3-4. Everything except the moving part stays exactly where it is in the reference.

${rules(layout, setting)}
- Use the attached reference image (the character's existing sheet) for the exact design, scene and camera angle.`;
}

// A standalone environment plate for cutout characters: no character, a clear stage for them.
function buildEnvironPrompt({ name, description, size = 1024, stage = 'lower-centre' }) {
  if (!description || description.trim().length < 10) throw new Error('description is too short to be useful');
  return `Pixel art environment background${name ? ` ("${name}")` : ''}. A single square image, exactly ${size}×${size} pixels. NO characters, NO people or animals, NO text or UI.

SCENE: ${description.trim()}

COMPOSITION:
- Fixed camera, slightly elevated three-quarter view, painted to be seen at small size (about 200px), so use bold readable shapes.
- Leave a clear, uncluttered STAGE in the ${stage} of the frame, about 55% of the width and 45% of the height, where a small character will be placed later. Floor or ground continues through the stage; nothing tall stands there.
- Put detail and props toward the edges and back wall. Warm light from the right side.
- Keep the top 10% of the image calm (a status-dot overlay is drawn there).
- Pixel art style with clean outlines, a consistent limited palette, fully opaque.`;
}

module.exports = { ROWS, DEFAULT_SCENE, DEFAULT_ACTIVITY, CHROMA_HEX, buildAtlasPrompt, buildStripPrompt, buildExtraPrompt, buildEnvironPrompt };
