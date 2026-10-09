const { readManagedPolicy, heldBy } = require('../lib/euphonia/managed-policy');
const { computeMcpAccess, renderAccessBlock } = require('../lib/euphonia/access');

const settings = JSON.stringify({ permissions: { allow: ['mcp__playwright-local-verify__browser_navigate'], ask: ['mcp__playwright__browser_navigate', 'Bash(rm:*)', 'mcp__jira__createJiraIssue'], deny: ['mcp__slack__slack_send_message', 'WebFetch'] } });

test('reads only mcp rules from ask and deny; a missing file is empty, a broken one reports an error', () => {
  const p = readManagedPolicy({ platform: 'darwin', readFile: () => settings });
  expect([...p.ask]).toEqual(['mcp__playwright__browser_navigate', 'mcp__jira__createJiraIssue']);
  expect([...p.deny]).toEqual(['mcp__slack__slack_send_message']);
  expect(p.error).toBeNull();
  const missing = readManagedPolicy({ readFile: () => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; } });
  expect(missing.ask.size + missing.deny.size).toBe(0); expect(missing.error).toBeNull();
  expect(readManagedPolicy({ readFile: () => '{not json' }).error).toMatch(/could not parse/);
  expect(heldBy(new Set(['mcp__x']), 'mcp__x__anything', 'x')).toBe(true);
  expect(heldBy(new Set(['mcp__x__*']), 'mcp__x__anything', 'x')).toBe(true);
  expect(heldBy(new Set(['mcp__x__a']), 'mcp__x__b', 'x')).toBe(false);
});

test('a tool the managed policy asks for is never promised to her, whatever the grant; the headless server stays usable', () => {
  const managed = readManagedPolicy({ readFile: () => settings });
  const catalog = { servers: {
    playwright: { tools: ['browser_navigate', 'browser_snapshot', 'browser_click'] },
    'playwright-local-verify': { tools: ['browser_navigate', 'browser_snapshot'] },
    jira: { tools: ['getJiraIssue', 'createJiraIssue'] },
  } };
  const grants = [{ server: 'playwright', level: 'write' }, { server: 'playwright-local-verify', level: 'read' }, { server: 'jira', level: 'write' }];
  const mcp = computeMcpAccess({ grants, catalog, configured: Object.keys(catalog.servers), managed });
  expect(mcp.allow).not.toContain('mcp__playwright__browser_navigate');
  expect(mcp.deny).toContain('mcp__playwright__browser_navigate');
  expect(mcp.allow).toEqual(expect.arrayContaining(['mcp__playwright__browser_snapshot', 'mcp__playwright__browser_click', 'mcp__playwright-local-verify__browser_navigate', 'mcp__playwright-local-verify__browser_snapshot', 'mcp__jira__getJiraIssue']));
  expect(mcp.allow).not.toContain('mcp__jira__createJiraIssue');
  const pw = mcp.summary.find((s) => s.server === 'playwright');
  expect(pw.held).toEqual(['browser_navigate']);
  expect(renderAccessBlock(mcp.summary)).toMatch(/playwright: write.*Held by this machine's managed policy.*browser_navigate/);
  expect(renderAccessBlock(mcp.summary)).not.toMatch(/playwright-local-verify: read.*Held/);
  // without a policy object nothing changes
  expect(computeMcpAccess({ grants, catalog, configured: [] }).allow).toContain('mcp__playwright__browser_navigate');
});

test('tool names the policy lists are known before the server ever connects, so a slow starter is still callable', () => {
  const settings = JSON.stringify({ permissions: {
    allow: ['mcp__playwright-local-verify__browser_navigate', 'mcp__playwright-local-verify__browser_snapshot', 'mcp__jira__getJiraIssue', 'mcp__weird__*', 'Read'],
    ask: ['mcp__playwright-local-verify__browser_tabs'], deny: ['mcp__slack__slack_send_message'],
  } });
  const managed = readManagedPolicy({ readFile: () => settings });
  expect(managed.known['playwright-local-verify']).toEqual(['browser_navigate', 'browser_snapshot', 'browser_tabs']);
  expect(managed.known.jira).toEqual(['getJiraIssue']);
  expect(managed.known.slack).toEqual(['slack_send_message']);
  expect(managed.known.weird).toBeUndefined();
  // her catalog knows nothing about the server yet (status pending, no tools)
  const catalog = { servers: { 'playwright-local-verify': { status: 'pending', tools: [] } } };
  const mcp = computeMcpAccess({ grants: [{ server: 'playwright-local-verify', level: 'read' }], catalog, configured: ['playwright-local-verify'], managed });
  expect(mcp.allow).toEqual(['mcp__playwright-local-verify__browser_navigate', 'mcp__playwright-local-verify__browser_snapshot']);
  expect(mcp.deny).toContain('mcp__playwright-local-verify__browser_tabs');   // held by ask
  const s = mcp.summary[0];
  expect(s.discovered).toBe(true);
  expect(s.names).toEqual(['browser_navigate', 'browser_snapshot']);
  expect(renderAccessBlock(mcp.summary)).toMatch(/Tools you may call: browser_navigate, browser_snapshot/);
});
