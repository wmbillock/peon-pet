'use strict';
// Pure launch decisions for the pet window.
const RESERVED_ID = 'euphonia';
const DEFAULT_BORDER = 'neon-cyan';

// Which corner view the window opens in. Euphonia leads, so by default it opens on her chat;
// set openChatOnLaunch to false in her config.json to restore the last-used view instead.
function initialCornerView({ saved, views, openChatOnLaunch = true, leadId }) {
  if (openChatOnLaunch !== false && leadId === RESERVED_ID && views.includes('chat')) return 'chat';
  return views.includes(saved) ? saved : 'pet';
}

// What a click on the lead sprite does: with Euphonia leading, it opens her chat.
function clickTarget({ isEuphoniaLead, cornerView, views }) {
  if (isEuphoniaLead && cornerView === 'pet') return 'chat';
  const i = views.indexOf(cornerView);
  return views[(i + 1) % views.length];
}

const species = (cfg) => [cfg.species, 'trillian', 'orc'].filter(Boolean);

module.exports = { RESERVED_ID, DEFAULT_BORDER, initialCornerView, clickTarget, species };
