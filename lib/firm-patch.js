'use strict';
// Build the edits that add Peon Pet's feature requests to The Firm's own files:
//   projects/the-firm/ROADMAP.md      new entries at the top of "## Next"
//   projects/the-firm/swarm/TASKS.md  one row per request, with the next free T-NNNN ids
// Pure text transforms, so they can be tested and re-run against any version of those files.

const TASK_ID = /\bT-(\d{4})\b/g;

// Entries are the `- **P…` bullets under the "Entries for `## Next`" heading of our requests file.
function parseEntries(markdown) {
  const start = markdown.search(/^## Entries for `## Next`/m);
  if (start < 0) throw new Error('No "Entries for `## Next`" section found');
  const rest = markdown.slice(start).split('\n').slice(1);
  const out = [];
  for (const line of rest) {
    if (/^## /.test(line)) break;
    if (/^- \*\*P\d\*\*/.test(line)) out.push(line.trimEnd());
  }
  if (!out.length) throw new Error('No roadmap entries found');
  return out;
}

// Rows are the `| T-???? …` lines of the "Draft task rows" table: [title, source, definition of done].
function parseTaskRows(markdown) {
  const rows = [];
  for (const line of markdown.split('\n')) {
    const m = /^\| T-\?{4} (.+?) \| (.+?) \| (.+) \|$/.exec(line);
    if (m) rows.push({ title: m[1].trim(), source: m[2].trim(), done: m[3].trim() });
  }
  if (!rows.length) throw new Error('No draft task rows found');
  return rows;
}

// Highest T-NNNN anywhere in the given texts (TASKS.md rows and the names of claim files).
function maxTaskId(...texts) {
  let max = 0;
  for (const t of texts) for (const m of String(t).matchAll(TASK_ID)) max = Math.max(max, Number(m[1]));
  return max;
}

function insertRoadmapEntries(roadmap, entries) {
  const lines = roadmap.split('\n');
  const i = lines.findIndex((l) => l.trim() === '## Next');
  if (i < 0) throw new Error('ROADMAP.md has no "## Next" section');
  // New entries go at the top of the section, after the blank line that follows the heading.
  const at = lines[i + 1] === '' ? i + 2 : i + 1;
  const already = new Set(lines.filter((l) => l.startsWith('- **P')));
  const fresh = entries.filter((e) => !already.has(e));
  if (!fresh.length) return roadmap;
  lines.splice(at, 0, ...fresh);
  return lines.join('\n');
}

// Append rows to the task table (the last run of `| T-…` lines), allocating ids after `startAfter`.
function appendTaskRows(tasks, rows, startAfter, source = 'Peon Pet integration') {
  const lines = tasks.split('\n');
  let last = -1;
  lines.forEach((l, i) => { if (/^\| T-\d{4} /.test(l)) last = i; });
  if (last < 0) throw new Error('TASKS.md has no task rows');
  let id = startAfter;
  const existing = lines.join('\n');
  const added = [];
  for (const r of rows) {
    if (existing.includes(`| ${r.title} |`)) continue;   // already filed
    id += 1;
    added.push(`| T-${String(id).padStart(4, '0')} | ${r.title} | ${source}: \`docs/firm/ROADMAP-entries.md\` (${r.source}) | ${r.done} | open |`);
  }
  lines.splice(last + 1, 0, ...added);
  return { text: lines.join('\n'), added };
}

module.exports = { parseEntries, parseTaskRows, maxTaskId, insertRoadmapEntries, appendTaskRows };
