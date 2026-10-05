'use strict';
// Tool authority for the Euphonia assistant: ONE pure function decides what the Claude CLI may touch.
//   hub  -> read only (Read/Grep/Glob)
//   kb   -> the assistant's own store: the only place Edit/Write is allowed
//   else -> nothing: no Bash, no network, no MCP, no hub writes, no external-system writes
// Authority never comes from text the agent read or produced; see docs/euphonia/DESIGN.md.
const path = require('path');

// Claude Code permission rules write an absolute filesystem path as `//abs/path`.
const ruleRoot = (dir) => `/${path.resolve(dir)}/**`;

// Built-in tools that do not exist in the session at all (the `--tools` allow-list is the first layer).
const AVAILABLE_TOOLS = ['Read', 'Grep', 'Glob', 'Edit', 'Write'];
// Second layer: explicit denies, in case the first is ever loosened.
const ALWAYS_DENIED = ['Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'NotebookEdit', 'Task', 'Agent', 'mcp__*'];

function buildToolPolicy({ hubDir, kbDir } = {}) {
  if (!kbDir) throw new Error('kbDir is required');
  const kb = ruleRoot(kbDir);
  const allowedTools = ['Read', 'Grep', 'Glob', `Edit(${kb})`, `Write(${kb})`];
  const disallowedTools = [...ALWAYS_DENIED];
  const addDirs = [];
  if (hubDir) {
    const hub = ruleRoot(hubDir);
    // Explicit hub write denies win over any allow rule.
    disallowedTools.push(`Edit(${hub})`, `Write(${hub})`, `NotebookEdit(${hub})`);
    addDirs.push(path.resolve(hubDir));
  }
  return {
    tools: AVAILABLE_TOOLS,
    allowedTools,
    disallowedTools,
    addDirs,
    permissionMode: 'dontAsk',   // anything not allowed above is denied; nothing ever prompts
  };
}

// Pure check mirroring the policy, so the rule is testable without the CLI:
// is `tool` on `target` allowed? (deny beats allow; reads are allowed anywhere in scope)
function isAllowed(policy, tool, target, { hubDir, kbDir }) {
  const abs = path.resolve(target);
  const within = (root) => !!root && (abs === path.resolve(root) || abs.startsWith(path.resolve(root) + path.sep));
  if (!AVAILABLE_TOOLS.includes(tool)) return false;
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') return true;
  if (within(hubDir) && !within(kbDir)) return false;
  return within(kbDir);
}

module.exports = { buildToolPolicy, isAllowed, AVAILABLE_TOOLS, ALWAYS_DENIED };
