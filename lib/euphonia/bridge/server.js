'use strict';
// The MCP stdio transport, the subset a client needs: newline-delimited JSON-RPC 2.0 with initialize, tools/list, tools/call, ping.
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

function createMcpServer({ name, version, defs, call }) {
  const tools = defs.map((d) => ({
    name: d.name, description: d.description,
    inputSchema: { type: 'object', properties: d.schema || {}, required: d.required || [], additionalProperties: false },
  }));
  const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
  const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  async function handle(msg) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return err(msg && msg.id !== undefined ? msg.id : null, -32600, 'Invalid request');
    const isNote = msg.id === undefined;
    switch (msg.method) {
      case 'initialize': {
        const want = msg.params && msg.params.protocolVersion;
        return ok(msg.id, { protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[0], capabilities: { tools: {} }, serverInfo: { name, version } });
      }
      case 'ping': return isNote ? null : ok(msg.id, {});
      case 'tools/list': return ok(msg.id, { tools });
      case 'tools/call': {
        const p = msg.params || {};
        const r = await call(String(p.name), p.arguments && typeof p.arguments === 'object' ? p.arguments : {});
        return ok(msg.id, { content: [{ type: 'text', text: r.text }], isError: !!r.isError });
      }
      default:
        return isNote ? null : err(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  }

  // Feed it stdin chunks; it writes one JSON line per response through `write`.
  function attach(write) {
    let buf = '';
    return {
      async push(chunk) {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { write(JSON.stringify(err(null, -32700, 'Parse error'))); continue; }
          let res;
          try { res = await handle(msg); } catch (e) { res = err(msg.id !== undefined ? msg.id : null, -32603, e.message); }
          if (res) write(JSON.stringify(res));
        }
      },
    };
  }
  return { handle, attach, tools };
}

module.exports = { createMcpServer };
