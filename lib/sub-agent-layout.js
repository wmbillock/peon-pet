'use strict';
// Where the mini sub-agent pets go: beside the lead pet's window (Euphonia), not in a fixed screen corner. They line
// up on whichever side of the pet has room (left first), top-aligned with it, wrapping to a second column when the
// column runs out of height. Everything stays inside the display's work area. Pure, so it is testable.
const SIZE = 100;
const GAP = 6;

// anchor: the lead window's bounds {x,y,width,height}; area: that display's work area; n: index of this mini pet.
function subAgentSlot(anchor, area, n, size = SIZE, gap = GAP) {
  const step = size + gap;
  const perCol = Math.max(1, Math.floor(area.height / step));
  const col = Math.floor(n / perCol);
  const row = n % perCol;
  const roomLeft = anchor.x - area.x;
  const roomRight = area.x + area.width - (anchor.x + anchor.width);
  const left = roomLeft >= step || roomLeft >= roomRight;
  let x = left ? anchor.x - step * (col + 1) : anchor.x + anchor.width + gap + step * col;
  let y = anchor.y + row * step;
  if (y + size > area.y + area.height) y = area.y + area.height - size - (perCol - 1 - row) * step;   // clamp the column upward
  x = Math.min(Math.max(x, area.x), area.x + area.width - size);
  y = Math.min(Math.max(y, area.y), area.y + area.height - size);
  return { x: Math.round(x), y: Math.round(y) };
}

module.exports = { subAgentSlot, SIZE, GAP };
