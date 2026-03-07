import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { app, BrowserWindow, ipcMain, nativeImage, screen } from 'electron'
import type Database from 'better-sqlite3'
import { initializeDatabase } from './db'
import type { AppLogger } from './logger'
import { createMainLogger } from './logger'
import { createRepositoryRegistry } from './repositories'
import { clearLogIPCHandlers, registerLogIPCHandlers } from './ipc/log'
import { clearServerIPCHandlers, registerServerIPCHandlers } from './ipc/server'
import { clearSettingsIPCHandlers, registerSettingsIPCHandlers } from './ipc/settings'
import { clearSSHIPCHandlers, registerSSHIPCHandlers } from './ipc/ssh'
import { clearTerminalIPCHandlers, registerTerminalIPCHandlers } from './ipc/terminal'
import { clearDialogIPCHandlers, registerDialogIPCHandlers } from './ipc/dialog'
import { clearLocalFileIPCHandlers, registerLocalFileIPCHandlers } from './ipc/local-file'
import { clearShellIPCHandlers, registerShellIPCHandlers } from './ipc/shell'
import {
  checkForUpdatesWithInstaller,
  isNativeUpdaterAvailable,
  setLastCheckWasManual,
  setupAutoUpdater,
} from './auto-updater'
import {
  checkForUpdates,
  clearUpdateIPCHandlers,
  promptForUpdateAndMaybeOpen,
  registerUpdateIPCHandlers,
  type UpdateIPCContext,
} from './ipc/update'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WINDOW_STATE_FILE_NAME = 'window-state.json'
const WINDOW_DEFAULT_WIDTH = 1280
const WINDOW_DEFAULT_HEIGHT = 800
const WINDOW_MIN_WIDTH = 960
const WINDOW_MIN_HEIGHT = 640
const APP_DISPLAY_NAME = 'NovarTerm'
const DEV_USER_DATA_DIR_NAME = `${APP_DISPLAY_NAME}-Dev`
const APP_ICON_FILE_NAME = 'AppIcon.png'
const UPDATE_REPOSITORY_OWNER = 'chinaliyun92'
const UPDATE_REPOSITORY_NAME = 'novarterm'
const UPDATE_RELEASES_PAGE_URL = `https://github.com/${UPDATE_REPOSITORY_OWNER}/${UPDATE_REPOSITORY_NAME}/releases/latest`
const AUTO_UPDATE_CHECK_DELAY_MS = 12_000
app.setName(APP_DISPLAY_NAME)
if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), DEV_USER_DATA_DIR_NAME))
}
let mainWindow: BrowserWindow | null = null
let persistWindowStateTimer: ReturnType<typeof setTimeout> | null = null
let autoUpdateCheckTimer: ReturnType<typeof setTimeout> | null = null
let autoUpdateCheckRunning = false
let db: Database.Database | null = null
let logger: AppLogger = {
  info: (scope: string, message: string) => console.info(`[INFO][${scope}] ${message}`),
  warn: (scope: string, message: string) => console.warn(`[WARN][${scope}] ${message}`),
  error: (scope: string, message: string) => console.error(`[ERROR][${scope}] ${message}`),
  getLogFilePath: () => 'console',
}

interface PersistedWindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

