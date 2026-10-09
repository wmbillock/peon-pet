'use strict';
// Pure launch decisions for the pet window and chat window.
const RESERVED_ID = 'euphonia';
const DEFAULT_BORDER = 'neon-cyan';
// Shipped default art: original and already published (weeping-willow is in the published repo). A local choice such as a
// third-party character lives only in the owner's own config.json, never here.
const DEFAULT_SPECIES = 'weeping-willow';

// The pet window no longer has a chat view. A saved cornerView of 'chat' (older builds) becomes 'pet'.
function migrateCornerView(saved, views) {
  return views.includes(saved) ? saved : 'pet';
}

// openChatOnLaunch means "open the dedicated chat window at launch". Default false: the persistent
// chat button on the lead pet (with its unread dot) is the primary way in.
function shouldOpenChatOnLaunch({ openChatOnLaunch = false, leadId }) {
  return openChatOnLaunch === true && leadId === RESERVED_ID;
}

const species = (cfg) => [cfg.species, DEFAULT_SPECIES, 'orc'].filter(Boolean);

module.exports = { RESERVED_ID, DEFAULT_BORDER, DEFAULT_SPECIES, migrateCornerView, shouldOpenChatOnLaunch, species };
