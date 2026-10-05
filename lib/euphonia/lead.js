'use strict';
// Keeps Euphonia's roster entry (the pet the owner sees and can rename in the Pets tab) and her own config.json in step.
// Rule: the owner's edit always wins, wherever it was made. Startup never overwrites an edit; it mirrors the roster
// into the config instead. A settings change updates the roster; a Pets-tab edit writes through to the config.
const { RESERVED_ID, species } = require('./launch');

// roster: { pinReserved(spec) -> pet, update(id, patch) -> pet }
function startupPin({ roster, svc }) {
  const cfg = svc.getConfig();
  const pet = roster.pinReserved({ id: RESERVED_ID, name: cfg.name, species: species(cfg) });
  if (pet.name !== cfg.name || pet.species !== cfg.species) svc.setConfig({ name: pet.name, species: pet.species });
  return pet;
}

// The owner changed the name or species in Euphonia's settings: the roster follows.
function applyConfigToLead({ roster, svc }) {
  const cfg = svc.getConfig();
  return roster.update(RESERVED_ID, { name: cfg.name, species: cfg.species });
}

// The owner edited the pet in the Pets tab or Forge: the config follows, so the settings, the chat header and the
// window title all show the same name. Anything but the reserved pet is ignored.
function mirrorLeadToConfig({ svc, pet }) {
  if (!pet || pet.id !== RESERVED_ID) return null;
  return svc.setConfig({ name: pet.name, species: pet.species });
}

module.exports = { startupPin, applyConfigToLead, mirrorLeadToConfig };
