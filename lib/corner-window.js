'use strict';
// Where the small corner window goes when its content changes size: keep whichever screen corner
// it is nearest to fixed, so a window parked bottom-left grows up and to the right.
function computeCornerBounds(bounds, workArea, w, h, { min = { w: 200, h: 200 }, max = { w: 560, h: 700 } } = {}) {
  const nw = Math.round(Math.min(max.w, workArea.width, Math.max(min.w, Number(w) || min.w)));
  const nh = Math.round(Math.min(max.h, workArea.height, Math.max(min.h, Number(h) || min.h)));
  const right = bounds.x + bounds.width / 2 > workArea.x + workArea.width / 2;
  const bottom = bounds.y + bounds.height / 2 > workArea.y + workArea.height / 2;
  const x = Math.min(Math.max(workArea.x, right ? bounds.x + bounds.width - nw : bounds.x), workArea.x + workArea.width - nw);
  const y = Math.min(Math.max(workArea.y, bottom ? bounds.y + bounds.height - nh : bounds.y), workArea.y + workArea.height - nh);
  return { x: Math.round(x), y: Math.round(y), width: nw, height: nh };
}

module.exports = { computeCornerBounds };
