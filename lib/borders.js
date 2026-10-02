// Selectable frame styles. `file` is relative to renderer/assets; null = "use the pet's own border".
const ALL_BORDERS = [
  { id: 'default',      label: 'Pet default', file: null },
  { id: 'none',         label: 'None',        file: 'borders/none.png' },
  { id: 'thin',         label: 'Thin',        file: 'borders/thin.png' },
  { id: 'wood',         label: 'Wood',        file: 'orc-borders.png' },
  { id: 'gold',         label: 'Gold',        file: 'borders/gold.png' },
  { id: 'stone',        label: 'Stone',       file: 'borders/stone.png' },
  { id: 'neon-cyan',    label: 'Neon cyan',   file: 'borders/neon-cyan.png' },
  { id: 'neon-pink',    label: 'Neon pink',   file: 'borders/neon-pink.png' },
  { id: 'pastel',       label: 'Pastel',      file: 'borders/pastel.png' },
  { id: 'crt',          label: 'CRT bezel',   file: 'borders/crt.png' },
  // Dynamic frames are drawn live (see dash/dash.css and the corner window), so their file is the blank one.
  { id: 'dyn-status',    label: 'Status glow',   file: 'borders/none.png', dynamic: 'status' },
  { id: 'dyn-glow',      label: 'Project glow',  file: 'borders/none.png', dynamic: 'glow' },
  { id: 'dyn-chase',     label: 'Neon chase',    file: 'borders/none.png', dynamic: 'chase' },
  { id: 'dyn-rainbow',   label: 'Rainbow',       file: 'borders/none.png', dynamic: 'rainbow' },
  { id: 'kitty',        label: 'Kitty',       file: 'hello-kitty-borders.png' },
  { id: 'capybara',     label: 'Capybara',    file: 'capybara-borders.png' },
];

// A distribution build may leave some art out (lib/dist-filter.js): keep only frames whose file is present.
const fs = require('fs');
const path = require('path');
const ASSETS = path.join(__dirname, '../renderer/assets');
const BORDERS = ALL_BORDERS.filter((b) => !b.file || fs.existsSync(path.join(ASSETS, b.file)));

const byId = (id) => BORDERS.find((b) => b.id === id);

module.exports = { BORDERS, byId };
