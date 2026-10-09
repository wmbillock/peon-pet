'use strict';
// One voice at a time. At any moment a single agent holds the "voice focus", and only its cues should play.
//   1. A connected Pixoo: whoever the Pixoo is showing right now.
//   2. Otherwise the agent on screen in the main window for the selected corner view (pet view = the lead).
//      While Euphonia's chat window is focused, the chat is "the main chat" and she holds the focus.
//   3. Nothing resolvable: the lead pet's voice. Never all voices, never silence for lack of an answer.
// Pure: no Electron, no timers. main.js feeds it the live facts and re-asks whenever one of them changes.
const EUPHONIA_ID = 'euphonia';
const MODES = ['active-display', 'all'];

function resolveVoiceFocus({ pixooConnected = false, pixooShowing = null, cornerView = 'pet', visibleAgentId = null, leadId = null, chatWindowFocused = false } = {}) {
  if (pixooConnected && pixooShowing) return { agentId: pixooShowing, reason: 'pixoo' };
  if (chatWindowFocused) return { agentId: EUPHONIA_ID, reason: 'chat' };
  if (cornerView !== 'pet' && visibleAgentId) return { agentId: visibleAgentId, reason: 'view' };
  if (cornerView === 'pet' && leadId) return { agentId: leadId, reason: 'view' };
  return { agentId: leadId || null, reason: leadId ? 'fallback-lead' : 'none' };
}

// The single gate every sound path asks. `focus` is resolveVoiceFocus(...).agentId.
//   'all'            -> today's behaviour: everything plays.
//   'active-display' -> only the focused agent; Euphonia's own cue also plays whenever her chat window is focused.
function shouldPlay({ mode = 'active-display', agentId, focus, chatWindowFocused = false }) {
  if (mode === 'all') return true;
  if (!agentId || !focus) return false;           // unknown speaker or no focus: silent, never "everyone"
  if (agentId === EUPHONIA_ID && chatWindowFocused) return true;
  return agentId === focus;
}

// Which single agent a corner view is showing, from the session list. Views that show a group
// (grid) have no single agent, so they return null and the focus falls back to the lead.
// sessions: [{ id, hot, lastActive, rank, role, isRoot }]
function pickVisibleAgent(cornerView, sessions = []) {
  const roots = sessions.filter((s) => s.isRoot !== false);
  const recent = (a, b) => (b.lastActive || 0) - (a.lastActive || 0);
  if (cornerView === 'speaker') { const w = roots.filter((s) => s.hot).sort(recent)[0]; return w ? w.id : null; }
  if (cornerView === 'presenter') {
    const m = roots.filter((s) => s.role === 'master' || s.rank === 0).sort((a, b) => (b.hot ? 1 : 0) - (a.hot ? 1 : 0) || recent(a, b))[0];
    return m ? m.id : null;
  }
  return null;
}

const cleanMode = (m) => (MODES.includes(m) ? m : 'active-display');

module.exports = { resolveVoiceFocus, shouldPlay, pickVisibleAgent, cleanMode, EUPHONIA_ID, MODES };
