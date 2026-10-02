// Friendly default names for new pets.
const POOL = [
  'Pip', 'Bolt', 'Miso', 'Gruk', 'Nova', 'Waffles', 'Juniper', 'Biscuit', 'Comet', 'Tofu',
  'Zephyr', 'Mochi', 'Ember', 'Pickle', 'Sprocket', 'Maple', 'Orbit', 'Noodle', 'Fizz', 'Clover',
  'Bandit', 'Pebble', 'Sage', 'Rocket', 'Truffle', 'Dot', 'Gizmo', 'Poppy', 'Quill', 'Rue',
];

function suggestName(taken = []) {
  const used = new Set(taken.map((n) => String(n).toLowerCase()));
  const free = POOL.find((n) => !used.has(n.toLowerCase()));
  if (free) return free;
  for (let i = 2; ; i++) {
    const n = `${POOL[(i - 2) % POOL.length]} ${i}`;
    if (!used.has(n.toLowerCase())) return n;
  }
}

module.exports = { POOL, suggestName };
