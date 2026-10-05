'use strict';
// Wires the Euphonia service to the windows. The chat core knows nothing about Electron; this is the only glue.
//   chat window  <- euphonia-event (streaming); sends euphonia-send / -history / -reset  (the user's own UI: origin "user")
//   pet window   <- euphonia-unread {count}; sends euphonia-open-chat (the persistent button)
// The pet window is never sent chat content and never carries messages.
const { pickCue, playCue } = require('./voice');
const { createUnreadTracker } = require('./unread');

function registerEuphoniaIpc({ ipcMain, getPetWebContents, getChat, getSenders, getService, peonDir, listPacks, isMuted, getVolume, onConfigChanged = () => {}, play = playCue }) {
  const same = (wc, e) => !!wc && e.sender === wc;
  const isChat = (e) => same(getChat.webContents(), e);
  const isPet = (e) => same(getPetWebContents(), e);
  const allowed = (e) => isChat(e) || (getSenders ? getSenders().includes(e.sender) : false);
  let wired = false;
  let tracker = null;

  const sendTo = (wc, ch, payload) => { if (wc && !wc.isDestroyed()) wc.send(ch, payload); };

  function wire() {
    if (wired) return getService();
    wired = true;
    const svc = getService();
    tracker = createUnreadTracker({
      service: svc,
      isChatActive: () => getChat.isActive(),
      notify: (count) => sendTo(getPetWebContents(), 'euphonia-unread', { count }),
    });
    svc.subscribe((ev) => {
      sendTo(getChat.webContents(), 'euphonia-event', ev);
      if (ev.type === 'done') {
        tracker.refresh();
        if (!isMuted()) { try { play(pickCue(svc.getConfig().soundPack, peonDir()), getVolume()); } catch { /* a missing sound is never an error */ } }
      }
    });
    return svc;
  }

  ipcMain.handle('euphonia-send', (e, text) => {
    if (!isChat(e)) return { ok: false, error: 'Chat is only accepted from the Euphonia chat window' };
    try { return { ok: true, turnId: wire().send(text, { origin: 'user' }).turnId }; }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('euphonia-history', (e) => {
    if (!allowed(e)) return { records: [], config: null };
    const svc = wire();
    const all = svc.history(300);
    const cut = all.map((r) => r.role).lastIndexOf('system');   // the window shows the current conversation only
    return { records: all.slice(cut + 1).slice(-100), config: svc.getConfig(), session: svc.getSession(), active: svc.pendingTurns ? svc.pendingTurns() : { running: null, queued: [] } };
  });

  ipcMain.handle('euphonia-reset', (e) => (isChat(e) ? { ok: true, reset: wire().resetSession() } : { ok: false }));

  // The pet's chat button: open (or focus) the dedicated window; the pet window stays on the pet view.
  ipcMain.on('euphonia-open-chat', (e) => { if (isPet(e)) getChat.open(); });
  // The pet window asks for the current dot after it (re)loads.
  ipcMain.handle('euphonia-unread-get', (e) => { if (!isPet(e)) return { count: 0 }; wire(); return { count: tracker.refresh({ force: true }) }; });

  ipcMain.handle('euphonia-get-config', (e) => (allowed(e) ? { config: wire().getConfig(), packs: listPacks() } : null));
  ipcMain.handle('euphonia-set-config', (e, patch) => {
    if (!allowed(e)) return { ok: false, error: 'Not allowed' };
    try {
      const clean = {};
      if (patch && 'soundPack' in patch) {
        if (!listPacks().some((p) => p.name === patch.soundPack)) throw new Error(`Unknown pack: ${patch.soundPack}`);
        clean.soundPack = patch.soundPack;
      }
      for (const k of ['species', 'border', 'openChatOnLaunch']) if (patch && k in patch) clean[k] = patch[k];
      const config = wire().setConfig(clean);
      try { onConfigChanged(config); } catch { /* the setting is saved either way */ }
      return { ok: true, config };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  return { refreshUnread: () => { wire(); return tracker.refresh({ force: true }); }, onChatActiveChange: () => { if (wired) tracker.refresh(); } };
}

module.exports = { registerEuphoniaIpc };
