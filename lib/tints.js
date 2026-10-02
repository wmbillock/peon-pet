// Translucent colour filters laid over a pet so several of one species can be told apart.
// rgb 0-255, alpha 0-1. The same table drives the desktop overlay, the grid tiles and the Pixoo.
const TINTS = [
  { id: 'none',   label: 'None',    rgb: [0, 0, 0],       alpha: 0 },
  { id: 'red',    label: 'Red',     rgb: [255, 60, 60],   alpha: 0.30 },
  { id: 'orange', label: 'Orange',  rgb: [255, 150, 40],  alpha: 0.30 },
  { id: 'gold',   label: 'Gold',    rgb: [255, 215, 60],  alpha: 0.28 },
  { id: 'lime',   label: 'Lime',    rgb: [150, 255, 60],  alpha: 0.28 },
  { id: 'mint',   label: 'Mint',    rgb: [60, 255, 170],  alpha: 0.28 },
  { id: 'cyan',   label: 'Cyan',    rgb: [50, 220, 255],  alpha: 0.30 },
  { id: 'blue',   label: 'Blue',    rgb: [70, 110, 255],  alpha: 0.32 },
  { id: 'violet', label: 'Violet',  rgb: [160, 90, 255],  alpha: 0.32 },
  { id: 'pink',   label: 'Pink',    rgb: [255, 100, 200], alpha: 0.30 },
  { id: 'ghost',  label: 'Ghost',   rgb: [255, 255, 255], alpha: 0.38 },
  { id: 'shadow', label: 'Shadow',  rgb: [0, 0, 20],      alpha: 0.38 },
  { id: 'sepia',  label: 'Sepia',   rgb: [150, 100, 40],  alpha: 0.34 },
];

const byId = (id) => TINTS.find((t) => t.id === id);
const isTint = (id) => typeof id === 'string' && !!byId(id);
const cssColor = (id) => {
  const t = byId(id);
  return t && t.alpha > 0 ? `rgba(${t.rgb[0]},${t.rgb[1]},${t.rgb[2]},${t.alpha})` : 'transparent';
};
// Tints worth cycling through when auto-creating several pets (skips none/ghost/shadow/sepia).
const CYCLE = ['red', 'blue', 'lime', 'violet', 'orange', 'cyan', 'pink', 'gold', 'mint'];

module.exports = { TINTS, byId, isTint, cssColor, CYCLE };
