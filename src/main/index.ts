import { app, shell, BrowserWindow, ipcMain, clipboard } from 'electron'
import { join } from 'node:path'
import { runConnectivityTest, TARGETS } from './connectivity'
import { applyHosts, getHostsStatus, revertHosts } from './hosts'
import { applyGitProxy, clearAllGitProxy, clearGitProxy, getGitStatus } from './git'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

// 工具类应用无需 GPU 加速，禁用可避免远程会话/无显卡环境的启动崩溃
app.disableHardwareAcceleration()

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    title: 'GitHub 连通性检测',
    backgroundColor: '#0f1420',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']!)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('connectivity:test', async (_event, payload) => {
    const { proxy, targets, timeoutMs = 3000 } = payload ?? {}
    const selectedTargets = targets?.length ? targets : TARGETS
    return await runConnectivityTest(selectedTargets, timeoutMs, proxy)
  })

  ipcMain.handle('connectivity:targets', () => TARGETS)

  ipcMain.handle('hosts:status', () => getHostsStatus())
  ipcMain.handle('hosts:apply', (_event, entries) => applyHosts(entries))
  ipcMain.handle('hosts:revert', () => revertHosts())

  ipcMain.handle('git:status', () => getGitStatus())
  ipcMain.handle('git:apply', (_event, options) => applyGitProxy(options))
  ipcMain.handle('git:clear', (_event, scope) => clearGitProxy(scope))
  ipcMain.handle('git:clearAll', () => clearAllGitProxy())

  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.handle('clipboard:write', (_event, text) => {
    clipboard.writeText(String(text ?? ''))
    return true
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})