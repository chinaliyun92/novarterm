<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useGlobalMessage } from '../../composables/useGlobalMessage'
import { useI18n } from '../../composables/useI18n'

export interface UnifiedFileEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'link' | 'unknown'
  size: number | null
  modifiedAt: string | null
  raw?: unknown
}

interface UnifiedFileListResult {
  path: string
  parentPath: string | null
  entries: UnifiedFileEntry[]
}

interface ActionContextMenuState {
  open: boolean
  x: number
  y: number
  entry: UnifiedFileEntry | null
}

interface NameDialogState {
  open: boolean
  title: string
  placeholder: string
  confirmLabel: string
  value: string
  busy: boolean
  error: string | null
  onSubmit: ((value: string) => Promise<void>) | null
}

const props = withDefaults(
  defineProps<{
    paneSessionId?: string | null
    initialPath: string | null
    reloadKey?: number | string
    emptyText?: string
    showHiddenToggle?: boolean
    useActionContextMenu?: boolean
    hideCreateActionButtons?: boolean
    hideRowActionButtons?: boolean
    listPath: (path: string) => Promise<UnifiedFileListResult>
    onCreateFile?: ((currentPath: string, name: string) => Promise<void> | void) | null
    onCreateDirectory?: ((currentPath: string, name: string) => Promise<void> | void) | null
    onRenameEntry?: ((entry: UnifiedFileEntry, nextName: string) => Promise<void> | void) | null
    onDeleteEntry?: ((entry: UnifiedFileEntry) => Promise<void> | void) | null
    onUploadFiles?: ((currentPath: string, files: File[]) => Promise<void> | void) | null
    onDownloadEntry?: ((entry: UnifiedFileEntry) => Promise<void> | void) | null
    canDownloadEntry?: ((entry: UnifiedFileEntry) => boolean) | null
  }>(),
  {
    paneSessionId: null,
    reloadKey: undefined,
    emptyText: '当前目录为空',
    showHiddenToggle: true,
    useActionContextMenu: false,
    hideCreateActionButtons: false,
    hideRowActionButtons: false,
    onCreateFile: null,
    onCreateDirectory: null,
    onRenameEntry: null,
    onDeleteEntry: null,
    onUploadFiles: null,
    onDownloadEntry: null,
    canDownloadEntry: null,
  },
)

const emit = defineEmits<{
  (event: 'path-change', path: string): void
  (event: 'error', message: string): void
  (event: 'entry-click', entry: UnifiedFileEntry): void
}>()

const FILE_PANE_NAVIGATE_UP_EVENT = 'iterm:file-pane:navigate-up'
const i18n = useI18n()
const globalMessage = useGlobalMessage()

const loading = ref(false)
const currentPath = ref('')
const parentPath = ref<string | null>(null)
const entries = ref<UnifiedFileEntry[]>([])
const showHiddenEntries = ref(true)
const selectedEntryPath = ref<string | null>(null)
const activeLoadRequestId = ref(0)
const uploadInputRef = ref<HTMLInputElement | null>(null)
const contextMenuRef = ref<HTMLElement | null>(null)
const nameInputRef = ref<HTMLInputElement | null>(null)
const actionContextMenu = ref<ActionContextMenuState>({
  open: false,
  x: 0,
  y: 0,
  entry: null,
})
const nameDialog = reactive<NameDialogState>({
  open: false,
  title: '',
  placeholder: '',
  confirmLabel: '确定',
  value: '',
  busy: false,
  error: null,
  onSubmit: null,
})

const visibleEntries = computed<UnifiedFileEntry[]>(() => {
  if (!showHiddenEntries.value) {
    return entries.value.filter((entry) => !entry.name.startsWith('.'))
  }
  return entries.value
})

const canCreateFile = computed(() => typeof props.onCreateFile === 'function')
const canCreateDirectory = computed(() => typeof props.onCreateDirectory === 'function')
const canRename = computed(() => typeof props.onRenameEntry === 'function')
const canDelete = computed(() => typeof props.onDeleteEntry === 'function')
const canUpload = computed(() => typeof props.onUploadFiles === 'function')
const canDownload = computed(() => typeof props.onDownloadEntry === 'function')
const showCreateButtons = computed(() => !props.hideCreateActionButtons)
const showRowActionButtons = computed(() => !props.hideRowActionButtons)
const hasActionContextMenuItems = computed(() => {
  return canCreateFile.value || canCreateDirectory.value || canRename.value || canDelete.value || canDownload.value
})

