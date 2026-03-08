import { computed, reactive, ref, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import type { SftpExtractZipResponse, SSHErrorCode, SSHResult } from '../../../shared/types/ssh'
import { useI18n } from './useI18n'
import { useSftpDownloadCenter } from './useSftpDownloadCenter'
import type {
  RemoteBreadcrumbItem,
  RemoteDirectoryNode,
  RemoteDirectoryTreeRow,
  RemoteFileEntry,
  RemoteUploadItem,
  RemoteUploadProgress,
  SftpWithExtractZipApi,
  SftpWithWriteTextApi,
  UseRemoteFileBrowserStateOptions,
} from '../types/file-browser'
import {
  ROOT_REMOTE_PATH,
  buildRemoteBreadcrumbs,
  createDirectoryNode,
  getRemoteBasename,
  getRemoteParentPath,
  getRemotePathDepth,
  isDirectoryEntry,
  joinRemotePath,
  normalizeRemotePath,
  sortRemoteEntries,
  toErrorMessage,
} from '../types/file-browser'

interface UseRemoteFileBrowserStateParams extends UseRemoteFileBrowserStateOptions {
  sessionId: MaybeRefOrGetter<string | null | undefined>
}

interface LoadPathOptions {
  updateCurrent: boolean
  asRefresh: boolean
}

interface TreeLoadOptions {
  expandAncestors: boolean
}

const SFTP_LIST_READY_RETRY_DELAY_MS = 240
const SFTP_LIST_READY_RETRY_ATTEMPTS = 12
const i18n = useI18n()

function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params)
}
const downloadCenter = useSftpDownloadCenter()

interface SSHResultError extends Error {
  sshCode?: SSHErrorCode
  sshDetail?: string
}

function unwrapSSHResult<T>(result: SSHResult<T>, fallback: string): T {
  if (result.ok) {
    return result.data
  }

  const baseMessage = result.error?.message?.trim() || fallback
  const detail = result.error?.detail?.trim()
  const message = detail ? `${baseMessage}: ${detail}` : baseMessage
  const error = new Error(message) as SSHResultError
  if (result.error?.code) {
    error.sshCode = result.error.code
  }
  if (result.error?.detail) {
    error.sshDetail = result.error.detail
  }
  throw error
}

function normalizeSessionId(input: string | null | undefined): string | null {
  if (typeof input !== 'string') {
    return null
  }

  const value = input.trim()
  return value || null
}

function resolveSessionId(input: string | null | undefined): string {
  const sessionId = normalizeSessionId(input)
  if (!sessionId) {
    throw new Error(t('file.remoteState.error.sessionIdRequired'))
  }

  return sessionId
}

