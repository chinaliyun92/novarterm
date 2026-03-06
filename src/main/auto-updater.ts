/**
 * Electron-updater integration: check, download, and prompt to restart.
 * Only active when app.isPackaged; uses native dialogs for user choices.
 */
import { BrowserWindow, dialog } from 'electron'
import electronUpdater from 'electron-updater'
import type { AppLogger } from './logger'

const { autoUpdater } = electronUpdater

type GetMainWindow = () => BrowserWindow | null

/** Minimal shape for update info from electron-updater events */
interface UpdateInfoLike {
  version?: string
}

let initialized = false
/** True when the current check was triggered by user (e.g. settings "检查更新"). Used to decide whether to show error dialogs. */
let lastCheckWasManual = false
/** True after update-available, false after update-not-available or update-downloaded. Used to distinguish check failure vs download failure. */
let updateWasAvailable = false

/**
 * Mark whether the next check is manual (user-triggered). Only when manual will we show
 * "您的版本已经是最新版本" or "新版本下载失败，请稍后重试" on failure.
 */
export function setLastCheckWasManual(manual: boolean): void {
  lastCheckWasManual = manual
}

function toUpdaterLogger(logger: AppLogger): { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void } {
  const scope = 'updater'
  return {
    info: (message: string) => logger.info(scope, message),
    warn: (message: string) => logger.warn(scope, message),
    error: (message: string) => logger.error(scope, message),
  }
}

export interface SetupAutoUpdaterOptions {
  getMainWindow: GetMainWindow
  logger: AppLogger
}

/**
 * Call once when app is ready and packaged. Registers event handlers:
 * - update-available: auto-download in background (no dialog)
 * - update-downloaded: prompt "新版本已准备完成，是否立即重启？"
 */
export function setupAutoUpdater(options: SetupAutoUpdaterOptions): void {
  const { getMainWindow, logger } = options
  if (initialized) {
    logger.info('updater', 'auto-updater already initialized')
    return
  }

  autoUpdater.logger = toUpdaterLogger(logger)
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (error: Error) => {
    logger.warn('updater', `update error: ${error.message}`)
    if (!lastCheckWasManual) {
      return
    }
    lastCheckWasManual = false
    const message = updateWasAvailable ? '新版本下载失败，请稍后重试' : '您的版本已经是最新版本'
    const win = getMainWindow()
    const parent = win && !win.isDestroyed() ? win : null
    const errOpts = {
      type: 'info' as const,
      title: '检查更新',
      message,
    }
    if (parent) {
      dialog.showMessageBox(parent, errOpts).catch(() => {})
    } else {
      dialog.showMessageBox(errOpts).catch(() => {})
    }
  })

  autoUpdater.on('update-available', (info: UpdateInfoLike) => {
    updateWasAvailable = true
    const version = info.version ?? 'unknown'
    logger.info('updater', `update available, downloading in background: ${version}`)
  })

  autoUpdater.on('update-not-available', (info: UpdateInfoLike) => {
    updateWasAvailable = false
    logger.info('updater', `no update: ${info.version ?? 'unknown'}`)
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfoLike) => {
    updateWasAvailable = false
    const version = info.version ?? 'unknown'
    logger.info('updater', `update downloaded: ${version}`)
    const win = getMainWindow()
    const parent = win && !win.isDestroyed() ? win : null
    const opts = {
      type: 'info' as const,
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: '更新就绪',
      message: `新版本 ${version} 已为您准备完成，是否立即重启？`,
      detail: '点击「立即重启」将关闭应用并安装新版本。选择「稍后」可稍后在设置中再次检查更新或下次启动时安装。',
    }
    const show = parent ? () => dialog.showMessageBox(parent, opts) : () => dialog.showMessageBox(opts)
    show().then((result) => {
      lastCheckWasManual = false
      if (result.response === 0) {
        logger.info('updater', 'user chose to restart and install')
        autoUpdater.quitAndInstall(false, true)
      }
    }).catch(() => {})
  })

  initialized = true
  logger.info('updater', 'auto-updater initialized')
}

/**
 * Start checking for updates. Only use when app.isPackaged and setupAutoUpdater was called.
 * Returns the same Promise as autoUpdater.checkForUpdates().
 */
export function checkForUpdatesWithInstaller(): Promise<import('electron-updater').UpdateCheckResult | null> {
  return autoUpdater.checkForUpdates()
}

/**
 * Whether the native auto-updater (electron-updater) is available and initialized.
 */
export function isNativeUpdaterAvailable(): boolean {
  return initialized
}