function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params)
}

function formatFileSize(size: number | null): string {
  if (!Number.isFinite(size) || size === null || size < 0) {
    return '—'
  }

  if (size < 1024) {
    return `${size} B`
  }

  const kb = size / 1024
  if (kb < 1024) {
    return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`
  }

  const mb = kb / 1024
  if (mb < 1024) {
    return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
  }

  const gb = mb / 1024
  return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`
}

function formatMtime(value: string | null): string {
  if (!value) {
    return '—'
  }

  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return '—'
  }

  return new Date(timestamp).toLocaleString()
}

function shouldAllowDownload(entry: UnifiedFileEntry): boolean {
  if (!canDownload.value) {
    return false
  }

  if (typeof props.canDownloadEntry === 'function') {
    return props.canDownloadEntry(entry)
  }

  return entry.type === 'file'
}

function selectEntry(entry: UnifiedFileEntry): void {
  selectedEntryPath.value = entry.path
  emit('entry-click', entry)
}

function isEntrySelected(entry: UnifiedFileEntry): boolean {
  return selectedEntryPath.value === entry.path
}

async function loadPath(path: string): Promise<void> {
  const targetPath = path.trim()
  if (!targetPath) {
    return
  }

  const requestId = activeLoadRequestId.value + 1
  activeLoadRequestId.value = requestId
  loading.value = true

  try {
    const result = await props.listPath(targetPath)
    if (requestId !== activeLoadRequestId.value) {
      return
    }

    currentPath.value = result.path
    parentPath.value = result.parentPath
    entries.value = result.entries
    if (selectedEntryPath.value && !result.entries.some((entry) => entry.path === selectedEntryPath.value)) {
      selectedEntryPath.value = null
    }

    emit('path-change', result.path)
  } catch (reason) {
    if (requestId !== activeLoadRequestId.value) {
      return
    }

    const message = reason instanceof Error ? reason.message : String(reason)
    setActionError(message)
  } finally {
    if (requestId === activeLoadRequestId.value) {
      loading.value = false
    }
  }
}

function openEntry(entry: UnifiedFileEntry): void {
  if (entry.type !== 'directory') {
    return
  }

  void loadPath(entry.path)
}

function handleEntryDoubleClick(entry: UnifiedFileEntry): void {
  selectEntry(entry)
  openEntry(entry)
}

function openParent(): void {
  if (!parentPath.value) {
    return
  }
  void loadPath(parentPath.value)
}

function toggleHiddenEntriesVisibility(): void {
  showHiddenEntries.value = !showHiddenEntries.value
}

function setActionMessage(message: string): void {
  const normalized = message.trim()
  if (!normalized) {
    return
  }
  globalMessage.success(normalized, { replace: true })
}

function setActionError(message: string): void {
  const normalized = message.trim()
  if (!normalized) {
    return
  }
  globalMessage.error(normalized, { replace: true })
  emit('error', normalized)
}

function closeNameDialog(): void {
  if (nameDialog.busy) {
    return
  }

  nameDialog.open = false
  nameDialog.title = ''
  nameDialog.placeholder = ''
  nameDialog.confirmLabel = '确定'
  nameDialog.value = ''
  nameDialog.error = null
  nameDialog.onSubmit = null
}

async function submitNameDialog(): Promise<void> {
  if (!nameDialog.open || nameDialog.busy || !nameDialog.onSubmit) {
    return
  }

  const value = nameDialog.value
  nameDialog.error = null
  nameDialog.busy = true

  try {
    await nameDialog.onSubmit(value)
    nameDialog.busy = false
    closeNameDialog()
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    nameDialog.error = message
    setActionError(message)
  } finally {
    nameDialog.busy = false
  }
}

