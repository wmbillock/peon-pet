const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('peonBridge', {
  onEvent: (callback) => ipcRenderer.on('peon-event', (_e, data) => callback(data)),
  onSessionUpdate: (callback) => ipcRenderer.on('session-update', (_e, data) => callback(data)),
  startDrag: () => ipcRenderer.send('drag-start'),
  stopDrag: () => ipcRenderer.send('drag-stop'),
  onPetLook: (callback) => ipcRenderer.on('pet-look', (_e, data) => callback(data)),
  onFrameStyle: (cb) => ipcRenderer.on('frame-style', (_e, d) => cb(d)),
  onCornerView: (cb) => ipcRenderer.on('corner-view', (_e, v) => cb(v)),
  setCornerView: (v) => ipcRenderer.send('corner-set-view', v),
  resizeCorner: (size) => ipcRenderer.send('corner-resize', size),
  reportAnim: (anim) => ipcRenderer.send('anim-changed', anim),
  openDashboard: () => ipcRenderer.send('open-dashboard'),
  toggleSound: () => ipcRenderer.send('sound-toggle'),
  onSoundState: (callback) => ipcRenderer.on('sound-state', (_e, data) => callback(data)),
  onConfig: (callback) => ipcRenderer.on('peon-config', (_e, data) => callback(data)),
});
