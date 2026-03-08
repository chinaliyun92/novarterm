<script setup lang="ts">
import { computed, toRef } from 'vue'
import type { SftpListItem } from '../../../../shared/types/ssh'
import type { LocalFileListData } from '../../../../shared/types/local-file'
import { useI18n } from '../../composables/useI18n'
import { useRemoteFileBrowserState } from '../../composables/useRemoteFileBrowserState'
import {
  getRemoteParentPath,
  isZipFileName,
  joinRemotePath,
  normalizeRemotePath,
  normalizeRemoteEntryName,
  type RemoteFileEntry,
  type RemoteUploadItem,
} from '../../types/file-browser'
import UnifiedFileBrowser, { type UnifiedFileEntry } from './UnifiedFileBrowser.vue'

const i18n = useI18n()

function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params)
}

interface RemoteFileBrowserProps {
  paneSessionId?: string | null
  sessionId: string | null
  initialPath?: string
  autoLoad?: boolean
  emptyText?: string
  sessionCwd?: string | null
}

const props = withDefaults(defineProps<RemoteFileBrowserProps>(), {
  paneSessionId: null,
  initialPath: '/',
  autoLoad: true,
  emptyText: '',
  sessionCwd: null,
})

const resolvedEmptyText = computed<string>(() => {
  const value = props.emptyText?.trim() ?? ''
  return value || t('file.emptyDirectory')
})

const emit = defineEmits<{
  (event: 'path-change', path: string): void
  (event: 'entry-click', entry: RemoteFileEntry): void
  (event: 'error', message: string): void
}>()

const state = useRemoteFileBrowserState({
  sessionId: toRef(props, 'sessionId'),
  initialPath: props.initialPath,
  autoLoad: false,
})

function toUnifiedEntry(entry: RemoteFileEntry): UnifiedFileEntry {
  return {
    name: entry.name,
    path: entry.path,
    type: entry.type,
    size: entry.type === 'directory' ? null : entry.size,
    modifiedAt: Number.isFinite(entry.modifyTime) && entry.modifyTime > 0 ? new Date(entry.modifyTime).toISOString() : null,
    raw: entry,
  }
}

function toRemoteEntry(entry: UnifiedFileEntry): RemoteFileEntry {
  const raw = entry.raw
  if (raw && typeof raw === 'object') {
    return raw as RemoteFileEntry
  }

  return {
    name: entry.name,
    path: entry.path,
    type: entry.type,
    size: Number.isFinite(entry.size) && entry.size !== null ? entry.size : 0,
    modifyTime: entry.modifiedAt ? Date.parse(entry.modifiedAt) : 0,
    accessTime: entry.modifiedAt ? Date.parse(entry.modifiedAt) : 0,
  } satisfies SftpListItem
}

async function listRemotePath(path: string): Promise<{ path: string; parentPath: string | null; entries: UnifiedFileEntry[] }> {
  if (!state.hasSession.value) {
    throw new Error(t('file.remote.error.sessionRequired'))
  }

  const normalizedPath = normalizeRemotePath(path)
  await state.navigateTo(normalizedPath)

  const resolvedPath = normalizeRemotePath(state.currentPath.value)
  return {
    path: resolvedPath,
    parentPath: getRemoteParentPath(resolvedPath),
    entries: state.entries.value.map(toUnifiedEntry),
  }
}

async function createRemoteFile(_currentPath: string, name: string): Promise<void> {
  const normalizedCurrentPath = normalizeRemotePath(_currentPath)
  if (normalizedCurrentPath !== normalizeRemotePath(state.currentPath.value)) {
    await state.navigateTo(normalizedCurrentPath)
  }
  await state.createFile(name, '')
}

async function createRemoteDirectory(_currentPath: string, name: string): Promise<void> {
  const normalizedCurrentPath = normalizeRemotePath(_currentPath)
  if (normalizedCurrentPath !== normalizeRemotePath(state.currentPath.value)) {
    await state.navigateTo(normalizedCurrentPath)
  }
  await state.createDirectory(name)
}

async function renameRemoteEntry(entry: UnifiedFileEntry, nextName: string): Promise<void> {
  await state.renameEntry(toRemoteEntry(entry), nextName)
}

async function deleteRemoteEntry(entry: UnifiedFileEntry): Promise<void> {
  await state.removeEntry(toRemoteEntry(entry))
}

