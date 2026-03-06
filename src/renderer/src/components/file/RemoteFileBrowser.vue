<script setup lang="ts">
import { toRef } from 'vue'
import type { SftpListItem } from '../../../../shared/types/ssh'
import { useRemoteFileBrowserState } from '../../composables/useRemoteFileBrowserState'
import {
  getRemoteParentPath,
  joinRemotePath,
  normalizeRemotePath,
  type RemoteFileEntry,
  type RemoteUploadItem,
} from '../../types/file-browser'
import UnifiedFileBrowser, { type UnifiedFileEntry } from './UnifiedFileBrowser.vue'

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
  emptyText: '当前目录为空',
  sessionCwd: null,
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
    throw new Error('请选择已连接的 session')
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
    throw new Error('未读取到可上传的本地路径，请确认拖拽来源可访问。')
  }

  const skippedText = skippedCount > 0 ? `\n将跳过 ${skippedCount} 个不可用条目。` : ''
  const confirmed = window.confirm(`确认上传 ${uploads.length} 个文件到「${currentPath}」吗？${skippedText}`)
  if (!confirmed) {
    return
  }

  await state.uploadFiles(uploads)
}

async function downloadRemoteEntry(entry: UnifiedFileEntry): Promise<void> {
  const remoteEntry = toRemoteEntry(entry)
  if (remoteEntry.type !== 'file') {
    throw new Error('当前仅支持下载文件，不支持目录下载。')
  }

  const saveDialogResult = await window.electronAPI.dialog.saveFile({
    title: `保存文件：${remoteEntry.name}`,
    defaultPath: remoteEntry.name,
    buttonLabel: '保存',
  })
  if (saveDialogResult.canceled || !saveDialogResult.filePath) {
    return
  }

  await state.downloadFile(remoteEntry, saveDialogResult.filePath)
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
    :empty-text="props.emptyText"
    :use-action-context-menu="true"
    :hide-create-action-buttons="true"
    :hide-row-action-buttons="true"
    :list-path="listRemotePath"
    :on-create-file="createRemoteFile"
    :on-create-directory="createRemoteDirectory"
    :on-rename-entry="renameRemoteEntry"
    :on-delete-entry="deleteRemoteEntry"
    :on-upload-files="uploadRemoteFiles"
    :on-download-entry="downloadRemoteEntry"
    :can-download-entry="(entry: UnifiedFileEntry) => entry.type === 'file'"
    @path-change="handlePathChange"
    @error="handleError"
    @entry-click="handleEntryClick"
  />
</template>
