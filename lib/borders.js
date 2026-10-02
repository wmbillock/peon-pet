// Selectable frame styles. `file` is relative to renderer/assets; null = "use the pet's own border".
const BORDERS = [
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
  { id: 'kitty',        label: 'Kitty',       file: 'hello-kitty-borders.png' },
  { id: 'capybara',     label: 'Capybara',    file: 'capybara-borders.png' },
];

const byId = (id) => BORDERS.find((b) => b.id === id);

module.exports = { BORDERS, byId };
