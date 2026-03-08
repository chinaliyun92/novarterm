<script setup lang="ts">
import UnifiedFileBrowser, { type UnifiedFileEntry } from './UnifiedFileBrowser.vue'
import { useI18n } from '../../composables/useI18n'

const i18n = useI18n()

function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params)
}

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
    throw new Error(t('file.local.error.apiUnavailable'))
  }

  return method as LocalFileApi[K]
}

async function listLocalPath(path: string): Promise<{ path: string; parentPath: string | null; entries: UnifiedFileEntry[] }> {
  const listMethod = resolveLocalFileMethod('list')
  const result = await listMethod({ path })
  if (!result.ok) {
    throw new Error(result.error?.message?.trim() || t('file.local.error.readDirectoryFailed'))
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
    t('file.local.error.createFileFailed'),
  )
}

async function createLocalDirectory(currentPath: string, name: string): Promise<void> {
  const createDirectoryMethod = resolveLocalFileMethod('createDirectory')
  unwrapLocalFileResult(
    await createDirectoryMethod({
      directoryPath: currentPath,
      name,
    }),
    t('file.local.error.createDirectoryFailed'),
  )
}

async function renameLocalEntry(entry: UnifiedFileEntry, nextName: string): Promise<void> {
  const renameMethod = resolveLocalFileMethod('rename')
  unwrapLocalFileResult(
    await renameMethod({
      path: entry.path,
      nextName,
    }),
    t('file.local.error.renameFailed'),
  )
}

async function deleteLocalEntry(entry: UnifiedFileEntry): Promise<void> {
  const deleteMethod = resolveLocalFileMethod('delete')
  unwrapLocalFileResult(
    await deleteMethod({
      path: entry.path,
    }),
    t('file.local.error.deleteFailed'),
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
