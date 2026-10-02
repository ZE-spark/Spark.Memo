const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sparkBridge', {
  getSyncInfo: (data) => ipcRenderer.invoke('get-sync-info', data),
  updateSyncData: (data) => ipcRenderer.invoke('update-sync-data', data),
  changeSyncIp: (ip) => ipcRenderer.invoke('change-sync-ip', ip),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  respondAuth: (data) => ipcRenderer.invoke('respond-auth', data),
  setTitleBarTheme: (colors) => ipcRenderer.invoke('set-titlebar-theme', colors),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  selectImages: () => ipcRenderer.invoke('select-images'),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
  onAuthRequest: (callback) => {
    ipcRenderer.on('device-auth-request', (event, data) => callback(data));
  }
});
