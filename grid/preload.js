const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gridBridge', {
  onSessions: (cb) => ipcRenderer.on('grid-sessions', (_e, data) => cb(data)),
  ready: () => ipcRenderer.send('grid-ready'),
  onView: (cb) => ipcRenderer.on('grid-view', (_e, v) => cb(v)),
  openPanel: () => ipcRenderer.send('open-dashboard'),
});
