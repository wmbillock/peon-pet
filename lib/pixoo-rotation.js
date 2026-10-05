'use strict';
// What the Pixoo shows when it rotates between the lead and the active agents. Pure: main.js owns the timers and the
// hardware. The slot on screen is what voice focus follows (resolveVoiceFocus gets it as `pixooShowing`).
const DEFAULT_ROTATE_SEC = 60;
const MIN_ROTATE_SEC = 10;
const DEFAULT_CAP = 6;
const ATTENTION_MS = 120000;

const needsAttention = (a, now) => (a.anim === 'alarmed' || a.anim === 'annoyed') && now - (a.animAt || 0) < ATTENTION_MS;

// The rotation order: the lead first, then agents needing attention, then the ones working, then the rest that are
// still open, capped at `cap` slots in total (the lead always keeps one). Only top-level agents rotate.
function selectRotation({ lead, agents = [], cap = DEFAULT_CAP, now = Date.now() }) {
  const leadId = lead ? lead.id : null;
  const rank = (a) => (needsAttention(a, now) ? 0 : a.hot ? 1 : 2);
  const live = agents
    .filter((a) => a && a.id !== leadId && a.isRoot !== false && (a.hot || a.warm || needsAttention(a, now)))
    .sort((a, b) => rank(a) - rank(b) || (b.lastActive || 0) - (a.lastActive || 0) || String(a.id).localeCompare(String(b.id)));
  const n = Number(cap);
  const room = Math.max(1, Math.floor(Number.isFinite(n) ? n : DEFAULT_CAP));
  const out = leadId ? [leadId] : [];
  for (const a of live) { if (out.length >= room) break; out.push(a.id); }
  return out;
}

// Never faster than the Pixoo's own update limit: that limit (at most one send per interval, newest state wins) stays in
// force in main.js; this only stops the rotation from asking for more than it allows.
function effectiveIntervalSec({ rotateSeconds, minIntervalSec } = {}) {
  const r = Number(rotateSeconds);
  return Math.max(MIN_ROTATE_SEC, Number.isFinite(r) ? r : DEFAULT_ROTATE_SEC, Number(minIntervalSec) || 0);
}

// state: { showing, switchedAt, index } -> next state. A pin holds one agent (if it is still around). When the agent on
// screen disappears mid-cycle, the slot it vacated is taken by whoever moved up, at once.
function rotateStep({ list, state = {}, pin = null, now = Date.now(), intervalSec = DEFAULT_ROTATE_SEC }) {
  if (!list.length) return { showing: null, switchedAt: now, index: 0 };
  const hold = (showing) => ({ showing, switchedAt: state.showing === showing ? state.switchedAt : now, index: list.indexOf(showing) });
  if (pin && list.includes(pin)) return hold(pin);
  if (!state.showing) return hold(list[0]);
  const at = list.indexOf(state.showing);
  if (at < 0) return hold(list[Math.min(Math.max(0, state.index || 0), list.length - 1)]);
  if (list.length > 1 && now - (state.switchedAt || 0) >= intervalSec * 1000) return hold(list[(at + 1) % list.length]);
  return { showing: state.showing, switchedAt: state.switchedAt, index: at };
}

module.exports = { selectRotation, rotateStep, effectiveIntervalSec, DEFAULT_ROTATE_SEC, MIN_ROTATE_SEC, DEFAULT_CAP };
