const { contextBridge, ipcRenderer } = require('electron');

// Same names the shared chat view (renderer/chat.js) already uses.
contextBridge.exposeInMainWorld('peonBridge', {
  euphoniaSend: (text) => ipcRenderer.invoke('euphonia-send', text),
  euphoniaSendDraft: (text) => ipcRenderer.invoke('euphonia-send-draft', text),
  euphoniaHistory: () => ipcRenderer.invoke('euphonia-history'),
  euphoniaReset: () => ipcRenderer.invoke('euphonia-reset'),
  euphoniaAnswerApproval: (id, allow) => ipcRenderer.invoke('euphonia-approval-answer', { id, allow }),
  euphoniaApprovals: () => ipcRenderer.invoke('euphonia-approvals'),
  onEuphoniaEvent: (cb) => ipcRenderer.on('euphonia-event', (_e, ev) => cb(ev)),
  accessSummary: () => ipcRenderer.invoke('euphonia-access-summary'),
  openAccessSettings: () => ipcRenderer.send('euphonia-open-access'),
  onEuphoniaConfig: (cb) => ipcRenderer.on('euphonia-config', (_e, d) => cb(d)),
  onChatFocus: (cb) => ipcRenderer.on('euphonia-chat-focus', () => cb()),
});
