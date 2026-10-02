'use strict';
// Desktop army: one small always-on-top window per root agent. Pure planning helpers; main.js owns the windows.
const ARMY_SIZE = { w: 150, h: 170 };
const ARMY_MAX = 12;
const GAP = 8;

// ids: root agent ids in display order; open: ids that already have a window.
// → which windows to open and which to close. At most `max` windows; earlier ids win.
function planArmy(ids, open, max = ARMY_MAX) {
  const want = ids.slice(0, max);
  const wantSet = new Set(want);
  const have = new Set(open);
  return { open: want.filter((id) => !have.has(id)), close: [...have].filter((id) => !wantSet.has(id)) };
}

// Default spot for the i-th window: rows along the bottom of the work area, filling right to left, wrapping upward.
function armyPosition(i, workArea, size = ARMY_SIZE) {
  const perRow = Math.max(1, Math.floor((workArea.width + GAP) / (size.w + GAP)));
  const col = i % perRow, row = Math.floor(i / perRow);
  const x = workArea.x + workArea.width - (col + 1) * (size.w + GAP) + GAP;
  const y = workArea.y + workArea.height - (row + 1) * (size.h + GAP) + GAP;
  return { x: Math.max(workArea.x, x), y: Math.max(workArea.y, y) };
}

// Keep a remembered position on screen (the display may have changed since it was saved).
function clampToArea(pos, workArea, size = ARMY_SIZE) {
  return {
    x: Math.min(Math.max(workArea.x, Math.round(pos.x)), workArea.x + workArea.width - size.w),
    y: Math.min(Math.max(workArea.y, Math.round(pos.y)), workArea.y + workArea.height - size.h),
  };
}

module.exports = { ARMY_SIZE, ARMY_MAX, planArmy, armyPosition, clampToArea };
