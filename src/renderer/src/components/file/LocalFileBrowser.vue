<script setup lang="ts">
import UnifiedFileBrowser, { type UnifiedFileEntry } from './UnifiedFileBrowser.vue'

const props = defineProps<{
  paneSessionId?: string | null
  initialPath: string | null
  reloadKey?: number | string
}>()

const emit = defineEmits<{
  (event: 'path-change', path: string): void
  (event: 'error', message: string): void
  (event: 'entry-click', entry: UnifiedFileEntry): void
}>()

function resolveLocalFileMethod<K extends keyof LocalFileApi>(methodName: K): LocalFileApi[K] {
  const target = window as Window & {
    electronAPI?: Partial<ElectronApi>
    __electronAPIBridge?: Partial<ElectronApi>
  }

  const primary = target.electronAPI?.localFile as Partial<LocalFileApi> | undefined
  const fallback = target.__electronAPIBridge?.localFile as Partial<LocalFileApi> | undefined
  const method = primary?.[methodName] ?? fallback?.[methodName]

  if (typeof method !== 'function') {
    throw new Error('本地文件功能暂不可用，请重启应用后重试。')
  }

  return method as LocalFileApi[K]
}

async function listLocalPath(path: string): Promise<{ path: string; parentPath: string | null; entries: UnifiedFileEntry[] }> {
  const listMethod = resolveLocalFileMethod('list')
  const result = await listMethod({ path })
  if (!result.ok) {
    throw new Error(result.error?.message?.trim() || '读取目录失败')
  }

  return {
    path: result.data.path,
    parentPath: result.data.parentPath,
    entries: result.data.entries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type,
      size: entry.size,
      modifiedAt: entry.modifiedAt,
      raw: entry,
    })),
  }
}

function unwrapLocalFileResult<T>(result: { ok: true; data: T } | { ok: false; error: { message?: string } }, fallback: string): T {
  if (result.ok) {
    return result.data
  }

  const message = result.error?.message?.trim()
  throw new Error(message || fallback)
}

async function createLocalFile(currentPath: string, name: string): Promise<void> {
  const createFileMethod = resolveLocalFileMethod('createFile')
  unwrapLocalFileResult(
    await createFileMethod({
      directoryPath: currentPath,
      name,
    }),
    '新建文件失败',
  )
}

async function createLocalDirectory(currentPath: string, name: string): Promise<void> {
  const createDirectoryMethod = resolveLocalFileMethod('createDirectory')
  unwrapLocalFileResult(
    await createDirectoryMethod({
      directoryPath: currentPath,
      name,
    }),
    '新建文件夹失败',
  )
}

async function renameLocalEntry(entry: UnifiedFileEntry, nextName: string): Promise<void> {
  const renameMethod = resolveLocalFileMethod('rename')
  unwrapLocalFileResult(
    await renameMethod({
      path: entry.path,
      nextName,
    }),
    '重命名失败',
  )
}

async function deleteLocalEntry(entry: UnifiedFileEntry): Promise<void> {
  const deleteMethod = resolveLocalFileMethod('delete')
  unwrapLocalFileResult(
    await deleteMethod({
      path: entry.path,
    }),
    '删除失败',
  )
}

function handlePathChange(path: string): void {
  emit('path-change', path)
}

function handleError(message: string): void {
  emit('error', message)
}

function handleEntryClick(entry: UnifiedFileEntry): void {
  emit('entry-click', entry)
}
</script>

<template>
  <UnifiedFileBrowser
    :pane-session-id="props.paneSessionId"
    :initial-path="props.initialPath"
    :reload-key="props.reloadKey"
    :use-action-context-menu="true"
    :hide-create-action-buttons="true"
    :hide-row-action-buttons="true"
    :list-path="listLocalPath"
    :show-hidden-toggle="true"
    :on-create-file="createLocalFile"
    :on-create-directory="createLocalDirectory"
    :on-rename-entry="renameLocalEntry"
    :on-delete-entry="deleteLocalEntry"
    @path-change="handlePathChange"
    @error="handleError"
    @entry-click="handleEntryClick"
  />
</template>
