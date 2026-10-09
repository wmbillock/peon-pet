'use strict';
// `claude mcp list` without a model call: the CLI health-checks every configured MCP server and prints one line each.
// Wording verified on 2026-10-07 (v2.1.289):
//   buildkite: https://mcp.buildkite.com/mcp/readonly (HTTP) - ✓ Connected
//   lucid: https://mcp.lucid.app/mcp (HTTP) - ! Needs authentication
//   pagerduty: sh -c ... - ✗ Failed to connect — CONNECTION_CLOSED: Connection closed
// followed by "MCP config diagnostics" lines, which carry no status. The command part can contain anything (shell text),
// so the status is whatever follows the LAST " - " on the line. It took about a minute here with 18 servers.

const PROBE_TIMEOUT_MS = 120000;

function statusOf(tail) {
  const t = tail.trim();
  if (/Failed to connect|^[✗✗]/.test(t)) return 'failed';
  if (/Needs authentication/i.test(t)) return 'needs-auth';
  if (/^[✓✓]|\bConnected\b/.test(t)) return 'connected';
  return 'unknown';
}

// → { servers: { name: { status, detail } }, count }
function parseMcpList(text) {
  const servers = {};
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();   // strip any colour codes
    const colon = line.indexOf(': ');
    const dash = line.lastIndexOf(' - ');
    if (colon <= 0 || dash < colon) continue;
    const name = line.slice(0, colon).trim();
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) continue;   // the diagnostics tail ("Location: ...", "[Warning] ...") never matches
    const tail = line.slice(dash + 3).trim();
    const status = statusOf(tail);
    if (status === 'unknown' && !/connect|auth/i.test(tail)) continue;   // a line with " - " that is not a status line
    servers[name] = { status, detail: tail.replace(/^[✓✗!✓✗]\s*/, '').slice(0, 160) };
  }
  return { servers, count: Object.keys(servers).length };
}

// Runs the probe. Resolves { ok: true, servers, ms } or { ok: false, error, ms }; never rejects, never throws.
function probeMcpList({ spawnImpl, bin = 'claude', env = process.env, cwd, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    let child;
    let out = '', err = '';
    let done = false;
    let timer = null;
    const fin = (r) => { if (done) return; done = true; clearTimeout(timer); resolve({ ...r, ms: Date.now() - started }); };
    try { child = spawnImpl(bin, ['mcp', 'list'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return fin({ ok: false, error: `could not start claude mcp list: ${e.message}` }); }
    timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } fin({ ok: false, error: `claude mcp list did not finish within ${Math.round(timeoutMs / 1000)} s` }); }, timeoutMs);
    child.on('error', (e) => fin({ ok: false, error: `claude mcp list failed: ${e.message}` }));
    if (child.stdout) child.stdout.on('data', (d) => { out += d; });
    if (child.stderr) child.stderr.on('data', (d) => { err = (err + d).slice(-1000); });
    child.on('close', (code) => {
      const parsed = parseMcpList(out);
      if (code !== 0 && !parsed.count) return fin({ ok: false, error: `claude mcp list exited ${code}${err.trim() ? `: ${err.trim().split('\n').pop().slice(0, 160)}` : ''}` });
      if (!parsed.count) return fin({ ok: false, error: 'claude mcp list printed no server lines' });
      fin({ ok: true, servers: parsed.servers });
    });
  });
}

module.exports = { parseMcpList, probeMcpList, statusOf, PROBE_TIMEOUT_MS };
