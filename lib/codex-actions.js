'use strict';
// Codex's tool calls, as the same {tool, input} pairs the Claude watcher emits, so the monitor judges both alike.
// A Codex rollout records them as response_item payloads:
//   custom_tool_call  name "exec"   input: JavaScript such as `await tools.exec_command({cmd:"git status", workdir:"..."})`
//   custom_tool_call  name "apply_patch" (or a patch inside exec input)
//   function_call     name "shell" / "exec_command"   arguments: JSON string with command (array or string) or cmd
// Parsing is deliberately conservative: anything it cannot read yields no calls, never a guess.
const CMD_IN_JS = /\bcmd\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;

function unquote(lit) {
  try { return lit[0] === '"' ? JSON.parse(lit) : lit.slice(1, -1).replace(/\\(.)/g, '$1'); } catch { return null; }
}

function fromArguments(args) {
  let a = args;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { return []; } }
  if (!a || typeof a !== 'object') return [];
  const c = a.command ?? a.cmd;
  const cmd = Array.isArray(c) ? c.map(String).join(' ') : (typeof c === 'string' ? c : null);
  return cmd ? [{ tool: 'Bash', input: { command: cmd } }] : [];
}

// payload: the record's payload object → [{ tool, input }]
function codexToolCalls(p) {
  if (!p || typeof p !== 'object') return [];
  const t = p.type;
  if (t === 'function_call' || t === 'local_shell_call') return fromArguments(p.arguments ?? p.action);
  if (t !== 'custom_tool_call') return [];
  const input = typeof p.input === 'string' ? p.input : '';
  const out = [];
  if (p.name === 'apply_patch' || /\bapply_patch\b/.test(input)) out.push({ tool: 'Edit', input: { file_path: '' } });   // a patch edits code
  if (p.name === 'exec' || /\btools\.exec_command\b/.test(input)) {
    for (const m of input.matchAll(CMD_IN_JS)) { const cmd = unquote(m[1]); if (cmd) out.push({ tool: 'Bash', input: { command: cmd } }); }
  }
  return out;
}

module.exports = { codexToolCalls };
