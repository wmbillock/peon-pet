'use strict';
// What a tool call is, in the permission model's terms (lib/permissions.js ACTIONS). null = not worth judging
// (planning aids, harness chatter). Deterministic and conservative: an unknown tool is never a violation.
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'NotebookRead']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'WebSearch', 'WebFetch']);

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs)\//i;
const TEST_FILE = /(\.|_)(test|spec)\.[a-z0-9]+$|(^|\/)test_[^/]+$/i;
const NOTE_FILE = /\.(md|mdx|txt|rst)$/i;

function classifyBash(cmd) {
  const c = String(cmd || '');
  if (/\bgh\s+pr\s+merge\b|\bgit\s+merge\b/.test(c)) return 'merge';
  if (/\bkubectl\s+(apply|rollout)\b|\bhelm\s+(install|upgrade)\b|\bterraform\s+apply\b|\bgarden\s+deploy\b|\bdeploy(\.sh)?\b/.test(c)) return 'deploy';
  if (/\bgh\s+pr\s+review\b[^|;&]*--approve\b|\bgh\s+pr\s+approve\b/.test(c)) return 'approve';
  if (/\bgh\s+pr\s+(review|comment)\b/.test(c)) return 'comment';
  if (/\b(pytest|jest|vitest|mocha|go\s+test|cargo\s+test|npm\s+(run\s+)?test|yarn\s+test|make\s+test)\b/.test(c)) return 'run-tests';
  if (/\bgit\s+(commit|push|apply|checkout\s+--|reset\s+--hard)\b/.test(c) || /\b(sed\s+-i|tee\b)/.test(c)) return 'edit-code';
  return null;
}

function classifyTool(name, input = {}) {
  const n = String(name || '');
  const i = input && typeof input === 'object' ? input : {};
  if (WRITE_TOOLS.has(n)) {
    const p = String(i.file_path || i.notebook_path || i.path || '');
    if (TEST_PATH.test(p) || TEST_FILE.test(p)) return 'write-tests';
    if (NOTE_FILE.test(p)) return 'write-notes';
    return 'edit-code';
  }
  if (READ_TOOLS.has(n)) return 'read';
  if (SEARCH_TOOLS.has(n)) return 'search';
  if (n === 'Bash') return classifyBash(i.command);
  if (n === 'Task' || n === 'Agent') return 'spawn-agent';
  if (/^mcp__slack__.*(send|post|schedule)/i.test(n)) return 'message-human';
  return null;
}

module.exports = { classifyTool, classifyBash };
