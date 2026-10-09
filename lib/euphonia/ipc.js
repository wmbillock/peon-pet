'use strict';
// Wires the Euphonia service to the windows. The chat core knows nothing about Electron; this is the only glue.
//   chat window  <- euphonia-event (streaming); sends euphonia-send / -history / -reset  (the user's own UI: origin "user")
//   pet window   <- euphonia-unread {count}; sends euphonia-open-chat (the persistent button)
// The pet window is never sent chat content and never carries messages.
const { pickCue, playCue } = require('./voice');
const { createUnreadTracker } = require('./unread');
const { renderAccessLine } = require('./access');
const { DURATIONS, LEVELS } = require('./grants');

function registerEuphoniaIpc({ ipcMain, getPetWebContents, getChat, getSenders, getService, peonDir, listPacks, isMuted, getVolume, onConfigChanged = () => {}, shouldPlay = () => true, openAccessSettings = () => {}, play = playCue }) {
  const same = (wc, e) => !!wc && e.sender === wc;
  // A grant change alters what her live process was started with: start its replacement now, so servers are up before the next message.
  const restartLive = () => { try { const svc = getService(); if (svc && svc.start) svc.start(); } catch { /* the next message starts it */ } };   // policy-held approvals ride the same card path as actions (euphonia-card-decide)
  const isChat = (e) => same(getChat.webContents(), e);
  const isPet = (e) => same(getPetWebContents(), e);
  // Authority changes (grants) come from the DASHBOARD window only: not the chat window, not the pet window, and
  // nothing derived from model output has a path to these handlers.
  const isDash = (e) => !!getSenders && getSenders().includes(e.sender);
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
        if (!isMuted() && shouldPlay()) { try { play(pickCue(svc.getConfig().soundPack, peonDir()), getVolume()); } catch { /* a missing sound is never an error */ } }
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
    return { cards: svc.cards ? svc.cards() : [], records: all.slice(cut + 1).slice(-100), config: svc.getConfig(), session: svc.getSession(), active: svc.pendingTurns ? svc.pendingTurns() : { running: null, queued: [] } };
  });

  // Approval cards: ONLY the chat window can decide one. The card, not the caller, holds the payload; the caller supplies only the hash it saw.
  ipcMain.handle('euphonia-card-decide', async (e, req) => {
    if (!isChat(e)) return { ok: false, error: 'Cards can only be decided from the Euphonia chat window' };
    if (!req || typeof req.id !== 'string' || typeof req.hash !== 'string' || !['approve', 'deny'].includes(req.decision)) return { ok: false, error: 'Bad request' };
    try { return await wire().decideCard({ id: req.id, hash: req.hash, decision: req.decision }); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('euphonia-cards', (e) => (isChat(e) ? { cards: wire().cards() } : { cards: [] }));

  ipcMain.handle('euphonia-reset', (e) => (isChat(e) ? { ok: true, reset: wire().resetSession() } : { ok: false }));

  // The pet's chat button: open (or focus) the dedicated window; the pet window stays on the pet view.
  ipcMain.on('euphonia-open-chat', (e) => { if (isPet(e)) getChat.open(); });
  // The pet window asks for the current dot after it (re)loads.
  ipcMain.handle('euphonia-unread-get', (e) => { if (!isPet(e)) return { count: 0 }; wire(); return { count: tracker.refresh({ force: true }) }; });

  ipcMain.handle('euphonia-get-config', (e) => (isDash(e) ? { config: wire().getConfig(), packs: listPacks() } : null));
  ipcMain.handle('euphonia-set-config', (e, patch) => {
    if (!isDash(e)) return { ok: false, error: 'Not allowed' };
    try {
      const clean = {};
      if (patch && 'soundPack' in patch && (patch.soundPack === null || patch.soundPack === '')) clean.soundPack = null;   // no voice
      else if (patch && 'soundPack' in patch) {
        if (!listPacks().some((p) => p.name === patch.soundPack)) throw new Error(`Unknown pack: ${patch.soundPack}`);
        clean.soundPack = patch.soundPack;
      }
      for (const k of ['name', 'species', 'border', 'openChatOnLaunch', 'displayName', 'pronouns']) if (patch && k in patch) clean[k] = patch[k];   // displayName/pronouns: how she addresses the owner (user-origin, dashboard only)
      const svc = wire();
      svc.setConfig(clean);
      // Read it back from disk: a write that did not persist is reported, never assumed.
      const config = svc.getConfig();
      for (const k of Object.keys(clean)) {
        const want = k === 'name' ? String(clean[k]).trim().slice(0, 32) : (k === 'displayName' || k === 'pronouns') ? (String(clean[k] == null ? '' : clean[k]).trim() || null) : clean[k];
        if (String(config[k]) !== String(want)) throw new Error(`The ${k} setting did not persist`);
      }
      let warning = null;
      try { onConfigChanged(config); } catch (err) { warning = `Saved, but the pet could not be updated: ${err.message}`; }
      return { ok: true, config, warning };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // ---- tool access (grants) ----
  const denied = { ok: false, error: 'Tool access can only be changed from the dashboard' };
  ipcMain.handle('euphonia-access-get', (e) => {
    if (!isDash(e)) return { ok: false, error: 'Not allowed' };
    const svc = wire();
    const found = svc.discoverServers();
    return { ok: true, servers: found.servers, errors: found.errors, grants: svc.grants.list(), durations: DURATIONS, levels: LEVELS };
  });
  ipcMain.handle('euphonia-access-set', (e, req) => {
    if (!isDash(e)) return denied;
    try { const entry = wire().grants.grant({ server: req && req.server, level: req && req.level, duration: req && req.duration }); restartLive(); return { ok: true, grant: entry, grants: wire().grants.list() }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
  // One click: read access, until revoked, on every server that is connected right now, then learn their tool names so
  // it works on the very next message. Reads only; writes still need a write grant and your reply. Dashboard window only.
  ipcMain.handle('euphonia-access-grant-connected', async (e) => {
    if (!isDash(e)) return denied;
    try {
      const svc = wire();
      const names = svc.discoverServers().servers.filter((x) => x.status === 'connected').map((x) => x.name);
      for (const server of names) svc.grants.grant({ server, level: 'read', duration: 'blanket' });
      let learned = {};
      restartLive();
      try { learned = await svc.learnTools(); } catch (err) { return { ok: true, granted: names, learned: {}, warning: `Granted, but could not learn tool names yet (${err.message}). Send her one message and they will be learned.`, grants: svc.grants.list() }; }
      return { ok: true, granted: names, learned, grants: svc.grants.list() };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('euphonia-access-revoke', (e, req) => {
    if (!isDash(e)) return denied;
    const svc = wire();
    if (req && req.all) svc.grants.revokeAll(); else if (req && req.server) svc.grants.revoke(String(req.server)); else return { ok: false, error: 'Nothing to revoke' };
    restartLive();
    return { ok: true, grants: svc.grants.list() };
  });
  // Read-only summary for the chat window's indicator, which may look but never change anything.
  ipcMain.handle('euphonia-access-summary', (e) => {
    if (!allowed(e)) return { text: 'none' };
    return { text: renderAccessLine(wire().grants.list()) };
  });
  ipcMain.on('euphonia-open-access', (e) => { if (isChat(e)) openAccessSettings(); });

  return { refreshUnread: () => { wire(); return tracker.refresh({ force: true }); }, onChatActiveChange: () => { if (wired) tracker.refresh(); } };
}

module.exports = { registerEuphoniaIpc };
