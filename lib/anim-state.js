'use strict';

const ATLAS_COLS = 6;
const ATLAS_ROWS = 6;

const ANIM_CONFIG = {
  sleeping:  { row: 0, frames: 6, fps: 3,  loop: true  },
  waking:    { row: 1, frames: 6, fps: 8,  loop: false },
  typing:    { row: 2, frames: 6, fps: 8,  loop: false },
  alarmed:   { row: 3, frames: 6, fps: 8,  loop: false },
  celebrate: { row: 4, frames: 6, fps: 8,  loop: false },
  annoyed:   { row: 5, frames: 6, fps: 8,  loop: false },
};

/**
 * Compute UV coordinates for a given animation frame.
 * Matches the Three.js convention: v=0 is bottom, v=1 is top.
 *
 * Returns { u0, u1, v0, v1 } where:
 *   TL = (u0, v1), TR = (u1, v1), BL = (u0, v0), BR = (u1, v0)
 */
function computeUVs(animName, frame, { width = 0, height = 0 } = {}) {
  const { row } = ANIM_CONFIG[animName];
  return require('./frame-uv').frameUVs(frame, row, ATLAS_COLS, ATLAS_ROWS, width, height);
}

module.exports = { ANIM_CONFIG, computeUVs, ATLAS_COLS, ATLAS_ROWS };
