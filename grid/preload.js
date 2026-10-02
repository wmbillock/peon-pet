const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gridBridge', {
  onSessions: (cb) => ipcRenderer.on('grid-sessions', (_e, data) => cb(data)),
  ready: () => ipcRenderer.send('grid-ready'),
  openPanel: () => ipcRenderer.send('open-dashboard'),
});
