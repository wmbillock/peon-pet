'use strict';
// Maps `claude -p --output-format stream-json --verbose --include-partial-messages` lines onto the
// few events the chat cares about. Pure: feed it text, get callbacks.
//   {kind:'session', id}    first sight of the CLI session id (system init or result)
//   {kind:'delta', text}    assistant text, as it streams
//   {kind:'break'}          a new assistant message began inside the same turn
//   {kind:'tool', name}     a tool call started (name only; arguments are never surfaced)
//   {kind:'result', isError, text, sessionId}
function createStreamParser(emit) {
  let buf = '';
  let sawPartialText = false;     // once true, whole `assistant` text blocks would double-print
  const seenTools = new Set();

  function handle(o) {
    if (!o || typeof o !== 'object') return;
    if (o.session_id && (o.type === 'system' || o.type === 'result')) emit({ kind: 'session', id: o.session_id });
    if (o.type === 'stream_event' && o.event) {
      const e = o.event;
      if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta' && e.delta.text) {
        sawPartialText = true;
        emit({ kind: 'delta', text: e.delta.text });
      } else if (e.type === 'content_block_start' && e.content_block && e.content_block.type === 'tool_use') {
        if (e.content_block.id) seenTools.add(e.content_block.id);
        emit({ kind: 'tool', name: String(e.content_block.name || '') });
      } else if (e.type === 'message_start' && sawPartialText) {
        emit({ kind: 'break' });   // a new assistant message in the same turn (after a tool call)
      }
    } else if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      for (const b of o.message.content) {
        if (b.type === 'text' && b.text && !sawPartialText) emit({ kind: 'delta', text: b.text });
        else if (b.type === 'tool_use' && !seenTools.has(b.id)) { seenTools.add(b.id); emit({ kind: 'tool', name: String(b.name || '') }); }
      }
    } else if (o.type === 'result') {
      emit({ kind: 'result', isError: !!o.is_error || (o.subtype && o.subtype !== 'success'), text: typeof o.result === 'string' ? o.result : '', sessionId: o.session_id || null });
    }
  }

  function line(s) {
    const t = s.trim();
    if (!t) return;
    let o;
    try { o = JSON.parse(t); } catch { return; }   // stray non-JSON output is ignored, never fatal
    handle(o);
  }
  return {
    push(chunk) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
    },
    end() { line(buf); buf = ''; },
    sawPartialText: () => sawPartialText,
  };
}

module.exports = { createStreamParser };
