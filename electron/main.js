const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const path = require('path')

app.setName('SDMo')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// Register IPC handlers before app is ready so they're available immediately
try {
  require('./ipc/projects')(ipcMain)
  require('./ipc/encounters')(ipcMain)
  require('./ipc/reviews')(ipcMain)
  require('./ipc/media')(ipcMain)
  require('./ipc/cloud')(ipcMain)
  console.log('[main] IPC handlers registered')
} catch (e) {
  console.error('[main] Failed to register IPC handlers:', e)
}

app.whenReady().then(() => {
  protocol.registerFileProtocol('localfile', (request, callback) => {
    const filePath = decodeURIComponent(request.url.replace('localfile://', ''))
    callback({ path: filePath })
  })

  createWindow()

  const { setMainWindow } = require('./sync')
  setMainWindow(mainWindow)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

ipcMain.handle('window:setFullscreen', (_, flag) => mainWindow.setFullScreen(flag))
ipcMain.handle('window:isFullscreen', () => mainWindow.isFullScreen())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
