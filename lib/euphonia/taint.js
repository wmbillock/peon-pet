'use strict';
// Taint and echo detection. A "chain" is one user message plus the automatic follow-up turns it causes. Everything she reads
// along the way (CLI tool results, `[tool result: ...]` messages the app feeds back) is outside content: it may carry an injected
// action block. The chain records what was read, and before a write-class action becomes an approval card the engine asks
// findEcho(): does the action repeat text from that content? If so it is refused, never carded.
//
// What this can and cannot see: the app sees every tool call and tool result the CLI streams (stream.js), and every result it
// feeds back itself. It cannot see content that entered her context before this chain (an earlier turn's reads, her session
// history), and a paraphrase shares no 40-character run with its source, so it passes as "tainted but not an echo".

const ECHO_MIN_CHARS = 40;               // a verbatim run this long, shared by an action and read content, is an echo
const CORPUS_CAP_CHARS = 2_000_000;      // read content kept per chain; the oldest entries are dropped past this
const ENTRY_CAP_CHARS = 400_000;         // one tool result is clipped to this before it is kept
const SOURCES_SHOWN = 6;

const squash = (s) => String(s).replace(/\s+/g, ' ');
const noSpace = (s) => String(s).replace(/\s+/g, '');
// A JSON-encoded result ("a\nb", \"quoted\") unescaped one level, so text read through an MCP tool still lines up with plain text.
const unescapeJson = (s) => s.replace(/\\(["\\/nrt])/g, (_m, c) => ({ n: '\n', r: '\r', t: '\t' }[c] || c));

function createTaint() {
  return { sources: [], corpus: [], chars: 0, uninspected: [] };
}

// Keep what a source returned. `source` is a short label shown to the user ("Read /x/y.md", "tool result: firm_get_status").
// own: the result only acknowledges something she did herself (a file she wrote, a directory listing). It still taints the turn and
// still counts for echo detection, but it is not "content that names a path or repo" (see mentions()).
function addRead(taint, source, text, { own = false } = {}) {
  if (!taint.sources.includes(source)) taint.sources.push(source);
  const t = String(text == null ? '' : text).slice(0, ENTRY_CAP_CHARS);
  if (!t.trim()) return;
  taint.corpus.push({ source, text: t, own, cache: null });
  taint.chars += t.length;
  while (taint.chars > CORPUS_CAP_CHARS && taint.corpus.length > 1) taint.chars -= taint.corpus.shift().text.length;
}
// A tool call whose result never arrived (or whose contents were not surfaced): the chain is tainted but cannot be fully compared.
function addUninspected(taint, source) {
  if (!taint.sources.includes(source)) taint.sources.push(source);
  if (!taint.uninspected.includes(source)) taint.uninspected.push(source);
}
// A follow-up turn inherits what the chain read so far; the shared arrays are copied so a turn never edits its parent's record.
function inherit(parent) {
  const t = createTaint();
  if (!parent) return t;
  t.sources = [...parent.sources]; t.corpus = parent.corpus.map((e) => ({ ...e })); t.chars = parent.chars; t.uninspected = [...parent.uninspected];
  return t;
}
// The source of the first read content that contains `needle` (a path or repo she was asked to act on), or null. Results that only
// acknowledge her own writes and listings are skipped, so writing a brief and then launching it is not refused for naming its own path.
function mentions(taint, needle) {
  const n = squash(needle);
  if (!n || !taint) return null;
  for (const e of taint.corpus) if (!e.own && prepared(e).texts.some((t) => t.includes(n))) return e.source;
  return null;
}
const isTainted = (taint) => !!(taint && taint.sources.length);
const sourcesLabel = (taint) => {
  const s = taint ? taint.sources : [];
  return s.slice(0, SOURCES_SHOWN).join(', ') + (s.length > SOURCES_SHOWN ? `, +${s.length - SOURCES_SHOWN} more` : '');
};

// 32-bit rolling hash of every `n`-character window, to find shared runs without comparing every offset against every entry.
function windowHashes(s, n) {
  const out = new Set();
  if (s.length < n) return out;
  const B = 1000003;
  let pow = 1; for (let i = 1; i < n; i++) pow = Math.imul(pow, B);
  let h = 0;
  for (let i = 0; i < n; i++) h = (Math.imul(h, B) + s.charCodeAt(i)) | 0;
  out.add(h);
  for (let i = n; i < s.length; i++) {
    h = (Math.imul(h - Math.imul(s.charCodeAt(i - n), pow) | 0, B) + s.charCodeAt(i)) | 0;
    out.add(h);
  }
  return out;
}
const hashOne = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 1000003) + s.charCodeAt(i)) | 0; return h; };

