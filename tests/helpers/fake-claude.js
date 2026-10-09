'use strict';
// A fake `claude` CLI for the Euphonia suites. It never calls a provider. It speaks both shapes the service uses:
//   per-turn:   `claude -p ...` with the message on stdin; the script runs once stdin ends, and the process exits after its reply.
//   persistent: `--input-format stream-json`; stdin stays open; the script runs once per user line; the process stays
//               until the service ends its stdin (exit 0) or kills it.
// script(child, call, n): call = { cmd, args, opts, stdin: <the user's text, header stripped>, full: <text as sent>, proc, n }.
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

function textOf(line) {
  try { const o = JSON.parse(line); const c = o.message && o.message.content; return Array.isArray(c) ? c.map((b) => b.text || '').join('') : String(c || ''); } catch { return line; }
}
// The service puts an access header above the user's text; most tests care about the text after "[Message]".
function messageOf(full) { const mark = '\n[Message]\n'; const i = full.lastIndexOf(mark); return i >= 0 ? full.slice(i + mark.length) : full; }

function fakeClaude(script, { init = null, onControl = null } = {}) {
  const calls = [], procs = [];
  const spawnImpl = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    const persistent = args.includes('--input-format');
    const proc = { cmd, args, opts, child, persistent, messages: [], closed: false, inited: false, exitCode: undefined };
    procs.push(proc);
    proc.close = (code) => { if (proc.closed) return; proc.closed = true; proc.exitCode = code; try { child.stdout.end(); } catch { /* already ended */ } setImmediate(() => child.emit('close', code)); };
    child.kill = () => { child.killed = true; proc.close(null); };
    child.proc = proc;
    let buf = '';
    const fire = (full) => {
      const call = { cmd, args, opts, stdin: messageOf(full), full, proc, n: calls.length + 1 };
      calls.push(call); proc.messages.push(call.stdin);
      setImmediate(() => { if (!proc.closed) script(child, call, calls.length); });
    };
    child.stdin.on('data', (d) => {
      buf += d;
      if (!persistent) return;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let o = null; try { o = JSON.parse(line); } catch { /* not JSON */ }
        if (o && o.type && o.type !== 'user') { proc.control = proc.control || []; proc.control.push(o); if (onControl) setImmediate(() => onControl(child, o, proc)); continue; }   // control_response etc.
        fire(textOf(line));
      }
    });
    child.stdin.on('end', () => { if (persistent) proc.close(0); else fire(buf); });
    child.stdin.resume();
    if (persistent && init) setImmediate(() => { if (proc.closed) return; const o = typeof init === 'function' ? init(proc) : init; if (o) { proc.inited = true; child.stdout.write(JSON.stringify(o) + '\n'); } });
    return child;
  };
  return { spawnImpl, calls, procs };
}

const line = (o) => JSON.stringify(o) + '\n';
const delta = (text) => line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
// A complete reply: init (once per process), message_start, deltas, result. Per-turn: the process then exits 0. Persistent: it stays.
function okReply(child, sessionId, parts, { init = {}, result = {} } = {}) {
  const proc = child.proc;
  if (!proc.inited) { proc.inited = true; child.stdout.write(line({ type: 'system', subtype: 'init', session_id: sessionId, ...init })); }
  child.stdout.write(line({ type: 'stream_event', event: { type: 'message_start' } }));
  for (const p of parts) child.stdout.write(delta(p));
  child.stdout.write(line({ type: 'result', subtype: 'success', is_error: false, result: parts.join(''), session_id: sessionId, ...result }));
  if (!proc.persistent) proc.close(0);
}
// The process dies: optional stderr, then exit with `code`.
function exit(child, code, stderr) { if (stderr) child.stderr.write(stderr); child.proc.close(code); }

module.exports = { fakeClaude, okReply, exit, line, delta, textOf, messageOf };