function resolveLocalPath(file: File): string | null {
  const direct = (file as File & { path?: string }).path
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim()
  }

  const resolved = window.electronAPI.terminal.resolveFilePath?.(file)
  if (typeof resolved === 'string' && resolved.trim()) {
    return resolved.trim()
  }

  return null
}

function normalizeUploadRelativePath(value: string): string | null {
  const normalized = value.replaceAll('\\', '/').trim()
  if (!normalized) {
    return null
  }

  const parts = normalized
    .split('/')
    .map((item) => item.trim())
    .filter((item) => item && item !== '.')

  if (!parts.length) {
    return null
  }

  if (parts.some((part) => part === '..')) {
    return null
  }

  const [first, ...rest] = parts
  const safeFirst = normalizeRemoteEntryName(first)
  if (!safeFirst) {
    return null
  }

  return [safeFirst, ...rest].join('/')
}

function joinRelativeUploadPath(base: string, next: string): string {
  const normalizedBase = base.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  const normalizedNext = next.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  if (!normalizedBase) {
    return normalizedNext
  }
  if (!normalizedNext) {
    return normalizedBase
  }
  return `${normalizedBase}/${normalizedNext}`
}

function toPathBasename(localPath: string): string {
  const normalized = localPath.replaceAll('\\', '/')
  const segments = normalized.split('/').filter((item) => item.length > 0)
  return segments.length ? segments[segments.length - 1] : ''
}

async function listLocalDirectoryEntries(localPath: string): Promise<LocalFileListData['entries'] | null> {
  try {
    const result = await window.electronAPI.localFile.list({ path: localPath })
    if (!result.ok) {
      return null
    }

    return result.data.entries
  } catch {
    return null
  }
}

async function appendDirectoryUploadItems(
  localDirectoryPath: string,
  relativePrefix: string,
  currentPath: string,
  uploads: RemoteUploadItem[],
): Promise<void> {
  const entries = await listLocalDirectoryEntries(localDirectoryPath)
  if (!entries?.length) {
    return
  }

  for (const entry of entries) {
    const entryName = normalizeRemoteEntryName(entry.name)
    if (!entryName) {
      continue
    }

    const entryRelativePath = joinRelativeUploadPath(relativePrefix, entryName)
    if (entry.type === 'directory') {
      await appendDirectoryUploadItems(entry.path, entryRelativePath, currentPath, uploads)
      continue
    }

    if (entry.type !== 'file' && entry.type !== 'link' && entry.type !== 'unknown') {
      continue
    }

    uploads.push({
      localPath: entry.path,
      remotePath: joinRemotePath(currentPath, entryRelativePath),
    })
  }
}

async function uploadRemoteFiles(currentPath: string, files: File[]): Promise<void> {
  const uploads: RemoteUploadItem[] = []
  let skippedCount = 0

  for (const file of files) {
    const localPath = resolveLocalPath(file)
    if (!localPath) {
      skippedCount += 1
      continue
    }

    uploads.push({
      localPath,
      remotePath: joinRemotePath(currentPath, file.name),
    })
  }

  if (!uploads.length) {
    throw new Error(t('file.remote.error.noUploadPathDetected'))
  }

  const confirmed = window.confirm(
    t('file.remote.confirm.uploadFiles', {
      count: uploads.length,
      path: currentPath,
      skippedText:
        skippedCount > 0
          ? `\n${t('file.remote.upload.skippedCount', { count: skippedCount })}`
          : '',
    }),
  )
  if (!confirmed) {
    return
  }

  await state.uploadFiles(uploads)
}

async function uploadRemotePaths(currentPath: string, localPaths: string[]): Promise<void> {
  const uploads: RemoteUploadItem[] = []
  let skippedCount = 0

  for (const localPath of localPaths) {
    const normalizedLocalPath = localPath.trim()
    if (!normalizedLocalPath) {
      skippedCount += 1
      continue
    }

    const rootName = normalizeRemoteEntryName(toPathBasename(normalizedLocalPath))
    if (!rootName) {
      skippedCount += 1
      continue
    }

    const beforeCount = uploads.length
    const directoryEntries = await listLocalDirectoryEntries(normalizedLocalPath)
    if (directoryEntries !== null) {
      await appendDirectoryUploadItems(normalizedLocalPath, rootName, currentPath, uploads)
      if (uploads.length === beforeCount) {
        skippedCount += 1
      }
      continue
    }

    uploads.push({
      localPath: normalizedLocalPath,
      remotePath: joinRemotePath(currentPath, rootName),
    })
  }

  if (!uploads.length) {
    throw new Error(t('file.remote.error.noUploadPathDetected'))
  }

  const confirmed = window.confirm(
    t('file.remote.confirm.uploadFiles', {
      count: uploads.length,
      path: currentPath,
      skippedText:
        skippedCount > 0
          ? `\n${t('file.remote.upload.skippedCount', { count: skippedCount })}`
          : '',
    }),
  )
  if (!confirmed) {
    return
  }

  await state.uploadFiles(uploads)
}

