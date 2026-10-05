'use strict';
// Pure launch decisions for the pet window and chat window.
const RESERVED_ID = 'euphonia';
const DEFAULT_BORDER = 'neon-cyan';

// The pet window no longer has a chat view. A saved cornerView of 'chat' (older builds) becomes 'pet'.
function migrateCornerView(saved, views) {
  return views.includes(saved) ? saved : 'pet';
}

// openChatOnLaunch means "open the dedicated chat window at launch". Default false: the persistent
// chat button on the lead pet (with its unread dot) is the primary way in.
function shouldOpenChatOnLaunch({ openChatOnLaunch = false, leadId }) {
  return openChatOnLaunch === true && leadId === RESERVED_ID;
}

const species = (cfg) => [cfg.species, 'trillian', 'orc'].filter(Boolean);

module.exports = { RESERVED_ID, DEFAULT_BORDER, migrateCornerView, shouldOpenChatOnLaunch, species };
