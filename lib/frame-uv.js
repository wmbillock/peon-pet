// Shared by the WebGL renderer and Node tests. Half a texel keeps sampling inside
// a frame, including on scaled windows and the single-row extras sheet.
(function (root) {
  function frameUVs(frame, row, columns, rows, width = 0, height = 0) {
    const x = width > 0 ? .5 / width : 0;
    const y = height > 0 ? .5 / height : 0;
    return { u0: frame / columns + x, u1: (frame + 1) / columns - x,
      v0: (rows - row - 1) / rows + y, v1: (rows - row) / rows - y };
  }
  if (typeof module === 'object' && module.exports) module.exports = { frameUVs };
  else root.peonFrameUVs = frameUVs;
})(globalThis);