function formatUnknown(reason: unknown): string {
  if (reason instanceof Error) {
    if (reason.stack?.trim()) {
      return reason.stack.trim()
    }
    return `${reason.name}: ${reason.message}`
  }

  if (typeof reason === 'string') {
    return reason
  }

  try {
    return JSON.stringify(reason)
  } catch {
    return String(reason)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function resolveWindowStatePath(): string {
  return join(app.getPath('userData'), WINDOW_STATE_FILE_NAME)
}

function clearWindowStatePersistTimer(): void {
  if (persistWindowStateTimer) {
    clearTimeout(persistWindowStateTimer)
    persistWindowStateTimer = null
  }
}

function clearAutoUpdateCheckTimer(): void {
  if (autoUpdateCheckTimer) {
    clearTimeout(autoUpdateCheckTimer)
    autoUpdateCheckTimer = null
  }
}

function createUpdateContext(): UpdateIPCContext {
  return {
    owner: UPDATE_REPOSITORY_OWNER,
    repo: UPDATE_REPOSITORY_NAME,
    currentVersion: app.getVersion(),
    releasesPageUrl: UPDATE_RELEASES_PAGE_URL,
    logger,
  }
}

async function runAutoUpdateCheck(): Promise<void> {
  if (!app.isPackaged) {
    logger.info('update', 'skip auto update check in development mode')
    return
  }
  if (autoUpdateCheckRunning) {
    logger.info('update', 'skip auto update check because one is already running')
    return
  }

  autoUpdateCheckRunning = true
  try {
    if (isNativeUpdaterAvailable()) {
      setLastCheckWasManual(false)
      await checkForUpdatesWithInstaller()
      return
    }

    const checked = await checkForUpdates(createUpdateContext())
    if (!checked.ok) {
      logger.warn('update', `auto update check failed: ${checked.error.message}`)
      return
    }

    if (!checked.data.hasUpdate) {
      logger.info('update', `auto update check complete: latest=${checked.data.latestVersion}`)
      return
    }

    const targetWindow = mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : BrowserWindow.getAllWindows()[0] ?? null

    const promptResult = await promptForUpdateAndMaybeOpen(targetWindow, {
      currentVersion: checked.data.currentVersion,
      latestVersion: checked.data.latestVersion,
      latestTag: checked.data.latestTag,
      releaseUrl: checked.data.releaseUrl,
    }, UPDATE_RELEASES_PAGE_URL)

    logger.info(
      'update',
      `auto update prompt action=${promptResult.action} openedReleasePage=${String(promptResult.openedReleasePage)}`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('update', `auto update check crashed: ${message}`)
  } finally {
    autoUpdateCheckRunning = false
  }
}

function scheduleAutoUpdateCheck(): void {
  if (!app.isPackaged) {
    logger.info('update', 'skip scheduling auto update check in development mode')
    return
  }

  clearAutoUpdateCheckTimer()
  autoUpdateCheckTimer = setTimeout(() => {
    autoUpdateCheckTimer = null
    void runAutoUpdateCheck()
  }, AUTO_UPDATE_CHECK_DELAY_MS)

  logger.info('update', `auto update check scheduled after ${AUTO_UPDATE_CHECK_DELAY_MS}ms`)
}

function clampWindowState(rawState: PersistedWindowState): PersistedWindowState {
  const display = screen.getDisplayMatching({
    x: rawState.x ?? 0,
    y: rawState.y ?? 0,
    width: rawState.width,
    height: rawState.height,
  })
  const workArea = display.workArea
  const minimumWidth = Math.min(WINDOW_MIN_WIDTH, workArea.width)
  const minimumHeight = Math.min(WINDOW_MIN_HEIGHT, workArea.height)

  const width = Math.max(minimumWidth, Math.min(rawState.width, workArea.width))
  const height = Math.max(minimumHeight, Math.min(rawState.height, workArea.height))
  const maxX = workArea.x + workArea.width - width
  const maxY = workArea.y + workArea.height - height

  const x = typeof rawState.x === 'number' ? Math.max(workArea.x, Math.min(rawState.x, maxX)) : undefined
  const y = typeof rawState.y === 'number' ? Math.max(workArea.y, Math.min(rawState.y, maxY)) : undefined

  return {
    ...(typeof x === 'number' ? { x } : {}),
    ...(typeof y === 'number' ? { y } : {}),
    width,
    height,
    isMaximized: rawState.isMaximized,
  }
}

function parsePersistedWindowState(raw: string): PersistedWindowState | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isRecord(parsed)) {
    return null
  }

  const widthCandidate = toFiniteNumber(parsed.width) ?? WINDOW_DEFAULT_WIDTH
  const heightCandidate = toFiniteNumber(parsed.height) ?? WINDOW_DEFAULT_HEIGHT
  const xCandidate = toFiniteNumber(parsed.x)
  const yCandidate = toFiniteNumber(parsed.y)
  const isMaximized = parsed.isMaximized === true

  return clampWindowState({
    ...(xCandidate !== null ? { x: Math.round(xCandidate) } : {}),
    ...(yCandidate !== null ? { y: Math.round(yCandidate) } : {}),
    width: Math.round(widthCandidate),
    height: Math.round(heightCandidate),
    isMaximized,
  })
}

function loadWindowState(): PersistedWindowState | null {
  const windowStatePath = resolveWindowStatePath()
  if (!existsSync(windowStatePath)) {
    return null
  }

  try {
    const raw = readFileSync(windowStatePath, 'utf8')
    const parsed = parsePersistedWindowState(raw)
    if (!parsed) {
      logger.warn('window', `window state file is invalid: ${windowStatePath}`)
      return null
    }
    return parsed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('window', `failed to load window state: ${message}`)
    return null
  }
}

function buildWindowStateSnapshot(targetWindow: BrowserWindow): PersistedWindowState {
  const bounds = targetWindow.isMaximized() ? targetWindow.getNormalBounds() : targetWindow.getBounds()
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
    isMaximized: targetWindow.isMaximized(),
  }
}

