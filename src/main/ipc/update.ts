import { BrowserWindow, dialog, shell } from 'electron'
import type { IpcMain, IpcMainInvokeEvent, MessageBoxOptions } from 'electron'

import { UPDATE_IPC_CHANNELS } from '../../shared/ipc/channels'
import type {
  UpdateCheckResponse,
  UpdateErrorCode,
  UpdateErrorPayload,
  UpdateOpenReleaseRequest,
  UpdateOpenReleaseResponse,
  UpdatePromptRequest,
  UpdatePromptResponse,
  UpdateResult,
} from '../../shared/types/update'
import {
  checkForUpdatesWithInstaller,
  isNativeUpdaterAvailable,
  setLastCheckWasManual,
} from '../auto-updater'
import type { AppLogger } from '../logger'

type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>

export interface UpdateIPCContext {
  owner: string
  repo: string
  currentVersion: string
  releasesPageUrl: string
  logger?: AppLogger
}

interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

interface GitHubLatestReleasePayload {
  tag_name?: unknown
  html_url?: unknown
  published_at?: unknown
}

class UpdateIPCError extends Error {
  public readonly code: UpdateErrorCode
  public readonly detail?: string

  constructor(code: UpdateErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'UpdateIPCError'
    this.code = code
    this.detail = detail
  }
}

function buildLatestReleaseApiUrl(context: UpdateIPCContext): string {
  return `https://api.github.com/repos/${context.owner}/${context.repo}/releases/latest`
}

function normalizeVersion(input: string): string {
  return input.trim().replace(/^v/i, '')
}

function parseSemver(input: string): ParsedSemver | null {
  const normalized = normalizeVersion(input)
  const matched = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!matched) {
    return null
  }

  return {
    major: Number.parseInt(matched[1] ?? '0', 10),
    minor: Number.parseInt(matched[2] ?? '0', 10),
    patch: Number.parseInt(matched[3] ?? '0', 10),
    prerelease: matched[4] ? matched[4].split('.').filter(Boolean) : [],
  }
}

function compareIdentifier(left: string, right: string): number {
  const leftNumber = Number.parseInt(left, 10)
  const rightNumber = Number.parseInt(right, 10)
  const leftIsNumber = String(leftNumber) === left
  const rightIsNumber = String(rightNumber) === right

  if (leftIsNumber && rightIsNumber) {
    return leftNumber - rightNumber
  }
  if (leftIsNumber) {
    return -1
  }
  if (rightIsNumber) {
    return 1
  }
  return left.localeCompare(right)
}

function compareSemver(leftRaw: string, rightRaw: string): number | null {
  const left = parseSemver(leftRaw)
  const right = parseSemver(rightRaw)
  if (!left || !right) {
    return null
  }

  if (left.major !== right.major) {
    return left.major - right.major
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor
  }
  if (left.patch !== right.patch) {
    return left.patch - right.patch
  }

  const leftPre = left.prerelease
  const rightPre = right.prerelease
  if (leftPre.length === 0 && rightPre.length === 0) {
    return 0
  }
  if (leftPre.length === 0) {
    return 1
  }
  if (rightPre.length === 0) {
    return -1
  }

  const maxLength = Math.max(leftPre.length, rightPre.length)
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftPre[index]
    const rightPart = rightPre[index]
    if (leftPart === undefined) {
      return -1
    }
    if (rightPart === undefined) {
      return 1
    }
    const compared = compareIdentifier(leftPart, rightPart)
    if (compared !== 0) {
      return compared
    }
  }
  return 0
}

function isRemoteVersionNewer(currentVersion: string, latestVersion: string): boolean {
  const compared = compareSemver(latestVersion, currentVersion)
  if (compared === null) {
    return normalizeVersion(latestVersion) !== normalizeVersion(currentVersion)
  }
  return compared > 0
}

function normalizeReleaseUrl(
  rawValue: unknown,
  fallbackUrl: string,
): string {
  if (typeof rawValue !== 'string') {
    return fallbackUrl
  }
  const trimmed = rawValue.trim()
  if (!trimmed) {
    return fallbackUrl
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return fallbackUrl
  }
  return trimmed
}

function toUpdateErrorPayload(error: unknown): UpdateErrorPayload {
  if (error instanceof UpdateIPCError) {
    return {
      code: error.code,
      message: error.message,
      detail: error.detail,
    }
  }

  if (error instanceof Error) {
    return {
      code: 'unknown_error',
      message: error.message || 'Unexpected update IPC error',
    }
  }

  return {
    code: 'unknown_error',
    message: String(error),
  }
}

async function toResult<T>(execute: () => Promise<T> | T): Promise<UpdateResult<T>> {
  try {
    const data = await execute()
    return { ok: true, data }
  } catch (error) {
    return {
      ok: false,
      error: toUpdateErrorPayload(error),
    }
  }
}

