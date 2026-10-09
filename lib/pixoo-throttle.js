'use strict';
// How long to hold back the next Pixoo update. The display is fiddly hardware, so by default it hears from us at most
// once a minute; whatever is current when the wait ends is what gets sent (updates in between are coalesced).
const DEFAULT_MIN_INTERVAL_SEC = 60;
const MAX_MIN_INTERVAL_SEC = 3600;

const cleanInterval = (v, fallback = DEFAULT_MIN_INTERVAL_SEC) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== null ? Math.min(MAX_MIN_INTERVAL_SEC, Math.max(0, Math.round(n))) : fallback;
};

// → milliseconds to wait before sending (0 = send now). `force` is for things a person just did (turning it on, a new look).
function waitMs({ lastSentAt, now, minIntervalSec, force = false }) {
  if (force || !lastSentAt) return 0;
  return Math.max(0, lastSentAt + cleanInterval(minIntervalSec) * 1000 - now);
}

module.exports = { waitMs, cleanInterval, DEFAULT_MIN_INTERVAL_SEC, MAX_MIN_INTERVAL_SEC };
