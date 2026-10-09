// Shared by the Markdown renderer and Electron's navigation guard.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EuphoniaChatLinks = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  function webUrl(value) {
    if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value)) return null;
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
      return url.href;
    } catch { return null; }
  }
  return { webUrl };
});