async function fetchLatestRelease(context: UpdateIPCContext): Promise<{
  latestTag: string
  latestVersion: string
  releaseUrl: string
}> {
  const response = await fetch(buildLatestReleaseApiUrl(context), {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': `NovarTerm/${context.currentVersion}`,
    },
  })
  if (!response.ok) {
    throw new UpdateIPCError(
      'network_error',
      `Failed to fetch latest release (${response.status})`,
      response.statusText,
    )
  }

  let payload: GitHubLatestReleasePayload
  try {
    payload = (await response.json()) as GitHubLatestReleasePayload
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new UpdateIPCError('invalid_response', 'Failed to parse release payload', message)
  }

  if (typeof payload.tag_name !== 'string' || !payload.tag_name.trim()) {
    throw new UpdateIPCError('invalid_response', 'Release payload missing tag_name')
  }

  const latestTag = payload.tag_name.trim()
  return {
    latestTag,
    latestVersion: normalizeVersion(latestTag),
    releaseUrl: normalizeReleaseUrl(payload.html_url, context.releasesPageUrl),
  }
}

export async function checkForUpdates(
  context: UpdateIPCContext,
): Promise<UpdateResult<UpdateCheckResponse>> {
  return toResult(async () => {
    const latest = await fetchLatestRelease(context)
    return {
      currentVersion: normalizeVersion(context.currentVersion),
      latestVersion: latest.latestVersion,
      latestTag: latest.latestTag,
      releaseUrl: latest.releaseUrl,
      hasUpdate: isRemoteVersionNewer(context.currentVersion, latest.latestVersion),
      checkedAt: new Date().toISOString(),
    } satisfies UpdateCheckResponse
  })
}

export async function openReleasePage(
  context: UpdateIPCContext,
  request?: UpdateOpenReleaseRequest,
): Promise<UpdateResult<UpdateOpenReleaseResponse>> {
  return toResult(async () => {
    const releaseUrl = normalizeReleaseUrl(request?.releaseUrl, context.releasesPageUrl)
    await shell.openExternal(releaseUrl)
    return {
      opened: true,
      releaseUrl,
    } satisfies UpdateOpenReleaseResponse
  })
}

export async function promptForUpdateAndMaybeOpen(
  parentWindow: BrowserWindow | null,
  request: UpdatePromptRequest,
  fallbackReleaseUrl: string,
): Promise<UpdatePromptResponse> {
  const releaseUrl = normalizeReleaseUrl(request.releaseUrl, fallbackReleaseUrl)
  const options: MessageBoxOptions = {
    type: 'info',
    buttons: ['Update Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: 'Update Available',
    message: `A new version is available: ${request.latestVersion}`,
    detail: [
      `Current version: ${request.currentVersion}`,
      `Latest version: ${request.latestVersion}`,
      request.latestTag ? `Release tag: ${request.latestTag}` : '',
      '',
      'Click "Update Now" to open the download page.',
    ]
      .filter(Boolean)
      .join('\n'),
  }

  const result = parentWindow
    ? await dialog.showMessageBox(parentWindow, options)
    : await dialog.showMessageBox(options)

  if (result.response === 0) {
    await shell.openExternal(releaseUrl)
    return {
      action: 'update',
      openedReleasePage: true,
      releaseUrl,
    }
  }

  return {
    action: 'later',
    openedReleasePage: false,
    releaseUrl,
  }
}

export interface RegisterUpdateIPCOptions {
  /** When true and native updater is available, check uses electron-updater (download + restart). */
  useNativeUpdater?: boolean
}

export function registerUpdateIPCHandlers(
  ipcMain: IpcMainLike,
  context: UpdateIPCContext,
  options: RegisterUpdateIPCOptions = {},
): void {
  clearUpdateIPCHandlers(ipcMain)
  const useNative = Boolean(options.useNativeUpdater && isNativeUpdaterAvailable())

  ipcMain.handle(UPDATE_IPC_CHANNELS.check, async () => {
    if (useNative) {
      setLastCheckWasManual(true)
      const result = await toResult(async () => {
        const checkResult = await checkForUpdatesWithInstaller()
        const hasUpdate = checkResult?.isUpdateAvailable ?? false
        if (!hasUpdate) {
          setLastCheckWasManual(false)
        }
        const currentVersion = context.currentVersion.replace(/^v/i, '').trim()
        const latestVersion = checkResult?.updateInfo?.version?.replace(/^v/i, '').trim() ?? currentVersion
        return {
          currentVersion,
          latestVersion,
          latestTag: checkResult?.updateInfo?.version ?? latestVersion,
          releaseUrl: context.releasesPageUrl,
          hasUpdate,
          checkedAt: new Date().toISOString(),
        } satisfies UpdateCheckResponse
      })
      if (!result.ok) {
        setLastCheckWasManual(false)
      }
      return result
    }
    return checkForUpdates(context)
  })

  ipcMain.handle(
    UPDATE_IPC_CHANNELS.openReleasePage,
    async (_event: IpcMainInvokeEvent, request: UpdateOpenReleaseRequest | undefined) =>
      openReleasePage(context, request),
  )

  ipcMain.handle(
    UPDATE_IPC_CHANNELS.promptForUpdate,
    async (event: IpcMainInvokeEvent, request: UpdatePromptRequest) =>
      toResult(async () => {
        const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? null
        return promptForUpdateAndMaybeOpen(parentWindow, request, context.releasesPageUrl)
      }),
  )

  context.logger?.info('update', 'registered update IPC handlers')
}

export function clearUpdateIPCHandlers(ipcMain: IpcMainLike): void {
  for (const channel of Object.values(UPDATE_IPC_CHANNELS)) {
    ipcMain.removeHandler(channel)
  }
}