function persistWindowState(targetWindow: BrowserWindow): void {
  const windowStatePath = resolveWindowStatePath()
  const state = clampWindowState(buildWindowStateSnapshot(targetWindow))

  try {
    mkdirSync(dirname(windowStatePath), { recursive: true })
    writeFileSync(windowStatePath, JSON.stringify(state))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('window', `failed to persist window state: ${message}`)
  }
}

function schedulePersistWindowState(targetWindow: BrowserWindow): void {
  clearWindowStatePersistTimer()
  persistWindowStateTimer = setTimeout(() => {
    persistWindowStateTimer = null
    if (targetWindow.isDestroyed()) {
      return
    }
    persistWindowState(targetWindow)
  }, 140)
}

function initializeLogger(): void {
  const logsDir = join(app.getPath('userData'), 'logs')
  logger = createMainLogger(logsDir)
  logger.info('app', `logger initialized at ${logger.getLogFilePath()}`)
}

function registerIpcHandlers(): void {
  logger.info('ipc', 'registering IPC handlers')
  if (!db) {
    throw new Error('Database not initialized')
  }
  const repositories = createRepositoryRegistry(db)

  ipcMain.handle('app:ping', async () => {
    return {
      message: 'pong',
      at: new Date().toISOString(),
      dbReady: Boolean(db)
    }
  })
  logger.info('ipc', 'registered app:ping handler')

  registerLogIPCHandlers(ipcMain, logger)
  logger.info('ipc', 'registered log IPC handlers')
  registerSSHIPCHandlers(ipcMain)
  logger.info('ipc', 'registered SSH IPC handlers')
  registerTerminalIPCHandlers(ipcMain, {
    settingsRepository: repositories.settings,
    userDataPath: app.getPath('userData'),
    logger,
  })
  logger.info('ipc', 'registered terminal IPC handlers')
  registerDialogIPCHandlers(ipcMain)
  logger.info('ipc', 'registered dialog IPC handlers')
  registerShellIPCHandlers(ipcMain)
  logger.info('ipc', 'registered shell IPC handlers')
  registerLocalFileIPCHandlers(ipcMain)
  logger.info('ipc', 'registered local-file IPC handlers')
  registerServerIPCHandlers(ipcMain, repositories)
  logger.info('ipc', 'registered server IPC handlers')
  registerSettingsIPCHandlers(ipcMain, repositories)
  logger.info('ipc', 'registered settings IPC handlers')
  if (app.isPackaged) {
    setupAutoUpdater({ getMainWindow: () => mainWindow, logger })
  }
  registerUpdateIPCHandlers(ipcMain, createUpdateContext(), {
    useNativeUpdater: app.isPackaged,
  })
  logger.info('ipc', 'registered update IPC handlers')
}

