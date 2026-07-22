import electronUpdater from 'electron-updater'
import type { AppLogger } from './logger'
import type { NativeUpdateState } from '../shared/types/update'

const { autoUpdater } = electronUpdater

function normalizeVersion(input: string | null | undefined): string | null {
  if (typeof input !== 'string') {
    return null
  }
  const normalized = input.trim().replace(/^v/i, '')
  return normalized || null
}

type BroadcastUpdateState = (state: NativeUpdateState) => void

/** Minimal shape for update info from electron-updater events */
interface UpdateInfoLike {
  version?: string
}

interface DownloadProgressLike {
  percent?: number
  transferred?: number
  total?: number
}

let initialized = false
let lastCheckWasManual = false
let isDownloading = false
let installingUpdate = false
let currentState: NativeUpdateState = {
  phase: 'idle',
  currentVersion: '0.0.0',
  latestVersion: null,
  latestTag: null,
  releaseUrl: '',
  progressPercent: 0,
  transferredBytes: 0,
  totalBytes: 0,
}

function setState(
  patch: Partial<NativeUpdateState>,
  broadcast?: BroadcastUpdateState,
): void {
  currentState = {
    ...currentState,
    ...patch,
  }
  broadcast?.(currentState)
}

function toUpdaterLogger(logger: AppLogger): { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void } {
  const scope = 'updater'
  return {
    info: (message: string) => logger.info(scope, message),
    warn: (message: string) => logger.warn(scope, message),
    error: (message: string) => logger.error(scope, message),
  }
}

export function setLastCheckWasManual(manual: boolean): void {
  lastCheckWasManual = manual
}

export interface SetupAutoUpdaterOptions {
  logger: AppLogger
  releasesPageUrl: string
  currentVersion: string
  broadcastUpdateState?: BroadcastUpdateState
}

export function setupAutoUpdater(options: SetupAutoUpdaterOptions): void {
  const { logger, releasesPageUrl, currentVersion, broadcastUpdateState } = options
  if (initialized) {
    logger.info('updater', 'auto-updater already initialized')
    return
  }

  currentState = {
    phase: 'idle',
    currentVersion: normalizeVersion(currentVersion) ?? currentVersion,
    latestVersion: null,
    latestTag: null,
    releaseUrl: releasesPageUrl,
    progressPercent: 0,
    transferredBytes: 0,
    totalBytes: 0,
  }

  autoUpdater.logger = toUpdaterLogger(logger)
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('error', (error: Error) => {
    logger.warn('updater', `update error: ${error.message}`)
    const nextPhase = lastCheckWasManual || isDownloading ? 'error' : currentState.phase
    setState(
      {
        phase: nextPhase,
        errorMessage: error.message,
      },
      broadcastUpdateState,
    )
    isDownloading = false
    lastCheckWasManual = false
  })

  autoUpdater.on('update-available', (info: UpdateInfoLike) => {
    const latestVersion = normalizeVersion(info.version)
    logger.info('updater', `update available: ${latestVersion ?? 'unknown'}`)
    setState(
      {
        phase: 'available',
        latestVersion,
        latestTag: info.version?.trim() || null,
        progressPercent: 0,
        transferredBytes: 0,
        totalBytes: 0,
        errorMessage: undefined,
      },
      broadcastUpdateState,
    )
  })

  autoUpdater.on('update-not-available', (info: UpdateInfoLike) => {
    logger.info('updater', `no update: ${info.version ?? 'unknown'}`)
    setState(
      {
        phase: 'idle',
        latestVersion: normalizeVersion(info.version),
        latestTag: info.version?.trim() || null,
        progressPercent: 0,
        transferredBytes: 0,
        totalBytes: 0,
        errorMessage: undefined,
      },
      broadcastUpdateState,
    )
    lastCheckWasManual = false
    isDownloading = false
  })

  autoUpdater.on('download-progress', (progress: DownloadProgressLike) => {
    setState(
      {
        phase: 'downloading',
        progressPercent: Math.max(0, Math.min(100, progress.percent ?? 0)),
        transferredBytes: Math.max(0, progress.transferred ?? 0),
        totalBytes: Math.max(0, progress.total ?? 0),
        errorMessage: undefined,
      },
      broadcastUpdateState,
    )
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfoLike) => {
    const version = normalizeVersion(info.version)
    logger.info('updater', `update downloaded: ${version ?? 'unknown'}`)
    setState(
      {
        phase: 'downloaded',
        latestVersion: version,
        latestTag: info.version?.trim() || null,
        progressPercent: 100,
        errorMessage: undefined,
      },
      broadcastUpdateState,
    )
    isDownloading = false
    lastCheckWasManual = false
  })

  initialized = true
  logger.info('updater', 'auto-updater initialized')
}

export function checkForUpdatesWithInstaller(): Promise<import('electron-updater').UpdateCheckResult | null> {
  return autoUpdater.checkForUpdates()
}

export function downloadUpdateWithInstaller(): Promise<string[]> {
  isDownloading = true
  setState({
    phase: 'downloading',
    progressPercent: currentState.progressPercent > 0 ? currentState.progressPercent : 0,
    transferredBytes: currentState.transferredBytes,
    totalBytes: currentState.totalBytes,
    errorMessage: undefined,
  })
  return autoUpdater.downloadUpdate()
}

export function quitAndInstallUpdate(): void {
  installingUpdate = true
  // Defer so the IPC invoke can return to the renderer before quit begins.
  setImmediate(() => {
    try {
      autoUpdater.quitAndInstall(false, true)
    } catch (error) {
      installingUpdate = false
      const message = error instanceof Error ? error.message : String(error)
      setState({
        phase: 'error',
        errorMessage: message,
      })
    }
  })
}

export function isInstallingUpdate(): boolean {
  return installingUpdate
}

export function getNativeUpdateState(): NativeUpdateState {
  return { ...currentState }
}

export function isNativeUpdaterAvailable(): boolean {
  return initialized
}
