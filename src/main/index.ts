import { app, shell, BrowserWindow, ipcMain, clipboard, dialog } from 'electron'
import { join } from 'node:path'
import fs from 'node:fs/promises'
import { runConnectivityTest, setCustomIpPool, TARGETS } from './connectivity'
import { applyHosts, getHostsStatus, revertHosts } from './hosts'
import { applyGitProxy, clearAllGitProxy, clearGitProxy, getGitStatus } from './git'
import { getCustomIps, setCustomIps } from './ippool'
import { clearLog, getLog, logEvent } from './logger'
import {
  cancelSpeedTest,
  runFullSpeedTest
} from './speed'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

// 工具类应用无需 GPU 加速，避免远程会话/无显卡环境的启动崩溃
app.disableHardwareAcceleration()

// 单实例锁：避免多开同时读写 hosts/git 造成冲突
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

const WIN_STATE_FILE = 'win-state.json'

async function saveWindowState(win: BrowserWindow): Promise<void> {
  if (win.isMaximized() || win.isMinimized() || win.isFullScreen()) return
  try {
    const state = { bounds: win.getBounds() }
    await fs.writeFile(
      join(app.getPath('userData'), WIN_STATE_FILE),
      JSON.stringify(state),
      'utf8'
    )
  } catch {
    /* ignore */
  }
}

async function loadWindowBounds(): Promise<Partial<Electron.Rectangle>> {
  try {
    const raw = await fs.readFile(join(app.getPath('userData'), WIN_STATE_FILE), 'utf8')
    const b = JSON.parse(raw)?.bounds
    if (b && typeof b.width === 'number' && typeof b.height === 'number') return b
  } catch {
    /* ignore */
  }
  return {}
}

async function createWindow(): Promise<void> {
  const bounds = await loadWindowBounds()
  const mainWindow = new BrowserWindow({
    width: bounds.width || 960,
    height: bounds.height || 720,
    x: bounds.x,
    y: bounds.y,
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

  // 记窗口位置/尺寸（防抖）
  let saveTimer: NodeJS.Timeout | null = null
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void saveWindowState(mainWindow), 400)
  }
  mainWindow.on('resize', scheduleSave)
  mainWindow.on('move', scheduleSave)

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
  ipcMain.handle('hosts:apply', async (_event, entries) => {
    const r = await applyHosts(entries)
    await logEvent('hosts.apply', `${r.entries.length} 条${r.elevated ? '（提权）' : ''}`, true)
    return r
  })
  ipcMain.handle('hosts:revert', async () => {
    const r = await revertHosts()
    await logEvent('hosts.revert', r.removed ? '已移除管理段' : '无管理段', r.removed)
    return r
  })

  ipcMain.handle('git:status', () => getGitStatus())
  ipcMain.handle('git:apply', async (_event, options) => {
    const r = await applyGitProxy(options)
    await logEvent('git.apply', `${options.scope} 代理 ${options.host}:${options.port}`, true)
    return r
  })
  ipcMain.handle('git:clear', async (_event, scope) => {
    const r = await clearGitProxy(scope)
    await logEvent('git.clear', scope, r.cleared.length > 0)
    return r
  })
  ipcMain.handle('git:clearAll', async () => {
    const r = await clearAllGitProxy()
    await logEvent('git.clearAll', String(r.cleared.length), r.cleared.length > 0)
    return r
  })

  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.handle('clipboard:write', (_event, text) => {
    clipboard.writeText(String(text ?? ''))
    return true
  })

  // ---- IP 池维护 ----
  ipcMain.handle('ippool:get', async () => {
    const custom = await getCustomIps()
    setCustomIpPool(custom)
    return custom
  })
  ipcMain.handle('ippool:set', async (_event, ips: string[]) => {
    const saved = await setCustomIps(ips)
    setCustomIpPool(saved)
    return saved
  })

  // ---- 操作日志 ----
  ipcMain.handle('log:get', () => getLog())
  ipcMain.handle('log:clear', async () => {
    await clearLog()
    return true
  })
  ipcMain.handle('log:export', async (_event, defaultName: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出操作日志',
      defaultPath: defaultName || 'github-accelerator-operation.log',
      filters: [{ name: '日志文件', extensions: ['log', 'txt'] }]
    })
    if (canceled || !filePath) return { canceled: true }
    const content = await getLog()
    await fs.writeFile(filePath, content || '(空日志)', 'utf8')
    return { canceled: false, filePath }
  })

  // ---- 测速（下载 + 上传连续综合测速，采样实时推送）----
  ipcMain.handle('speed:full', async (event, opts) => {
    cancelSpeedTest()
    const target = BrowserWindow.fromWebContents(event.sender)
    return await runFullSpeedTest(opts ?? {}, (s) => {
      if (target && !target.isDestroyed()) target.webContents.send('speed:sample', s)
    })
  })
  ipcMain.handle('speed:cancel', () => {
    cancelSpeedTest()
    return true
  })
}

function bootstrap(): void {
  void getCustomIps().then((custom) => setCustomIpPool(custom)) // 预热 IP 池
  registerIpc()
  void createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
}

if (gotLock) {
  app.whenReady().then(bootstrap)
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})