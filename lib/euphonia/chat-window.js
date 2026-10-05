'use strict';
// The dedicated Euphonia chat window. One instance: opening again focuses it. Closing hides the window's
// existence only; the service, session and transcript are untouched. Electron is injected for tests.
const DEFAULT_SIZE = { width: 400, height: 560 };
const MIN = { width: 320, height: 360 };

function createChatWindowManager({ BrowserWindow, getTitle = () => 'Euphonia', loadBounds, saveBounds, webPreferences, file, onActiveChange = () => {}, debounceMs = 400, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout }) {
  let win = null;
  let timer = null;

  const alive = () => !!win && !win.isDestroyed();
  const isActive = () => alive() && win.isVisible() && !win.isMinimized() && win.isFocused();

  function remember() {
    clearTimeoutImpl(timer);
    timer = setTimeoutImpl(() => { if (alive()) saveBounds(win.getBounds()); }, debounceMs);
  }

  function open() {
    if (alive()) {
      if (win.isMinimized()) win.restore();
      win.show(); win.focus();
      return win;
    }
    const b = loadBounds() || {};
    win = new BrowserWindow({
      width: b.width || DEFAULT_SIZE.width, height: b.height || DEFAULT_SIZE.height,
      ...(Number.isFinite(b.x) && Number.isFinite(b.y) ? { x: b.x, y: b.y } : {}),
      minWidth: MIN.width, minHeight: MIN.height,
      title: getTitle(), backgroundColor: '#0c0c14', resizable: true, focusable: true, show: true,
      webPreferences,
    });
    const w = win;
    w.loadFile(file);
    for (const ev of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore']) w.on(ev, () => onActiveChange(isActive()));
    w.on('move', remember);
    w.on('resize', remember);
    w.on('closed', () => {
      clearTimeoutImpl(timer);
      if (win === w) win = null;
      onActiveChange(false);
    });
    return w;
  }

  return {
    open, isActive, isOpen: alive,
    setTitle: (t) => { if (alive()) win.setTitle(String(t)); },
    webContents: () => (alive() ? win.webContents : null),
    close: () => { if (alive()) win.close(); },
  };
}

module.exports = { createChatWindowManager, DEFAULT_SIZE, MIN };
