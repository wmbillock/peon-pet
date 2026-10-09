'use strict';
// Append-only audit of every bridge call, allowed or refused. Free text is logged by length only; no secrets, no bodies.
const fs = require('fs');
const path = require('path');

const FREE_TEXT = new Set(['text', 'body', 'title']);

function summarize(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (typeof v === 'string') out[k] = FREE_TEXT.has(k) ? { chars: v.length } : v.slice(0, 60);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else out[k] = '[object]';
  }
  return out;
}

function createAudit({ file, now = () => new Date() }) {
  return {
    file,
    log(tool, args, status, detail) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.appendFileSync(file, JSON.stringify({ ts: now().toISOString(), tool, args: summarize(args), status, ...(detail ? { detail: String(detail).slice(0, 200) } : {}) }) + '\n', { mode: 0o600 });
        return true;
      } catch { return false; }   // callers refuse a write whose attempt could not be recorded
    },
  };
}

module.exports = { createAudit, summarize };
