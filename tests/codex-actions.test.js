const { codexToolCalls } = require('../lib/codex-actions');
const { classifyTool } = require('../lib/tool-actions');

const actions = (p) => codexToolCalls(p).map((c) => classifyTool(c.tool, c.input));

test('exec calls carry their commands inside JavaScript: each is pulled out and classified', () => {
  const p = { type: 'custom_tool_call', name: 'exec', input: 'const r = await tools.exec_command({cmd:"gh pr merge 12 --squash", workdir:"/w"}); const t = await tools.exec_command({cmd:"cat README.md"});' };
  expect(codexToolCalls(p).map((c) => c.input.command)).toEqual(['gh pr merge 12 --squash', 'cat README.md']);
  expect(actions(p)).toEqual(['merge', null]);
});

test('apply_patch is an edit; shell function calls take array or string commands', () => {
  expect(actions({ type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch' })).toEqual(['edit-code']);
  expect(actions({ type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'npx jest tests/a'] }) })).toEqual(['run-tests']);
  expect(actions({ type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'kubectl apply -f x.yaml' }) })).toEqual(['deploy']);
});

test('anything unreadable yields no calls, never a guess', () => {
  expect(codexToolCalls(null)).toEqual([]);
  expect(codexToolCalls({ type: 'message' })).toEqual([]);
  expect(codexToolCalls({ type: 'function_call', arguments: 'not json' })).toEqual([]);
  expect(codexToolCalls({ type: 'custom_tool_call', name: 'exec', input: 'doSomethingElse()' })).toEqual([]);
});
