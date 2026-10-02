const { parseEntries, parseTaskRows, maxTaskId, insertRoadmapEntries, appendTaskRows } = require('../lib/firm-patch');

const REQUESTS = `# Feature requests

## Entries for \`## Next\` (new entries go at the top of the section)

- **P1** First thing · S · reason one (main.py:1)
- **P2** Second thing · M · reason two
not a bullet
- **P3** Third · S · reason three

## Draft task rows for \`swarm/TASKS.md\`

| Task | Source | Definition of done |
|---|---|---|
| T-???? First task | entry 1 | it works; tests pass |
| T-???? Second task | entry 2 (after T-0003) | it works too |

## Later section
- **P1** Not an entry (wrong section)
`;

const ROADMAP = `# Roadmap

## Shipped

- **Old** thing

## Next

- **P0** Existing urgent · M · reason
- **P1** Existing other · S · reason

## Later
`;

const TASKS = `# Task queue

| ID | Task | Source | Definition of done | Status |
|---|---|---|---|---|
| T-0001 | One | s | d | open |
| T-0004 | Four | s | d | open |

Notes below the table.
`;

test('parseEntries takes only the P-bullets of the right section', () => {
  expect(parseEntries(REQUESTS)).toEqual([
    '- **P1** First thing · S · reason one (main.py:1)', '- **P2** Second thing · M · reason two', '- **P3** Third · S · reason three']);
  expect(() => parseEntries('# nothing')).toThrow(/No "Entries/);
});

test('parseTaskRows reads title, source and definition of done', () => {
  const rows = parseTaskRows(REQUESTS);
  expect(rows).toEqual([
    { title: 'First task', source: 'entry 1', done: 'it works; tests pass' },
    { title: 'Second task', source: 'entry 2 (after T-0003)', done: 'it works too' }]);
  expect(() => parseTaskRows('| T-0001 | x | y | z |')).toThrow(/No draft task rows/);
});

test('maxTaskId looks across rows and claim file names', () => {
  expect(maxTaskId(TASKS, 'projects/the-firm/swarm/claims/T-0005.md\nT-0002.md')).toBe(5);
  expect(maxTaskId('nothing')).toBe(0);
});

test('entries go at the very top of "## Next", above existing ones, and nothing else moves', () => {
  const out = insertRoadmapEntries(ROADMAP, parseEntries(REQUESTS));
  const lines = out.split('\n');
  const next = lines.indexOf('## Next');
  expect(lines.slice(next + 1, next + 5)).toEqual(['', '- **P1** First thing · S · reason one (main.py:1)', '- **P2** Second thing · M · reason two', '- **P3** Third · S · reason three']);
  expect(lines[next + 5]).toBe('- **P0** Existing urgent · M · reason');
  expect(out.replace(/- \*\*P[123]\*\* (First|Second|Third)[^\n]*\n/g, '')).toBe(ROADMAP);   // only additions
});

test('re-running adds nothing twice', () => {
  const once = insertRoadmapEntries(ROADMAP, parseEntries(REQUESTS));
  expect(insertRoadmapEntries(once, parseEntries(REQUESTS))).toBe(once);
  const t1 = appendTaskRows(TASKS, parseTaskRows(REQUESTS), 5);
  expect(appendTaskRows(t1.text, parseTaskRows(REQUESTS), 7).added).toEqual([]);
});

test('task rows continue the table with the next free ids and stay inside it', () => {
  const { text, added } = appendTaskRows(TASKS, parseTaskRows(REQUESTS), maxTaskId(TASKS, 'T-0005'));
  expect(added.map((r) => r.slice(0, 10))).toEqual(['| T-0006 |', '| T-0007 |']);
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => l.startsWith('| T-0004'));
  expect(lines[idx + 1]).toMatch(/^\| T-0006 \| First task \|/);
  expect(lines[idx + 2]).toMatch(/^\| T-0007 \| Second task \|/);
  expect(text).toContain('Notes below the table.');
  expect(added[0]).toMatch(/\| open \|$/);
  expect(() => appendTaskRows('# no table', parseTaskRows(REQUESTS), 0)).toThrow(/no task rows/);
});