function initializeDataLayer(): void {
  logger.info('db', 'initializing database')
  const dataDir = join(app.getPath('userData'), 'data')
  db = initializeDatabase({
    dataDir,
    dbFileName: 'app.db'
  })
  logger.info('db', `database initialized at ${dataDir}`)
}

function createMainWindow(): void {
  logger.info('window', 'creating main window')
  const preloadPath = resolvePreloadPath()
  const appIconPath = resolveAppIconPath()
  const restoredWindowState = loadWindowState()
  const isDevMode = Boolean(process.env.ELECTRON_RENDERER_URL) || process.env.NODE_ENV === 'development'
  logger.info('window', `using preload script: ${preloadPath}`)

  mainWindow = new BrowserWindow({
    ...(appIconPath ? { icon: appIconPath } : {}),
    title: APP_DISPLAY_NAME,
    width: restoredWindowState?.width ?? WINDOW_DEFAULT_WIDTH,
    height: restoredWindowState?.height ?? WINDOW_DEFAULT_HEIGHT,
    ...(typeof restoredWindowState?.x === 'number' ? { x: restoredWindowState.x } : {}),
    ...(typeof restoredWindowState?.y === 'number' ? { y: restoredWindowState.y } : {}),
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    ...(process.platform === 'darwin' ? { acceptFirstMouse: true } : {}),
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  void mainWindow.webContents
    .setVisualZoomLevelLimits(1, 1)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('window', `failed to lock visual zoom level: ${message}`)
    })
  mainWindow.webContents.setZoomFactor(1)

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    logger.info('window', `loading renderer from dev server ${devServerUrl}`)
    void mainWindow.loadURL(devServerUrl)
  } else {
    logger.info('window', 'loading renderer from bundled index.html')
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    if (restoredWindowState?.isMaximized) {
      mainWindow?.maximize()
    }
    logger.info('window', 'ready-to-show -> show + focus')
    mainWindow?.show()
    mainWindow?.focus()
  })

  mainWindow.on('resize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }
    schedulePersistWindowState(mainWindow)
  })

  mainWindow.on('move', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }
    schedulePersistWindowState(mainWindow)
  })

  mainWindow.on('close', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }
    clearWindowStatePersistTimer()
    persistWindowState(mainWindow)
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logger.error(
      'window',
      `did-fail-load code=${errorCode} desc=${errorDescription} url=${validatedURL}`
    )
  })

  mainWindow.webContents.on('did-finish-load', () => {
    logger.info('window', 'did-finish-load')
    if (isDevMode && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
    void mainWindow?.webContents
      .executeJavaScript(
        `(() => {
          const api = window.electronAPI
          const bridge = window.__electronAPIBridge
          return {
            hasElectronAPI: Boolean(api),
            electronAPIKeys: api ? Object.keys(api) : [],
            hasBridge: Boolean(bridge),
            bridgeKeys: bridge ? Object.keys(bridge) : [],
          }
        })()`,
        true,
      )
      .then((payload: unknown) => {
        const data = (payload ?? {}) as {
          hasElectronAPI?: boolean
          electronAPIKeys?: string[]
          hasBridge?: boolean
          bridgeKeys?: string[]
        }
        logger.info(
          'window',
          `bridge diagnostics hasElectronAPI=${Boolean(data.hasElectronAPI)} keys=${(data.electronAPIKeys ?? []).join(',') || 'none'} hasBridge=${Boolean(data.hasBridge)} bridgeKeys=${(data.bridgeKeys ?? []).join(',') || 'none'}`,
        )
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('window', `bridge diagnostics failed: ${message}`)
      })
  })

  mainWindow.on('closed', () => {
    logger.info('window', 'main window closed')
    mainWindow = null
  })
}

function resolveAppIconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, APP_ICON_FILE_NAME)]
    : [
        join(process.cwd(), 'resources', APP_ICON_FILE_NAME),
        join(__dirname, '../../resources', APP_ICON_FILE_NAME),
        join(app.getAppPath(), 'resources', APP_ICON_FILE_NAME),
      ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  logger.warn('window', `app icon not found; candidates=${candidates.join(', ')}`)
  return undefined
}

function applyAppIcon(): void {
  const iconPath = resolveAppIconPath()
  if (!iconPath) {
    return
  }

  if (process.platform === 'darwin') {
    const icon = nativeImage.createFromPath(iconPath)
    if (!icon.isEmpty()) {
      app.dock?.setIcon(icon)
      logger.info('window', `dock icon applied: ${iconPath}`)
      return
    }
    logger.warn('window', `dock icon is empty: ${iconPath}`)
    return
  }

  logger.info('window', `window icon path resolved: ${iconPath}`)
}

function resolvePreloadPath(): string {
  const mjsPath = join(__dirname, '../preload/index.mjs')
  if (existsSync(mjsPath)) {
    return mjsPath
  }

  const jsPath = join(__dirname, '../preload/index.js')
  if (existsSync(jsPath)) {
    return jsPath
  }

  logger.warn(
    'window',
    `preload script not found at ${mjsPath} or ${jsPath}; BrowserWindow bridge may be unavailable`,
  )
  return mjsPath
}

process.on('uncaughtException', (error) => {
  logger.error('process', `uncaughtException: ${formatUnknown(error)}`)
})

process.on('unhandledRejection', (reason) => {
  logger.error('process', `unhandledRejection: ${formatUnknown(reason)}`)
})

app.whenReady().then(() => {
  initializeLogger()
  logger.info('app', 'whenReady')
  applyAppIcon()

  initializeDataLayer()
  registerIpcHandlers()
  createMainWindow()
  scheduleAutoUpdateCheck()

  app.on('activate', () => {
    logger.info('app', 'activate')
    if (BrowserWindow.getAllWindows().length === 0) {
      logger.info('window', 'recreating main window on activate')
      createMainWindow()
      return
    }

    const [firstWindow] = BrowserWindow.getAllWindows()
    firstWindow?.show()
    firstWindow?.focus()
  })
}).catch((error) => {
  logger.error('app', `startup failed: ${formatUnknown(error)}`)
})

app.on('window-all-closed', () => {
  logger.info('app', `window-all-closed (platform=${process.platform})`)
  if (process.platform !== 'darwin') {
    logger.info('app', 'quitting because platform is not darwin')
    app.quit()
  }
})

app.on('before-quit', () => {
  logger.info('app', 'before-quit')
  clearWindowStatePersistTimer()
  clearAutoUpdateCheckTimer()
  // 不在此处移除 IPC 或关闭 db，否则窗口关闭时渲染进程的 saveSnapshot/saveHistory 会报 "No handler registered"
})

app.on('will-quit', () => {
  logger.info('app', 'will-quit')
  clearTerminalIPCHandlers(ipcMain)
  clearSSHIPCHandlers(ipcMain)
  clearServerIPCHandlers(ipcMain)
  clearSettingsIPCHandlers(ipcMain)
  clearUpdateIPCHandlers(ipcMain)
  clearDialogIPCHandlers(ipcMain)
  clearShellIPCHandlers(ipcMain)
  clearLocalFileIPCHandlers(ipcMain)
  clearLogIPCHandlers(ipcMain)
  if (db) {
    db.close()
    db = null
    logger.info('db', 'database closed')
  }
  logger.info('app', 'shutdown cleanup complete')
})
