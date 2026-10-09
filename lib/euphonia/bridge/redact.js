'use strict';
// Strips common secret shapes from text before it leaves the app. Best effort, not a guarantee: callers also never return tool
// outputs or file contents, so only conversation text ever reaches this.
const MARK = '[redacted]';

const RULES = [
  // A private key block, closed or cut off by truncation (then everything after the header goes).
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g, MARK],
  [/\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[A-Z0-9]{16}\b/g, MARK],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, MARK],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, MARK],
  [/\bxox[abposr]-[A-Za-z0-9-]{8,}/g, MARK],
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/g, MARK],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, MARK],   // JWT
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${MARK}`],
  // password= / token= / secret= / api_key: value (also JSON "password": "x" and quoted values)
  [/(\b[A-Za-z0-9_.-]*(?:password|passwd|pwd|token|secret|api[_-]?key|apikey|access[_-]?key)[A-Za-z0-9_.-]*["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s"',;&]+)/gi, `$1${MARK}`],
  // .env style KEY=VALUE where the name contains KEY, SECRET, TOKEN or PASSWORD
  [/(\b[A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s"']+)/g, `$1${MARK}`],
];

const INPUT_CAP = 20000;   // bounds regex work on a huge pasted blob; the caller truncates much shorter afterwards

function redact(text) {
  let s = String(text == null ? '' : text);
  if (s.length > INPUT_CAP) s = s.slice(0, INPUT_CAP);
  for (const [re, to] of RULES) s = s.replace(re, to);
  return s;
}

// Redact first, THEN cut, so a secret straddling the cut cannot leak its first half.
function clean(text, max) {
  const s = redact(text).replace(/\0/g, '').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

module.exports = { redact, clean, MARK };