function openNameDialog(payload: {
  title: string
  placeholder: string
  initialValue: string
  confirmLabel: string
  onSubmit: (value: string) => Promise<void>
}): void {
  nameDialog.title = payload.title
  nameDialog.placeholder = payload.placeholder
  nameDialog.confirmLabel = payload.confirmLabel
  nameDialog.value = payload.initialValue
  nameDialog.error = null
  nameDialog.onSubmit = payload.onSubmit
  nameDialog.busy = false
  nameDialog.open = true

  void nextTick(() => {
    nameInputRef.value?.focus()
    nameInputRef.value?.select()
  })
}

function closeActionContextMenu(): void {
  actionContextMenu.value = {
    open: false,
    x: 0,
    y: 0,
    entry: null,
  }
}

function resolveContextMenuPosition(event: MouseEvent): { x: number; y: number } {
  const menuWidth = 220
  const menuHeight = 180
  const margin = 8
  const maxX = Math.max(margin, window.innerWidth - menuWidth - margin)
  const maxY = Math.max(margin, window.innerHeight - menuHeight - margin)

  return {
    x: Math.min(Math.max(event.clientX, margin), maxX),
    y: Math.min(Math.max(event.clientY, margin), maxY),
  }
}

function openActionContextMenu(event: MouseEvent, entry: UnifiedFileEntry | null): void {
  if (!props.useActionContextMenu || !hasActionContextMenuItems.value) {
    return
  }

  event.preventDefault()
  event.stopPropagation()
  const position = resolveContextMenuPosition(event)

  if (entry) {
    selectEntry(entry)
  }

  actionContextMenu.value = {
    open: true,
    x: position.x,
    y: position.y,
    entry,
  }
}

function handleListContextMenu(event: MouseEvent): void {
  if (!props.useActionContextMenu) {
    return
  }
  openActionContextMenu(event, null)
}

function handleEntryContextMenu(event: MouseEvent, entry: UnifiedFileEntry): void {
  if (!props.useActionContextMenu) {
    return
  }
  openActionContextMenu(event, entry)
}

async function createFile(): Promise<void> {
  closeActionContextMenu()
  if (!props.onCreateFile) {
    return
  }

  if (!currentPath.value) {
    setActionError('当前目录不可用，请先刷新目录。')
    return
  }

  openNameDialog({
    title: '新建文件',
    placeholder: '请输入新文件名',
    initialValue: 'new-file.txt',
    confirmLabel: '创建',
    onSubmit: async (value: string) => {
      const normalizedName = value.trim()
      if (!normalizedName) {
        throw new Error('文件名不能为空。')
      }

      await props.onCreateFile?.(currentPath.value, normalizedName)
      await loadPath(currentPath.value)
      setActionMessage(`已创建文件：${normalizedName}`)
    },
  })
}

async function createDirectory(): Promise<void> {
  closeActionContextMenu()
  if (!props.onCreateDirectory) {
    return
  }

  if (!currentPath.value) {
    setActionError('当前目录不可用，请先刷新目录。')
    return
  }

  openNameDialog({
    title: '新建文件夹',
    placeholder: '请输入新文件夹名称',
    initialValue: 'new-folder',
    confirmLabel: '创建',
    onSubmit: async (value: string) => {
      const normalizedName = value.trim()
      if (!normalizedName) {
        throw new Error('文件夹名不能为空。')
      }

      await props.onCreateDirectory?.(currentPath.value, normalizedName)
      await loadPath(currentPath.value)
      setActionMessage(`已创建文件夹：${normalizedName}`)
    },
  })
}

async function renameEntry(entry: UnifiedFileEntry): Promise<void> {
  closeActionContextMenu()
  if (!props.onRenameEntry) {
    return
  }

  openNameDialog({
    title: '重命名',
    placeholder: '请输入新名称',
    initialValue: entry.name,
    confirmLabel: '保存',
    onSubmit: async (value: string) => {
      const normalizedName = value.trim()
      if (!normalizedName) {
        throw new Error('名称不能为空。')
      }
      if (normalizedName === entry.name) {
        return
      }

      await props.onRenameEntry?.(entry, normalizedName)
      await loadPath(currentPath.value)
      setActionMessage(`已重命名为：${normalizedName}`)
    },
  })
}

