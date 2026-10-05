const { contextBridge, ipcRenderer } = require('electron');

// Same names the shared chat view (renderer/chat.js) already uses.
contextBridge.exposeInMainWorld('peonBridge', {
  euphoniaSend: (text) => ipcRenderer.invoke('euphonia-send', text),
  euphoniaHistory: () => ipcRenderer.invoke('euphonia-history'),
  euphoniaReset: () => ipcRenderer.invoke('euphonia-reset'),
  onEuphoniaEvent: (cb) => ipcRenderer.on('euphonia-event', (_e, ev) => cb(ev)),
  onChatFocus: (cb) => ipcRenderer.on('euphonia-chat-focus', () => cb()),
});
