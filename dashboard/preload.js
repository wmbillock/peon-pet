const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashBridge', {
  onSessions: (cb) => ipcRenderer.on('dash-sessions', (_e, data) => cb(data)),
  onSoundState: (cb) => ipcRenderer.on('sound-state', (_e, data) => cb(data)),
  toggleSound: () => ipcRenderer.send('sound-toggle'),
  ready: () => ipcRenderer.send('dash-ready'),
  getPacks: () => ipcRenderer.invoke('packs-get'),
  setSessionPack: (sessionId, name) => ipcRenderer.invoke('packs-set-session', sessionId, name),
  setVolume: (v) => ipcRenderer.invoke('packs-set-volume', v),
  setCategory: (cat, on) => ipcRenderer.invoke('packs-set-category', cat, on),
  setNotifications: (on) => ipcRenderer.invoke('packs-set-notifications', on),
  getPixoo: () => ipcRenderer.invoke('pixoo-get'),
  setPixoo: (cfg) => ipcRenderer.invoke('pixoo-set', cfg),
  onPixooState: (cb) => ipcRenderer.on('pixoo-state', (_e, d) => cb(d)),
  getChars: () => ipcRenderer.invoke('chars-get'),
  setChar: (name) => ipcRenderer.invoke('chars-set', name),
  audition: (name) => ipcRenderer.invoke('packs-audition', name),
  setGlobalPack: (name, applyToSessions) => ipcRenderer.invoke('packs-set-global', name, applyToSessions),
});
