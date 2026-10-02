// Per-character asset maps: canonical name → bundled filename (under renderer/assets).
// Anything a character doesn't list (borders.png, bg.png, ...) falls back to the orc's.
const withIcon = (slug) => ({
  'sprite-atlas.png': `${slug}-sprite-atlas.png`,
  'dock-icon.png':    `${slug}-dock-icon.png`,
});

const ALL = {
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
  'bearded-dragon':  { ...withIcon('bearded-dragon'), 'extras.png': 'bearded-dragon-extras.png' },
  'clipart-trumpet': withIcon('clipart-trumpet'),
  'eighth-note':     withIcon('eighth-note'),
  'lcd-creature':    withIcon('lcd-creature'),
};

// A distribution build leaves local-only art out (see lib/dist-filter.js): list only characters whose atlas is present.
const fs = require('fs');
const path = require('path');
const ASSETS = path.join(__dirname, '../renderer/assets');
module.exports = Object.fromEntries(Object.entries(ALL).filter(([name, map]) => name === 'orc' || fs.existsSync(path.join(ASSETS, map['sprite-atlas.png']))));
