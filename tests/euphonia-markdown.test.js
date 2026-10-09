const { render } = require('../renderer/chat-markdown');
const { webUrl } = require('../lib/euphonia/chat-links');
const { createChatWindowManager } = require('../lib/euphonia/chat-window');

test('the screenshot-style reply renders bold, bullets and literal code paths', () => {
  const html = render('`Projects/Notes and Performance/example.md`\n\n- **What it says:** summary\n- **Next:** do it');
  expect(html).toContain('<code>Projects/Notes and Performance/example.md</code>');
  expect(html).toContain('<ul>');
  expect(html).toContain('<strong>What it says:</strong>');
  expect(html).not.toContain('**What');
});

test('headings, nested lists, tables and fenced code retain structure', () => {
  const html = render('# Plan\n\n1. First\n   - Child\n\n| Agent | Task |\n| --- | --- |\n| Clinician | Review |\n\n```js\nif (x < 2) run();\n```');
  for (const tag of ['<h1>', '<ol>', '<ul>', '<table>', '<pre><code class="language-js">']) expect(html).toContain(tag);
  expect(html).toContain('x &lt; 2');
});

test('HTML and script payloads remain visible text, never active elements', () => {
  const html = render('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n<a href="javascript:alert(1)">click</a>');
  expect(html).not.toMatch(/<(script|img|a)\b/);
  expect(html).toContain('&lt;script&gt;');
});

test.each(['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', 'obsidian://open?vault=x', 'https://user:password@example.com', '//example.com', '/local/note.md'])('unsafe or unsupported links stay text: %s', (url) => {
  expect(webUrl(url)).toBeNull();
  expect(render(`[link](${url})`)).not.toContain('<a ');
});

test('web links render and images cannot fetch remote content', () => {
  expect(render('[Libretto](https://github.com/Affirm/affirm-builders)')).toContain('<a href="https://github.com/Affirm/affirm-builders">Libretto</a>');
  expect(render('![tracking](https://example.com/pixel.png)')).not.toContain('<img');
  expect(render('<https://example.com/path>')).toContain('<a href="https://example.com/path">');
});

test('streaming incomplete markup stays readable and reparses when completed', () => {
  expect(render('Here is **bo')).toContain('**bo');
  expect(render('Here is **bold**')).toContain('<strong>bold</strong>');
  expect(render('```js\nconst x = 1')).toContain('<pre><code');
});

test('chat navigation always stays in the app; only web URLs reach the browser opener', async () => {
  const handlers = {}, openExternal = jest.fn();
  class BW {
    constructor() { this.webContents = { on: (name, fn) => { handlers[name] = fn; }, setWindowOpenHandler: (fn) => { handlers.popup = fn; } }; }
    loadFile() {} on() {}
  }
  createChatWindowManager({ BrowserWindow: BW, loadBounds: () => ({}), saveBounds: () => {}, file: 'chat/index.html', openExternal }).open();
  expect(openExternal).not.toHaveBeenCalled();
  const event = { preventDefault: jest.fn() };
  handlers['will-navigate'](event, 'https://example.com/note');
  expect(event.preventDefault).toHaveBeenCalled();
  expect(handlers.popup({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' });
  handlers['will-navigate'](event, 'javascript:alert(1)');
  await Promise.resolve();
  expect(openExternal.mock.calls).toEqual([['https://example.com/note']]);
});
