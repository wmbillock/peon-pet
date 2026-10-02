const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('peonBridge', {
  onEvent: (callback) => ipcRenderer.on('peon-event', (_e, data) => callback(data)),
  onSessionUpdate: (callback) => ipcRenderer.on('session-update', (_e, data) => callback(data)),
  startDrag: () => ipcRenderer.send('drag-start'),
  stopDrag: () => ipcRenderer.send('drag-stop'),
  reportAnim: (anim) => ipcRenderer.send('anim-changed', anim),
  openDashboard: () => ipcRenderer.send('open-dashboard'),
  toggleSound: () => ipcRenderer.send('sound-toggle'),
  onSoundState: (callback) => ipcRenderer.on('sound-state', (_e, data) => callback(data)),
  onConfig: (callback) => ipcRenderer.on('peon-config', (_e, data) => callback(data)),
});