async function deleteEntry(entry: UnifiedFileEntry): Promise<void> {
  closeActionContextMenu()
  if (!props.onDeleteEntry) {
    return
  }

  const confirmed = window.confirm(`确认删除「${entry.name}」吗？`)
  if (!confirmed) {
    return
  }

  try {
    await props.onDeleteEntry(entry)
    await loadPath(currentPath.value)
    setActionMessage(`已删除：${entry.name}`)
  } catch (reason) {
    setActionError(reason instanceof Error ? reason.message : String(reason))
  }
}

async function downloadEntry(entry: UnifiedFileEntry): Promise<void> {
  closeActionContextMenu()
  if (!props.onDownloadEntry || !shouldAllowDownload(entry)) {
    return
  }

  try {
    await props.onDownloadEntry(entry)
    setActionMessage(`下载完成：${entry.name}`)
  } catch (reason) {
    setActionError(reason instanceof Error ? reason.message : String(reason))
  }
}

function triggerUploadPicker(): void {
  if (!props.onUploadFiles || loading.value) {
    return
  }

  uploadInputRef.value?.click()
}

async function handleUploadSelection(event: Event): Promise<void> {
  if (!props.onUploadFiles || !currentPath.value) {
    return
  }

  const target = event.target as HTMLInputElement
  const files = target.files ? Array.from(target.files) : []
  target.value = ''
  if (!files.length) {
    return
  }

  try {
    await props.onUploadFiles(currentPath.value, files)
    await loadPath(currentPath.value)
    setActionMessage(`上传完成：${files.length} 个文件`)
  } catch (reason) {
    setActionError(reason instanceof Error ? reason.message : String(reason))
  }
}

function matchesPaneSession(sessionId: unknown): boolean {
  if (typeof sessionId !== 'string') {
    return false
  }

  const target = sessionId.trim()
  if (!target) {
    return false
  }

  return target === (props.paneSessionId?.trim() ?? '')
}

function handleNavigateUpEvent(event: Event): void {
  const payload = (event as CustomEvent<{ sessionId?: unknown }>).detail
  if (!matchesPaneSession(payload?.sessionId) || loading.value) {
    return
  }

  openParent()
}

function handleGlobalPointerDown(event: PointerEvent): void {
  if (!actionContextMenu.value.open) {
    return
  }

  const target = event.target as Node | null
  if (target && contextMenuRef.value?.contains(target)) {
    return
  }

  closeActionContextMenu()
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if (nameDialog.open && event.key === 'Escape') {
    event.preventDefault()
    closeNameDialog()
    return
  }

  if (event.key !== 'Escape') {
    return
  }

  closeActionContextMenu()
}

watch(
  () => [props.initialPath, props.reloadKey] as const,
  ([initialPath]) => {
    if (!initialPath) {
      return
    }
    if (initialPath.trim() === currentPath.value.trim()) {
      return
    }
    void loadPath(initialPath)
  },
  { immediate: true },
)

