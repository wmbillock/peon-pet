'use strict';
// Unread bookkeeping for the chat button's dot. Pure, plus a tracker over an injected service.
// An assistant message is unread when it is newer than the persisted last-read marker. Messages that
// arrive while the chat window is focused and showing are read as they land.
const assistantMsgs = (records) => (records || []).filter((r) => r && r.role === 'assistant' && r.ts);

function latestAssistant(records) {
  const a = assistantMsgs(records);
  return a.length ? a[a.length - 1] : null;
}

// marker: { ts, id } | null. Compared by ts (ISO strings sort), id breaks ties for equal timestamps.
function countUnread(records, marker) {
  const a = assistantMsgs(records);
  if (!marker || !marker.ts) return a.length;
  const idx = marker.id ? a.findIndex((r) => r.turnId === marker.id && r.ts === marker.ts) : -1;
  if (idx >= 0) return a.length - idx - 1;
  return a.filter((r) => r.ts > marker.ts).length;
}

function createUnreadTracker({ service, isChatActive, notify }) {
  let last = null;
  function refresh({ force = false } = {}) {
    const records = service.history(1000);
    if (isChatActive()) {
      const m = latestAssistant(records);
      if (m) service.setReadMarker({ ts: m.ts, id: m.turnId });
    }
    const count = countUnread(records, service.getReadMarker());
    if (force || count !== last) { last = count; notify(count); }
    return count;
  }
  return { refresh };
}

module.exports = { countUnread, latestAssistant, createUnreadTracker };
