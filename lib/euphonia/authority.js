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
const ALWAYS_DENIED = ['Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'NotebookEdit', 'Task', 'Agent'];

// mcp: { allow, deny } from access.computeMcpAccess (grants the user made in the dashboard). Without it, every MCP
// tool is denied. Only `mcp__` rules can come through this path: Bash and hub writes can never be granted.
function buildToolPolicy({ hubDir, kbDir, mcp = null } = {}) {
  if (!kbDir) throw new Error('kbDir is required');
  const kb = ruleRoot(kbDir);
  const allowedTools = ['Read', 'Grep', 'Glob', `Edit(${kb})`, `Write(${kb})`];
  const disallowedTools = [...ALWAYS_DENIED];
  if (mcp) {
    allowedTools.push(...mcp.allow.filter((r) => /^mcp__/.test(r)));
    disallowedTools.push(...mcp.deny.filter((r) => /^mcp__/.test(r)));
  } else disallowedTools.push('mcp__*');
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

// Pure mirror of how the rules resolve for a tool name: deny beats allow; anything not allowed is denied (dontAsk).
function isToolAllowed(policy, tool) {
  const matches = (rule) => rule === tool || (rule === 'mcp__*' && tool.startsWith('mcp__')) || (/^mcp__[^*]+$/.test(rule) && tool.startsWith(`${rule}__`));
  if (policy.disallowedTools.some(matches)) return false;
  return policy.allowedTools.includes(tool);
}

module.exports = { isToolAllowed, buildToolPolicy, isAllowed, AVAILABLE_TOOLS, ALWAYS_DENIED };