watch(
  () => props.showHiddenToggle,
  (nextValue) => {
    if (nextValue === undefined) {
      return
    }
    if (!nextValue) {
      showHiddenEntries.value = false
    } else if (!showHiddenEntries.value) {
      showHiddenEntries.value = true
    }
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener(FILE_PANE_NAVIGATE_UP_EVENT, handleNavigateUpEvent as EventListener)
  window.addEventListener('pointerdown', handleGlobalPointerDown)
  window.addEventListener('keydown', handleGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener(FILE_PANE_NAVIGATE_UP_EVENT, handleNavigateUpEvent as EventListener)
  window.removeEventListener('pointerdown', handleGlobalPointerDown)
  window.removeEventListener('keydown', handleGlobalKeydown)
  closeNameDialog()
})
</script>

<template>
  <section class="unified-file-browser" @contextmenu="handleListContextMenu">
    <header class="unified-file-browser__toolbar">
      <div class="toolbar-icon-group">
        <button
          v-if="props.showHiddenToggle"
          type="button"
          :disabled="loading"
          class="toolbar-action-btn"
          :class="{ 'is-active': showHiddenEntries }"
          :title="showHiddenEntries ? t('file.toolbar.hiddenVisible') : t('file.toolbar.hiddenHidden')"
          :aria-label="showHiddenEntries ? t('file.toolbar.hiddenVisible') : t('file.toolbar.hiddenHidden')"
          @click="toggleHiddenEntriesVisibility"
        >
          <span
            v-if="showHiddenEntries"
            class="toolbar-action-icon i-mdi-eye-outline"
            aria-hidden="true"
          />
          <span
            v-else
            class="toolbar-action-icon i-mdi-eye-off-outline"
            aria-hidden="true"
          />
          <span>{{ showHiddenEntries ? t('file.toolbar.hideHidden') : t('file.toolbar.showHidden') }}</span>
        </button>
        <button
          type="button"
          class="toolbar-action-btn"
          :disabled="!parentPath || loading"
          :title="t('file.toolbar.parentDirectory')"
          :aria-label="t('file.toolbar.parentDirectory')"
          @click="openParent"
        >
          <span class="toolbar-action-icon i-mdi-folder-upload-outline" aria-hidden="true" />
          <span>{{ t('file.toolbar.parentDirectory') }}</span>
        </button>
        <button
          type="button"
          class="toolbar-action-btn"
          :disabled="loading || !currentPath"
          :title="t('file.toolbar.refresh')"
          :aria-label="t('file.toolbar.refresh')"
          @click="void loadPath(currentPath)"
        >
          <span class="toolbar-action-icon i-mdi-refresh" aria-hidden="true" />
          <span>{{ t('file.toolbar.refresh') }}</span>
        </button>
      </div>
      <button
        v-if="showCreateButtons && canCreateFile"
        type="button"
        class="toolbar-action-btn"
        :disabled="loading"
        @click="void createFile()"
      >
        <span class="toolbar-action-icon i-mdi-file-plus-outline" aria-hidden="true" />
        <span>{{ t('file.toolbar.createFile') }}</span>
      </button>
      <button
        v-if="showCreateButtons && canCreateDirectory"
        type="button"
        class="toolbar-action-btn"
        :disabled="loading"
        @click="void createDirectory()"
      >
        <span class="toolbar-action-icon i-mdi-folder-plus-outline" aria-hidden="true" />
        <span>{{ t('file.toolbar.createDirectory') }}</span>
      </button>
      <button v-if="canUpload" type="button" class="toolbar-action-btn" :disabled="loading" @click="triggerUploadPicker">
        <span class="toolbar-action-icon i-mdi-upload-outline" aria-hidden="true" />
        <span>{{ t('file.toolbar.upload') }}</span>
      </button>
      <input
        v-if="canUpload"
        ref="uploadInputRef"
        type="file"
        multiple
        class="unified-file-browser__upload-input"
        @change="void handleUploadSelection($event)"
      />
    </header>

    <p v-if="loading" class="unified-file-browser__message">加载中...</p>
    <p v-else-if="visibleEntries.length === 0" class="unified-file-browser__message">{{ props.emptyText }}</p>

    <ul v-else class="unified-file-browser__list" @contextmenu="handleListContextMenu">
      <li
        v-for="entry in visibleEntries"
        :key="entry.path"
        class="unified-file-browser__item"
        :class="{ 'is-selected': isEntrySelected(entry) }"
        @click="selectEntry(entry)"
        @dblclick="handleEntryDoubleClick(entry)"
        @contextmenu="handleEntryContextMenu($event, entry)"
      >
        <div class="unified-file-browser__name">
          <span v-if="entry.type === 'directory'" class="entry-icon i-mdi-folder" aria-hidden="true" />
          <span v-else-if="entry.type === 'file'" class="entry-icon i-mdi-file-document-outline" aria-hidden="true" />
          <span v-else-if="entry.type === 'link'" class="entry-icon i-mdi-link-variant" aria-hidden="true" />
          <span v-else class="entry-icon i-mdi-file-question-outline" aria-hidden="true" />
          <span class="unified-file-browser__entry-name">{{ entry.name }}</span>
        </div>
        <span>{{ formatFileSize(entry.size) }}</span>
        <span>{{ formatMtime(entry.modifiedAt) }}</span>
        <span v-if="showRowActionButtons && (canRename || canDelete || canDownload)" class="unified-file-browser__actions">
          <button v-if="canRename" type="button" :disabled="loading" @click.stop="void renameEntry(entry)">重命名</button>
          <button
            v-if="canDownload && shouldAllowDownload(entry)"
            type="button"
            :disabled="loading"
            @click.stop="void downloadEntry(entry)"
          >
            下载
          </button>
          <button v-if="canDelete" type="button" class="danger" :disabled="loading" @click.stop="void deleteEntry(entry)">
            删除
          </button>
        </span>
      </li>
    </ul>

    <div
      v-if="actionContextMenu.open"
      ref="contextMenuRef"
      class="unified-file-browser__context-menu"
      :style="{ left: `${actionContextMenu.x}px`, top: `${actionContextMenu.y}px` }"
      role="menu"
      :aria-label="t('file.menu.actionsAria')"
      @click.stop
    >
      <button
        v-if="canCreateFile"
        type="button"
        role="menuitem"
        :disabled="loading"
        @click.stop="void createFile()"
      >
        {{ t('file.menu.createFile') }}
      </button>
      <button
        v-if="canCreateDirectory"
        type="button"
        role="menuitem"
        :disabled="loading"
        @click.stop="void createDirectory()"
      >
        {{ t('file.menu.createDirectory') }}
      </button>
      <button
        v-if="canRename && actionContextMenu.entry"
        type="button"
        role="menuitem"
        :disabled="loading"
        @click.stop="void renameEntry(actionContextMenu.entry)"
      >
        {{ t('file.menu.rename') }}
      </button>
      <button
        v-if="canDownload && actionContextMenu.entry && shouldAllowDownload(actionContextMenu.entry)"
        type="button"
        role="menuitem"
        :disabled="loading"
        @click.stop="void downloadEntry(actionContextMenu.entry)"
      >
        {{ t('file.menu.download') }}
      </button>
      <button
        v-if="canDelete && actionContextMenu.entry"
        type="button"
        role="menuitem"
        class="danger"
        :disabled="loading"
        @click.stop="void deleteEntry(actionContextMenu.entry)"
      >
        {{ t('file.menu.delete') }}
      </button>
    </div>

    <div
      v-if="nameDialog.open"
      class="unified-file-browser__dialog-mask"
      role="dialog"
      aria-modal="true"
      @click="closeNameDialog"
    >
      <div class="unified-file-browser__dialog" @click.stop>
        <h4>{{ nameDialog.title }}</h4>
        <input
          ref="nameInputRef"
          v-model="nameDialog.value"
          type="text"
          :placeholder="nameDialog.placeholder"
          :disabled="nameDialog.busy"
          @keydown.enter.prevent="void submitNameDialog()"
        />
        <p v-if="nameDialog.error" class="is-error">{{ nameDialog.error }}</p>
        <div class="unified-file-browser__dialog-actions">
          <button type="button" :disabled="nameDialog.busy" @click="closeNameDialog">取消</button>
          <button type="button" :disabled="nameDialog.busy" @click="void submitNameDialog()">
            {{ nameDialog.confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.unified-file-browser {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100%;
  min-height: 0;
  background: #0b1220;
  color: #e2e8f0;
  font-family: var(
    --term-font-family,
    'JetBrains Mono',
    'SF Mono',
    Menlo,
    Monaco,
    Consolas,
    'Liberation Mono',
    'Courier New',
    monospace
  );
}

.unified-file-browser__toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  white-space: nowrap;
  padding: 8px 10px;
  border-bottom: 1px solid #1f2937;
  background: #0f172a;
}

.toolbar-icon-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.unified-file-browser__toolbar button {
  height: 26px;
  padding: 0 8px;
  border: 1px solid #334155;
  border-radius: 6px;
  background: #0b1220;
  color: #e2e8f0;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}

.unified-file-browser__toolbar .toolbar-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 0 0 auto;
}

.toolbar-action-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}

.unified-file-browser__toolbar button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.unified-file-browser__toolbar button.is-active {
  border-color: #475569;
  background: #172334;
  color: #cbd5e1;
}

.unified-file-browser__upload-input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  clip: rect(0, 0, 0, 0);
  overflow: hidden;
}