async function uploadRemoteDirectory(currentPath: string, files: File[]): Promise<void> {
  const uploads: RemoteUploadItem[] = []
  let skippedCount = 0

  for (const file of files) {
    const localPath = resolveLocalPath(file)
    if (!localPath) {
      skippedCount += 1
      continue
    }

    const relativePath = normalizeUploadRelativePath(file.webkitRelativePath || file.name)
    if (!relativePath) {
      skippedCount += 1
      continue
    }

    uploads.push({
      localPath,
      remotePath: joinRemotePath(currentPath, relativePath),
    })
  }

  if (!uploads.length) {
    throw new Error(t('file.remote.error.noUploadDirectoryDetected'))
  }

  const confirmed = window.confirm(
    t('file.remote.confirm.uploadDirectory', {
      count: uploads.length,
      path: currentPath,
      skippedText:
        skippedCount > 0
          ? `\n${t('file.remote.upload.skippedCount', { count: skippedCount })}`
          : '',
    }),
  )
  if (!confirmed) {
    return
  }

  await state.uploadFiles(uploads)
}

async function downloadRemoteEntry(entry: UnifiedFileEntry): Promise<void> {
  const remoteEntry = toRemoteEntry(entry)
  if (remoteEntry.type !== 'file') {
    throw new Error(t('file.remote.error.downloadFileOnly'))
  }

  const saveDialogResult = await window.electronAPI.dialog.saveFile({
    title: t('file.remote.dialog.saveTitle', { name: remoteEntry.name }),
    defaultPath: remoteEntry.name,
    buttonLabel: t('file.remote.dialog.saveButton'),
  })
  if (saveDialogResult.canceled || !saveDialogResult.filePath) {
    return
  }

  await state.downloadFile(remoteEntry, saveDialogResult.filePath)
}

function canExtractRemoteEntry(entry: UnifiedFileEntry): boolean {
  return entry.type === 'file' && isZipFileName(entry.name)
}

async function extractRemoteEntry(entry: UnifiedFileEntry): Promise<void> {
  const remoteEntry = toRemoteEntry(entry)
  if (remoteEntry.type !== 'file' || !isZipFileName(remoteEntry.name)) {
    throw new Error(t('file.remote.error.extractZipOnly'))
  }

  const confirmed = window.confirm(
    t('file.remote.confirm.extractZip', {
      name: remoteEntry.name,
    }),
  )
  if (!confirmed) {
    return
  }

  await state.extractZip(remoteEntry)
}

function handlePathChange(path: string): void {
  emit('path-change', path)
}

function handleError(message: string): void {
  emit('error', message)
}

function handleEntryClick(entry: UnifiedFileEntry): void {
  emit('entry-click', toRemoteEntry(entry))
}
</script>

<template>
  <UnifiedFileBrowser
    :pane-session-id="props.paneSessionId"
    :initial-path="props.autoLoad ? props.initialPath : null"
    :reload-key="props.sessionCwd ?? ''"
    :empty-text="resolvedEmptyText"
    :use-action-context-menu="true"
    :hide-create-action-buttons="true"
    :hide-row-action-buttons="true"
    :list-path="listRemotePath"
    :on-create-file="createRemoteFile"
    :on-create-directory="createRemoteDirectory"
    :on-rename-entry="renameRemoteEntry"
    :on-delete-entry="deleteRemoteEntry"
    :on-upload-files="uploadRemoteFiles"
    :on-upload-directory="uploadRemoteDirectory"
    :on-upload-paths="uploadRemotePaths"
    :upload-progress="state.uploadProgress.value"
    :on-download-entry="downloadRemoteEntry"
    :can-download-entry="(entry: UnifiedFileEntry) => entry.type === 'file'"
    :on-extract-entry="extractRemoteEntry"
    :can-extract-entry="canExtractRemoteEntry"
    @path-change="handlePathChange"
    @error="handleError"
    @entry-click="handleEntryClick"
  />
</template>
