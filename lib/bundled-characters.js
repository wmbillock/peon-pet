// Per-character asset maps: canonical name → bundled filename (under renderer/assets).
// Anything a character doesn't list (borders.png, bg.png, ...) falls back to the orc's.
const withIcon = (slug) => ({
  'sprite-atlas.png': `${slug}-sprite-atlas.png`,
  'dock-icon.png':    `${slug}-dock-icon.png`,
});

module.exports = {
  orc: {
    'sprite-atlas.png': 'orc-sprite-atlas.png',
    'borders.png':      'orc-borders.png',
    'bg.png':           'bg-pixel.png',
    'dock-icon.png':    'orc-dock-icon.png',
  },
  capybara: {
    'sprite-atlas.png': 'capybara-sprite-atlas.png',
    'borders.png':      'capybara-borders.png',
    'dock-icon.png':    'capybara-dock-icon.png',
  },
  'hello-kitty': {
    'sprite-atlas.png': 'hello-kitty-sprite-atlas.png',
    'borders.png':      'hello-kitty-borders.png',
    'dock-icon.png':    'hello-kitty-dock-icon.png',
  },
  'retro-robot':     withIcon('retro-robot'),
  'terra-ff6':       withIcon('terra-ff6'),
  'weeping-willow':  withIcon('weeping-willow'),
  'bearded-dragon':  withIcon('bearded-dragon'),
  'clipart-trumpet': withIcon('clipart-trumpet'),
  'eighth-note':     withIcon('eighth-note'),
  'lcd-creature':    withIcon('lcd-creature'),
};
