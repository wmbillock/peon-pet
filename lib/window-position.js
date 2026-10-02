'use strict';

const WIN_SIZE = 200;
const WIN_MARGIN = 20;

function cornerPosition(corner, width, height) {
  const right = width - WIN_SIZE - WIN_MARGIN;
  const bottom = height - WIN_SIZE - WIN_MARGIN;
  switch (corner) {
    case 'top-left':     return { x: WIN_MARGIN, y: WIN_MARGIN };
    case 'top-right':    return { x: right,      y: WIN_MARGIN };
    case 'bottom-right': return { x: right,      y: bottom };
    default:             return { x: WIN_MARGIN, y: bottom }; // bottom-left
  }
}

// Bounds saved from a previous run → bounds to open with, or null to use the default corner.
// The saved rectangle must still overlap a connected display's work area (monitors come and go);
// it is then pulled fully inside that display and its size kept within [min, max].
function restoreBounds(saved, workAreas, { min = { w: WIN_SIZE, h: WIN_SIZE }, max = { w: 560, h: 700 } } = {}) {
  if (!saved || ![saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)) return null;
  const overlap = (a) => Math.min(saved.x + saved.width, a.x + a.width) - Math.max(saved.x, a.x) > 0
    && Math.min(saved.y + saved.height, a.y + a.height) - Math.max(saved.y, a.y) > 0;
  const area = workAreas.find(overlap);
  if (!area) return null;
  const width = Math.round(Math.min(max.w, area.width, Math.max(min.w, saved.width)));
  const height = Math.round(Math.min(max.h, area.height, Math.max(min.h, saved.height)));
  return {
    x: Math.round(Math.min(Math.max(area.x, saved.x), area.x + area.width - width)),
    y: Math.round(Math.min(Math.max(area.y, saved.y), area.y + area.height - height)),
    width, height,
  };
}

module.exports = { WIN_SIZE, WIN_MARGIN, cornerPosition, restoreBounds };