function toUploadPercent(completed: number, total: number): number {
  if (total <= 0) {
    return 0
  }

  return Math.min(100, Math.round((completed / total) * 100))
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isSftpSessionNotReadyError(reason: unknown): boolean {
  if (!reason || typeof reason !== 'object') {
    return false
  }

  const payload = reason as SSHResultError
  const code = payload.sshCode?.trim().toLowerCase() ?? ''
  const message = payload.message?.toLowerCase() ?? ''
  const detail = payload.sshDetail?.toLowerCase() ?? ''
  const combined = `${message} ${detail}`.trim()

  if (code === 'not_connected') {
    return true
  }

  if (code === 'sftp_error') {
    return (
      combined.includes('connect failed') ||
      combined.includes('not connected') ||
      combined.includes('config is not bound')
    )
  }

  return false
}

export function useRemoteFileBrowserState(params: UseRemoteFileBrowserStateParams) {
  const options: Required<UseRemoteFileBrowserStateOptions> = {
    initialPath: normalizeRemotePath(params.initialPath ?? ROOT_REMOTE_PATH),
    autoLoad: params.autoLoad ?? true,
  }

  const currentPath = ref(options.initialPath)
  const entries = ref<RemoteFileEntry[]>([])

  const initialized = ref(false)
  const loading = ref(false)
  const refreshing = ref(false)
  const operating = ref(false)
  const error = ref<string | null>(null)
  const uploadProgress = ref<RemoteUploadProgress>({
    active: false,
    total: 0,
    completed: 0,
    percent: 0,
    currentFileName: null,
  })

  const treeNodes = reactive<Record<string, RemoteDirectoryNode>>({})
  const activeLoadToken = ref(0)

  function ensureNode(path: string): RemoteDirectoryNode {
    const normalizedPath = normalizeRemotePath(path)
    const existing = treeNodes[normalizedPath]
    if (existing) {
      return existing
    }

    const node = createDirectoryNode(normalizedPath)
    treeNodes[normalizedPath] = node
    return node
  }

  function resetTree(): void {
    for (const key of Object.keys(treeNodes)) {
      delete treeNodes[key]
    }

    const root = ensureNode(ROOT_REMOTE_PATH)
    root.expanded = true
  }

  function sortPaths(paths: string[]): string[] {
    return [...paths].sort((left, right) => getRemoteBasename(left).localeCompare(getRemoteBasename(right)))
  }

  function setChildren(nodePath: string, childPaths: string[]): void {
    const node = ensureNode(nodePath)
    const normalized = sortPaths(
      [...new Set(childPaths.map((item) => normalizeRemotePath(item)))],
    )

    node.childrenPaths = normalized
    node.loaded = true
    node.loading = false
    node.error = null

    for (const childPath of normalized) {
      const childNode = ensureNode(childPath)
      childNode.parentPath = node.path
    }
  }

  function linkParentAndChild(parentPath: string, childPath: string): void {
    const parent = ensureNode(parentPath)
    const normalizedChild = normalizeRemotePath(childPath)

    if (!parent.childrenPaths.includes(normalizedChild)) {
      parent.childrenPaths = sortPaths([...parent.childrenPaths, normalizedChild])
    }

    const child = ensureNode(normalizedChild)
    child.parentPath = parent.path
  }

  function expandPathAncestors(path: string): void {
    const normalized = normalizeRemotePath(path)
    const parts = normalized === ROOT_REMOTE_PATH ? [] : normalized.slice(1).split('/')

    const root = ensureNode(ROOT_REMOTE_PATH)
    root.expanded = true

    if (parts.length === 0) {
      return
    }

    let cursor = ROOT_REMOTE_PATH
    for (const part of parts) {
      const nextPath = cursor === ROOT_REMOTE_PATH ? `/${part}` : `${cursor}/${part}`
      linkParentAndChild(cursor, nextPath)

      const parentNode = ensureNode(cursor)
      parentNode.expanded = true

      cursor = nextPath
    }
  }

  async function listRemote(path: string): Promise<RemoteFileEntry[]> {
    const sessionId = resolveSessionId(toValue(params.sessionId))
    let attempt = 0

    while (true) {
      const result = await window.electronAPI.ssh.sftp.list({
        sessionId,
        remotePath: path,
      })

      try {
        return sortRemoteEntries(unwrapSSHResult(result, t('file.remoteState.error.loadRemoteDirectoryFailed')))
      } catch (reason) {
        if (!isSftpSessionNotReadyError(reason) || attempt >= SFTP_LIST_READY_RETRY_ATTEMPTS) {
          throw reason
        }

        attempt += 1
        await wait(SFTP_LIST_READY_RETRY_DELAY_MS)
      }
    }
  }

  async function loadTreeChildren(path: string, options: TreeLoadOptions = { expandAncestors: false }): Promise<void> {
    const normalized = normalizeRemotePath(path)
    const node = ensureNode(normalized)

    node.loading = true
    node.error = null

    try {
      const rows = await listRemote(normalized)
      const directoryPaths = rows.filter(isDirectoryEntry).map((item) => item.path)

      setChildren(normalized, directoryPaths)
      if (options.expandAncestors) {
        expandPathAncestors(normalized)
      }
    } catch (reason) {
      node.loading = false
      node.loaded = false
      node.error = toErrorMessage(reason, t('file.remoteState.error.loadDirectoryTreeFailed'))
      throw reason
    }
  }

  async function loadPath(path: string, options: LoadPathOptions = { updateCurrent: true, asRefresh: false }): Promise<void> {
    const normalized = normalizeRemotePath(path)
    const token = ++activeLoadToken.value

    if (options.updateCurrent) {
      if (options.asRefresh) {
        refreshing.value = true
      } else {
        loading.value = true
      }
      error.value = null
    }

    const node = ensureNode(normalized)
    node.loading = true
    node.error = null

    try {
      const rows = await listRemote(normalized)
      const directoryPaths = rows.filter(isDirectoryEntry).map((item) => item.path)

      setChildren(normalized, directoryPaths)

      if (token !== activeLoadToken.value) {
        return
      }

      if (options.updateCurrent) {
        entries.value = rows
        currentPath.value = normalized
        initialized.value = true
        expandPathAncestors(normalized)
      }
    } catch (reason) {
      node.loading = false
      node.loaded = false
      node.error = toErrorMessage(reason, t('file.remoteState.error.loadDirectoryFailed'))

      if (token !== activeLoadToken.value) {
        return
      }

      if (options.updateCurrent) {
        error.value = toErrorMessage(reason, t('file.remoteState.error.loadDirectoryFailed'))
      }
      throw reason
    } finally {
      if (token !== activeLoadToken.value || !options.updateCurrent) {
        return
      }

      if (options.asRefresh) {
        refreshing.value = false
      } else {
        loading.value = false
      }
    }
  }

  async function navigateTo(path: string): Promise<void> {
    await loadPath(path, { updateCurrent: true, asRefresh: false })
  }

  async function refresh(): Promise<void> {
    await loadPath(currentPath.value, { updateCurrent: true, asRefresh: true })
  }

  async function openEntry(entry: RemoteFileEntry): Promise<void> {
    if (!isDirectoryEntry(entry)) {
      return
    }

    await navigateTo(entry.path)
  }

  async function toggleTreeNode(path: string): Promise<void> {
    const node = ensureNode(path)
    node.expanded = !node.expanded

    if (!node.expanded || node.loaded || node.loading) {
      return
    }

    await loadTreeChildren(node.path)
  }

  async function selectTreeNode(path: string): Promise<void> {
    const normalized = normalizeRemotePath(path)
    const node = ensureNode(normalized)
    node.expanded = true

    if (!node.loaded && !node.loading) {
      await loadTreeChildren(normalized, { expandAncestors: true })
    }

    await navigateTo(normalized)
  }

  async function runSftpMutation<T>(
    operation: (sessionId: string) => Promise<T>,
    fallbackMessage: string,
  ): Promise<T> {
    const sessionId = resolveSessionId(toValue(params.sessionId))

    operating.value = true
    error.value = null

    try {
      return await operation(sessionId)
    } catch (reason) {
      error.value = toErrorMessage(reason, fallbackMessage)
      throw reason
    } finally {
      operating.value = false
    }
  }

  async function createFile(name: string, content = ''): Promise<string> {
    const remotePath = joinRemotePath(currentPath.value, name)
    await runSftpMutation(async (sessionId) => {
      const sftpApi = window.electronAPI.ssh.sftp as typeof window.electronAPI.ssh.sftp & SftpWithWriteTextApi
      if (typeof sftpApi.writeText !== 'function') {
        throw new Error(t('file.remoteState.error.writeTextApiUnavailable'))
      }

      const result = await sftpApi.writeText({
        sessionId,
        remotePath,
        content,
      })

      unwrapSSHResult(result, t('file.remoteState.error.createFileFailed'))
    }, t('file.remoteState.error.createFileFailed'))

    await refresh()
    return remotePath
  }

  async function createDirectory(name: string): Promise<string> {
    const remotePath = joinRemotePath(currentPath.value, name)

    await runSftpMutation(async (sessionId) => {
      const result = await window.electronAPI.ssh.sftp.mkdir({
        sessionId,
        remotePath,
        recursive: false,
      })

      unwrapSSHResult(result, t('file.remoteState.error.createDirectoryFailed'))
    }, t('file.remoteState.error.createDirectoryFailed'))

    await refresh()
    return remotePath
  }

  async function removeEntry(entry: RemoteFileEntry): Promise<void> {
    const isDirectory = isDirectoryEntry(entry)

    await runSftpMutation(async (sessionId) => {
      const result = await window.electronAPI.ssh.sftp.rm({
        sessionId,
        remotePath: entry.path,
        recursive: isDirectory,
        isDirectory,
      })

      unwrapSSHResult(result, t('file.remoteState.error.deleteFailed'))
    }, t('file.remoteState.error.deleteFailed'))

    await refresh()
  }

  async function renameEntry(entry: RemoteFileEntry, nextName: string): Promise<string> {
    const parentPath = getRemoteParentPath(entry.path) ?? currentPath.value
    const targetPath = joinRemotePath(parentPath, nextName)

    if (targetPath === entry.path) {
      return targetPath
    }

    await runSftpMutation(async (sessionId) => {
      const result = await window.electronAPI.ssh.sftp.rename({
        sessionId,
        fromPath: entry.path,
        toPath: targetPath,
      })

      unwrapSSHResult(result, t('file.remoteState.error.renameFailed'))
    }, t('file.remoteState.error.renameFailed'))

    await refresh()
    return targetPath
  }

  async function uploadFiles(items: RemoteUploadItem[]): Promise<void> {
    if (!items.length) {
      return
    }

    const uploadDirectories = [...new Set(
      items
        .map((item) => getRemoteParentPath(item.remotePath))
        .filter((path): path is string => Boolean(path && path !== ROOT_REMOTE_PATH)),
    )].sort((left, right) => getRemotePathDepth(left) - getRemotePathDepth(right))

    uploadProgress.value = {
      active: true,
      total: items.length,
      completed: 0,
      percent: 0,
      currentFileName: null,
    }

    try {
      await runSftpMutation(async (sessionId) => {
        const existingEntryCache = new Map<string, Map<string, RemoteFileEntry>>()

        const getCachedEntryMap = async (directoryPath: string): Promise<Map<string, RemoteFileEntry>> => {
          const cached = existingEntryCache.get(directoryPath)
          if (cached) {
            return cached
          }

          const rows = await listRemote(directoryPath)
          const nextMap = new Map(rows.map((row) => [row.name, row]))
          existingEntryCache.set(directoryPath, nextMap)
          return nextMap
        }

        const removeCachedEntry = (remotePath: string): void => {
          const parentPath = getRemoteParentPath(remotePath) ?? ROOT_REMOTE_PATH
          const name = getRemoteBasename(remotePath)
          if (!name) {
            return
          }
          existingEntryCache.get(parentPath)?.delete(name)
        }

        const setCachedFileEntry = (remotePath: string): void => {
          const parentPath = getRemoteParentPath(remotePath) ?? ROOT_REMOTE_PATH
          const name = getRemoteBasename(remotePath)
          if (!name) {
            return
          }

          const cache = existingEntryCache.get(parentPath)
          if (!cache) {
            return
          }

          cache.set(name, {
            name,
            path: remotePath,
            type: 'file',
            size: 0,
            modifyTime: 0,
            accessTime: 0,
          })
        }

        const ensureOverwriteReady = async (remotePath: string): Promise<void> => {
          const parentPath = getRemoteParentPath(remotePath) ?? ROOT_REMOTE_PATH
          const name = getRemoteBasename(remotePath)
          if (!name) {
            return
          }

          const cache = await getCachedEntryMap(parentPath)
          const existing = cache.get(name)
          if (!existing) {
            return
          }

          if (existing.type === 'directory') {
            throw new Error(
              t('file.remote.error.uploadConflictDirectory', {
                path: remotePath,
              }),
            )
          }

          const removeResult = await window.electronAPI.ssh.sftp.rm({
            sessionId,
            remotePath,
            recursive: false,
            isDirectory: false,
          })
          unwrapSSHResult(removeResult, t('file.remoteState.error.uploadFailed'))
          removeCachedEntry(remotePath)
        }

        for (const directoryPath of uploadDirectories) {
          const mkdirResult = await window.electronAPI.ssh.sftp.mkdir({
            sessionId,
            remotePath: directoryPath,
            recursive: true,
          })

          unwrapSSHResult(mkdirResult, t('file.remoteState.error.uploadFailed'))
        }

        for (let index = 0; index < items.length; index += 1) {
          const item = items[index]
          const completed = index + 1
          let tracker:
            | ReturnType<typeof downloadCenter.startInvokeUpload>
            | null = null

          uploadProgress.value = {
            ...uploadProgress.value,
            currentFileName: getRemoteBasename(item.remotePath),
          }

          try {
            tracker = downloadCenter.startInvokeUpload({
              sessionId,
              remotePath: item.remotePath,
              localPath: item.localPath,
            })

            await ensureOverwriteReady(item.remotePath)

            const result = await window.electronAPI.ssh.sftp.put({
              sessionId,
              localPath: item.localPath,
              remotePath: item.remotePath,
            })

            unwrapSSHResult(result, t('file.remoteState.error.uploadFailed'))
            setCachedFileEntry(item.remotePath)
            if (tracker) {
              downloadCenter.completeInvokeUpload(tracker)
            }
          } catch (reason) {
            if (tracker) {
              downloadCenter.failInvokeUpload(
                tracker,
                reason instanceof Error ? reason.message : String(reason),
              )
            }
            throw reason
          } finally {
            uploadProgress.value = {
              ...uploadProgress.value,
              completed,
              percent: toUploadPercent(completed, items.length),
            }
          }
        }
      }, t('file.remoteState.error.uploadFailed'))

      await refresh()
    } finally {
      uploadProgress.value = {
        ...uploadProgress.value,
        active: false,
        currentFileName: null,
      }
    }
  }

  async function downloadFile(entry: RemoteFileEntry, localPath: string): Promise<void> {
    let tracker:
      | ReturnType<typeof downloadCenter.startInvokeDownload>
      | null = null
    try {
      await runSftpMutation(async (sessionId) => {
        tracker = downloadCenter.startInvokeDownload({
          sessionId,
          remotePath: entry.path,
          localPath,
        })

        const result = await window.electronAPI.ssh.sftp.get({
          sessionId,
          remotePath: entry.path,
          localPath,
        })

        unwrapSSHResult(result, t('file.remoteState.error.downloadFailed'))
      }, t('file.remoteState.error.downloadFailed'))

      if (tracker) {
        downloadCenter.completeInvokeDownload(tracker)
      }
    } catch (reason) {
      if (tracker) {
        downloadCenter.failInvokeDownload(
          tracker,
          reason instanceof Error ? reason.message : String(reason),
        )
      }
      throw reason
    }
  }

  async function extractZip(
    entry: RemoteFileEntry,
    targetDirectoryPath?: string,
  ): Promise<SftpExtractZipResponse> {
    const resolvedTargetPath = (targetDirectoryPath ?? '').trim() || undefined

    return await runSftpMutation(async (sessionId) => {
      const sftpApi = window.electronAPI.ssh.sftp as typeof window.electronAPI.ssh.sftp & SftpWithExtractZipApi
      if (typeof sftpApi.extractZip !== 'function') {
        throw new Error(t('file.remoteState.error.extractZipApiUnavailable'))
      }

      const result = await sftpApi.extractZip({
        sessionId,
        remoteZipPath: entry.path,
        targetDirectoryPath: resolvedTargetPath,
      })
      const response = unwrapSSHResult(result, t('file.remoteState.error.extractZipFailed'))
      await refresh()
      return response
    }, t('file.remoteState.error.extractZipFailed'))
  }

  function clearState(): void {
    entries.value = []
    loading.value = false
    refreshing.value = false
    operating.value = false
    error.value = null
    uploadProgress.value = {
      active: false,
      total: 0,
      completed: 0,
      percent: 0,
      currentFileName: null,
    }
    initialized.value = false
    currentPath.value = options.initialPath
    activeLoadToken.value = 0
    resetTree()
  }

  const breadcrumbs = computed<RemoteBreadcrumbItem[]>(() => buildRemoteBreadcrumbs(currentPath.value))

  const treeRows = computed<RemoteDirectoryTreeRow[]>(() => {
    const rows: RemoteDirectoryTreeRow[] = []

    const walk = (path: string): void => {
      const node = treeNodes[path]
      if (!node) {
        return
      }

      rows.push({
        path: node.path,
        name: node.name,
        depth: getRemotePathDepth(node.path),
        expanded: node.expanded,
        loading: node.loading,
        loaded: node.loaded,
        error: node.error,
        isActive: currentPath.value === node.path,
      })

      if (!node.expanded) {
        return
      }

      for (const childPath of node.childrenPaths) {
        walk(childPath)
      }
    }

    walk(ROOT_REMOTE_PATH)

    if (!rows.some((item) => item.path === currentPath.value)) {
      rows.push({
        path: currentPath.value,
        name: getRemoteBasename(currentPath.value),
        depth: getRemotePathDepth(currentPath.value),
        expanded: false,
        loading: false,
        loaded: true,
        error: null,
        isActive: true,
      })
    }

    return rows
  })

  const hasSession = computed(() => Boolean(normalizeSessionId(toValue(params.sessionId))))

  watch(
    () => normalizeSessionId(toValue(params.sessionId)),
    (nextSessionId, prevSessionId) => {
      if (nextSessionId === prevSessionId) {
        return
      }

      clearState()

      if (!nextSessionId || !options.autoLoad) {
        return
      }

      void navigateTo(options.initialPath)
    },
    { immediate: true },
  )

  return {
    currentPath,
    entries,
    breadcrumbs,
    treeRows,
    loading,
    refreshing,
    operating,
    uploadProgress,
    error,
    initialized,
    hasSession,
    navigateTo,
    refresh,
    openEntry,
    createFile,
    createDirectory,
    removeEntry,
    renameEntry,
    uploadFiles,
    downloadFile,
    extractZip,
    toggleTreeNode,
    selectTreeNode,
  }
}
