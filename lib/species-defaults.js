// Built-in species metadata. Users can override any field (stored separately, never in the repo).
// `localOnly` marks art that must not ship in a distribution (e.g. third-party characters).
const f = (key, value) => ({ key, value });

module.exports = {
  orc: { display: 'Orc Peon', brief: 'A muscular green-skinned Warcraft-style orc in spiked red-brown leather pauldrons, seated at a desk in a dark stone dungeon.', localOnly: false,
    facts: [f('Origin', 'The original Peon Pet mascot')] },
  capybara: { display: 'Capybara', brief: 'A calm capybara lounging at a laptop beside a sunny hot-spring pool.', localOnly: false, facts: [] },
  'hello-kitty': { display: 'Hello Kitty', brief: 'A pink Hello Kitty-themed desk scene with a heart-covered laptop.', localOnly: true,
    facts: [f('Note', 'Third-party character — keep local, not for distribution')] },
  'retro-robot': { display: 'Retro Robot', brief: 'A tiny retro robot with a glowing visor, antenna and orange ear pods.', localOnly: false, facts: [] },
  'terra-ff6': { display: 'Terra (FFVI)', brief: 'Terra Branford from Final Fantasy VI in SNES-era pixel art.', localOnly: true,
    facts: [f('Note', 'Third-party character — keep local, not for distribution')] },
  'weeping-willow': { display: 'Weeping Willow', brief: 'A small anthropomorphic talking weeping willow tree with a carved face and branch arms.', localOnly: false, facts: [] },
  'bearded-dragon': { display: 'Beardie', brief: 'A bearded dragon lizard, anthropomorphized just enough to sit and use a laptop.', localOnly: false,
    facts: [f('Behavior', 'Head-bobs to assert dominance; arm-waves to acknowledge others')] },
  'clipart-trumpet': { display: 'Trumpet', brief: 'A golden clipart-style brass trumpet with cartoon eyes, arms and feet.', localOnly: false, facts: [] },
  'eighth-note': { display: 'Eighth Note', brief: 'A living eighth note with a notehead face, one stem and one flag.', localOnly: false, facts: [] },
  'lcd-creature': { display: 'LCD Pal', brief: 'A Tamagotchi-style egg-shaped LCD pet with a pixel face and three buttons.', localOnly: false, facts: [] },
};
