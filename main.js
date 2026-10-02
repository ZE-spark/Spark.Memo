const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const syncServer = require('./sync-server');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Spark.Memo',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#FAFAFA',
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // 允许加载电脑本地任意绝对路径图片 (file:///)
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 移除默认菜单栏（更简洁的笔记应用体验）
  Menu.setApplicationMenu(null);

  mainWindow.loadFile('index.html');
}

// --- 转发手机扫码接入申请至电脑前端界面 ---
syncServer.on('device-auth-request', (data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('device-auth-request', data);
  }
});

// --- IPC 窗口最小化/最大化/关闭控制 ---
ipcMain.handle('window-minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  return { success: true };
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
  return { success: true };
});

ipcMain.handle('window-close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  return { success: true };
});

// --- 本地图片选择、路径查看与资源管理器定位（不占用额外存储空间） ---
ipcMain.handle('select-images', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择本地图片 (直接引用路径，不占额外存储空间)',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '常见图片格式', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths.map(fp => {
      let size = 0;
      try {
        if (fs.existsSync(fp)) size = fs.statSync(fp).size;
      } catch (e) {}
      return {
        path: fp,
        fileUrl: pathToFileURL(fp).href,
        name: path.basename(fp),
        size: size
      };
    });
  } catch (err) {
    console.error('select-images error:', err);
    return null;
  }
});

ipcMain.handle('show-in-folder', async (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return { success: true };
  }
  return { success: false, error: '文件不存在或已被移动' };
});

ipcMain.handle('open-path', async (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    await shell.openPath(filePath);
    return { success: true };
  }
  return { success: false, error: '文件不存在或已被移动' };
});

ipcMain.handle('set-titlebar-theme', async (event, data) => {
  return { success: true };
});

ipcMain.handle('get-sync-info', async (event, data) => {
  return await syncServer.getSyncInfo(data);
});

ipcMain.handle('update-sync-data', async (event, data) => {
  syncServer.updateSyncData(data ? data.notes : [], data ? data.activeNoteId : null);
  return { success: true };
});

ipcMain.handle('change-sync-ip', async (event, ip) => {
  return await syncServer.changeSyncIp(ip);
});

ipcMain.handle('respond-auth', async (event, data) => {
  return syncServer.respondAuth(data.requestId, data.allow);
});

ipcMain.handle('open-external', async (event, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  syncServer.stopServer();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