.unified-file-browser__message {
  margin: 0;
  padding: 10px;
  font-size: 12px;
  color: #94a3b8;
}

.unified-file-browser__message.is-error {
  color: #fca5a5;
}

.unified-file-browser__message.is-success {
  color: #86efac;
}

.unified-file-browser__list {
  list-style: none;
  margin: 0;
  padding: 6px;
  overflow: auto;
}

.unified-file-browser__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 88px 150px auto;
  gap: 8px;
  align-items: center;
  min-height: 30px;
  padding: 0 6px;
  border-radius: 6px;
  cursor: default;
}

.unified-file-browser__item:hover {
  background: rgba(30, 41, 59, 0.72);
}

.unified-file-browser__item.is-selected {
  background: rgba(59, 130, 246, 0.22);
}

.unified-file-browser__name {
  min-width: 0;
  color: #e2e8f0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  overflow: hidden;
}

.unified-file-browser__entry-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-icon {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}

.entry-icon.i-mdi-folder {
  color: #f59e0b;
}

.entry-icon.i-mdi-file-document-outline {
  color: #93c5fd;
}

.entry-icon.i-mdi-link-variant {
  color: #34d399;
}

.entry-icon.i-mdi-file-question-outline {
  color: #cbd5e1;
}

.unified-file-browser__item > span {
  color: #94a3b8;
  font-size: 12px;
}

