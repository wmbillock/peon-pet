// HTML in replies stays literal. Only Markdown-generated elements enter the DOM.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('markdown-it'), require('../lib/euphonia/chat-links'));
  else root.EuphoniaMarkdown = factory(root.markdownit, root.EuphoniaChatLinks);
})(typeof window === 'undefined' ? globalThis : window, function (MarkdownIt, { webUrl }) {
  const md = new MarkdownIt({ html: false, linkify: false, breaks: true });
  // A reply cannot trigger remote image requests merely by appearing in the transcript.
  md.disable('image');
  md.validateLink = (url) => !!webUrl(url);
  return { render: (text) => md.render(String(text || '')) };
});
