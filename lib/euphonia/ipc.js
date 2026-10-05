'use strict';
// Wires the Euphonia service to the pet window. The chat core knows nothing about Electron; this is
// the only glue. Messages are accepted from the PET window alone, and only those carry origin "user".
const { pickCue, playCue } = require('./voice');

function registerEuphoniaIpc({ ipcMain, getPetWebContents, getSenders, getService, peonDir, listPacks, isMuted, getVolume, onConfigChanged = () => {}, play = playCue }) {
  const isPet = (e) => { const wc = getPetWebContents(); return !!wc && e.sender === wc; };
  const allowed = (e) => isPet(e) || (getSenders ? getSenders().includes(e.sender) : false);
  let wired = false;

  function wire() {
    if (wired) return getService();
    wired = true;
    const svc = getService();
    svc.subscribe((ev) => {
      const wc = getPetWebContents();
      if (wc && !wc.isDestroyed()) wc.send('euphonia-event', ev);
      if (ev.type === 'done' && !isMuted()) {
        try { play(pickCue(svc.getConfig().soundPack, peonDir()), getVolume()); } catch { /* a missing sound is never an error */ }
      }
    });
    return svc;
  }

  ipcMain.handle('euphonia-send', (e, text) => {
    if (!isPet(e)) return { ok: false, error: 'Chat is only accepted from the pet window' };
    try { return { ok: true, turnId: wire().send(text, { origin: 'user' }).turnId }; }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('euphonia-history', (e) => {
    if (!allowed(e)) return { records: [], config: null };
    const svc = wire();
    return { records: svc.history(100), config: svc.getConfig(), session: svc.getSession() };
  });

  ipcMain.handle('euphonia-reset', (e) => (isPet(e) ? { ok: true, reset: wire().resetSession() } : { ok: false }));

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
}

module.exports = { registerEuphoniaIpc };