.unified-file-browser__item > span:nth-child(3) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.unified-file-browser__actions {
  display: inline-flex;
  align-items: center;
  justify-self: end;
  gap: 6px;
}

.unified-file-browser__actions button {
  height: 22px;
  padding: 0 8px;
  border: 1px solid #334155;
  border-radius: 6px;
  background: #0b1220;
  color: #e2e8f0;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}

.unified-file-browser__actions button.danger {
  color: #fca5a5;
  border-color: #7f1d1d;
}

.unified-file-browser__actions button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.unified-file-browser__context-menu {
  position: fixed;
  z-index: 3200;
  min-width: 160px;
  display: grid;
  gap: 2px;
  padding: 6px;
  border: 1px solid #334155;
  border-radius: 8px;
  background: #0b1120;
  box-shadow: 0 10px 24px rgba(2, 6, 23, 0.45);
}

.unified-file-browser__context-menu button {
  height: 30px;
  border: 0;
  border-radius: 6px;
  text-align: left;
  color: #e2e8f0;
  background: transparent;
  padding: 0 10px;
  cursor: pointer;
  font-family: inherit;
}

.unified-file-browser__context-menu button:hover {
  background: #1e293b;
}

.unified-file-browser__context-menu button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.unified-file-browser__context-menu button.danger {
  color: #fca5a5;
}

.unified-file-browser__dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 3300;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.24);
}

.unified-file-browser__dialog {
  width: min(420px, calc(100vw - 24px));
  border: 1px solid #d7e0eb;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.2);
  padding: 14px;
  display: grid;
  gap: 10px;
}

.unified-file-browser__dialog h4 {
  margin: 0;
  color: #0f172a;
  font-size: 14px;
}

.unified-file-browser__dialog input {
  height: 32px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  color: #0f172a;
  padding: 0 10px;
  outline: none;
  font-family: inherit;
}

.unified-file-browser__dialog input:focus {
  border-color: #64748b;
}

.unified-file-browser__dialog p {
  margin: 0;
  font-size: 12px;
  color: #64748b;
}

.unified-file-browser__dialog p.is-error {
  color: #fca5a5;
}

.unified-file-browser__dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.unified-file-browser__dialog-actions button {
  height: 28px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  background: #ffffff;
  color: #334155;
  padding: 0 10px;
  cursor: pointer;
  font-family: inherit;
}

.unified-file-browser__dialog-actions button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
