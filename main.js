const { app, BrowserWindow, Menu, ipcMain, shell, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const syncServer = require('./sync-server');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 320,
    minHeight: 360,
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

// --- 窗口置顶、迷你悬浮小窗与基础控制 ---
let isMiniMode = false;
let savedNormalBounds = null;
let savedWasPinned = false;

ipcMain.handle('window-minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  return { success: true };
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (isMiniMode) {
      isMiniMode = false;
      mainWindow.setAlwaysOnTop(savedWasPinned, 'screen-saver');
      if (savedNormalBounds) {
        mainWindow.setBounds(savedNormalBounds);
      }
      mainWindow.maximize();
      mainWindow.webContents.send('mini-mode-changed', { isMini: false, isPinned: savedWasPinned });
      return { success: true };
    }
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

ipcMain.handle('window-toggle-pin', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { isPinned: false };
  const current = mainWindow.isAlwaysOnTop();
  const next = !current;
  mainWindow.setAlwaysOnTop(next, 'screen-saver');
  return { success: true, isPinned: next };
});

ipcMain.handle('window-get-pin-state', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { isPinned: false };
  return { isPinned: mainWindow.isAlwaysOnTop() };
});

ipcMain.handle('window-toggle-mini-mode', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { isMini: false };
  
  if (!isMiniMode) {
    // 记录正常模式时的窗口大小与位置
    if (!mainWindow.isMaximized()) {
      savedNormalBounds = mainWindow.getBounds();
    } else {
      savedNormalBounds = { width: 1200, height: 800 };
      mainWindow.unmaximize();
    }
    savedWasPinned = mainWindow.isAlwaysOnTop();
    isMiniMode = true;

    // 获取当前屏幕可用工作区域，方便小窗优雅停靠
    const currentBounds = mainWindow.getBounds();
    const currentDisplay = screen.getDisplayMatching(currentBounds);
    const workArea = currentDisplay ? currentDisplay.workArea : { x: 0, y: 0, width: 1920, height: 1080 };

    const miniWidth = 380;
    const miniHeight = 580;
    let newX = currentBounds.x + currentBounds.width - miniWidth;
    let newY = currentBounds.y;

    if (newX + miniWidth > workArea.x + workArea.width - 10) {
      newX = workArea.x + workArea.width - miniWidth - 20;
    }
    if (newX < workArea.x + 10) {
      newX = workArea.x + 20;
    }
    if (newY + miniHeight > workArea.y + workArea.height - 10) {
      newY = workArea.y + workArea.height - miniHeight - 20;
    }
    if (newY < workArea.y + 10) {
      newY = workArea.y + 20;
    }

    mainWindow.setBounds({
      x: Math.round(newX),
      y: Math.round(newY),
      width: miniWidth,
      height: miniHeight
    });
    // 进入迷你模式时默认自动置顶，保证在全屏/大窗口播放视频时依然浮动可见
    mainWindow.setAlwaysOnTop(true, 'screen-saver');

    return { success: true, isMini: true, isPinned: true };
  } else {
    // 退出迷你模式，还原窗口
    isMiniMode = false;

    if (savedNormalBounds) {
      mainWindow.setBounds(savedNormalBounds);
    } else {
      mainWindow.setBounds({ width: 1200, height: 800 });
      mainWindow.center();
    }

    // 恢复小窗前的置顶状态
    mainWindow.setAlwaysOnTop(savedWasPinned, 'screen-saver');

    return { success: true, isMini: false, isPinned: savedWasPinned };
  }
});

ipcMain.handle('window-get-mini-state', () => {
  return { isMini: isMiniMode };
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

ipcMain.handle('resolve-image-paths', async (event, images) => {
  if (!Array.isArray(images) || images.length === 0) return { hasChanges: false, images };

  let hasChanges = false;
  const updatedImages = images.map(img => {
    if (!img || !img.path) return img;

    // 1. 如果原始绝对路径文件依然完好存在，直接返回
    if (fs.existsSync(img.path)) {
      return img;
    }

    // 2. 原始路径失效（例如用户在资源管理器中给图片重命名或移动）：
    // 在相同目录下寻找文件大小完全一致的文件进行智能重连
    try {
      const dir = path.dirname(img.path);
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.isFile() && img.size && stat.size === img.size) {
              hasChanges = true;
              return {
                ...img,
                path: fullPath,
                fileUrl: pathToFileURL(fullPath).href,
                name: file
              };
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      console.error('resolve-image-paths error:', e);
    }

    return img;
  });

  return { hasChanges, images: updatedImages };
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
