const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('armyBridge', {
  onSessions: (cb) => ipcRenderer.on('grid-sessions', (_e, data) => cb(data)),
  ready: () => ipcRenderer.send('grid-ready'),
  openGrid: () => ipcRenderer.send('open-grid', 'grid'),
});