function prepared(entry) {
  if (entry.cache) return entry.cache;
  const raw = String(entry.text);
  const texts = [squash(raw)];
  if (/\\["nrt\\]/.test(raw)) texts.push(squash(unescapeJson(raw)));
  entry.cache = { raws: /\\["nrt\\]/.test(raw) ? [raw, unescapeJson(raw)] : [raw], texts, hashes: texts.map((t) => windowHashes(t, ECHO_MIN_CHARS)), bare: texts.map(noSpace), blocks: null };
  return entry.cache;
}

function stringLeaves(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringLeaves(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => stringLeaves(x, out));
  return out;
}

const FENCE_RE = /^```(euphonia-action|management)[ \t]*\r?\n([\s\S]*?)\r?\n```/gm;
// Action blocks written out in read content, as the hash of the call each would make. Whitespace and key order do not matter.
function blockHashes(text, hashOf) {
  const out = new Set();
  for (const m of String(text).matchAll(FENCE_RE)) {
    const body = m[2].trim();
    if (m[1] === 'management') { out.add(hashOf('firm_send_to_management', { text: body })); continue; }
    try {
      const o = JSON.parse(body);
      if (o && typeof o === 'object' && typeof o.tool === 'string') out.add(hashOf(o.tool, o.args === undefined ? {} : o.args));
    } catch { /* not JSON: the shared-run check below still sees the text */ }
  }
  return out;
}

// → null, or { source, how } when the action repeats content read in this chain.
//   how 'block':  the read content holds the same action block (same tool and args), or the same call as inline JSON
//   how 'text':   a string in the args shares a run of ECHO_MIN_CHARS or more with the content, verbatim
function findEcho(taint, { tool, args }, hashOf) {
  if (!taint || !taint.corpus.length) return null;
  const want = hashOf(tool, args);
  const inline = [noSpace(JSON.stringify({ tool, args })), noSpace(JSON.stringify({ args, tool }))];
  const leaves = stringLeaves(args).map(squash).filter((s) => s.length >= ECHO_MIN_CHARS).map((text) => ({ text, hs: windowHashes(text, ECHO_MIN_CHARS) }));
  for (const entry of taint.corpus) {
    const p = prepared(entry);
    if (!p.blocks) { p.blocks = new Set(); for (const r of p.raws) for (const h of blockHashes(r, hashOf)) p.blocks.add(h); }
    if (p.blocks.has(want)) return { source: entry.source, how: 'block' };
    if (p.bare.some((b) => inline.some((x) => b.includes(x)))) return { source: entry.source, how: 'block' };
    for (const { text: leaf, hs } of leaves) {
      for (let k = 0; k < p.texts.length; k++) {
        const hay = p.texts[k]; const set = p.hashes[k];
        if (!set.size) continue;
        let hit = false;
        for (const h of hs) if (set.has(h)) { hit = true; break; }
        if (!hit) continue;
        for (let i = 0; i + ECHO_MIN_CHARS <= leaf.length; i++) {   // a hash match is a candidate; only a real shared run counts
          const w = leaf.slice(i, i + ECHO_MIN_CHARS);
          if (set.has(hashOne(w)) && hay.includes(w)) return { source: entry.source, how: 'text' };
        }
      }
    }
  }
  return null;
}

module.exports = { createTaint, addRead, addUninspected, inherit, isTainted, mentions, sourcesLabel, findEcho, ECHO_MIN_CHARS, CORPUS_CAP_CHARS, ENTRY_CAP_CHARS };
