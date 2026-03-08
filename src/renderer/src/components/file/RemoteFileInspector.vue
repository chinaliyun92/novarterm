<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  SftpReadFileMode,
  SftpReadFileRequest,
  SftpReadFileResponse,
  SftpWriteTextRequest,
  SSHResult,
} from '../../../../shared/types/ssh'
import { useI18n } from '../../composables/useI18n'
import type { RemoteFileEntry } from '../../types/file-browser'
import { normalizeRemotePath, toErrorMessage } from '../../types/file-browser'

interface RemoteFileInspectorProps {
  sessionId: string | null
  entry: RemoteFileEntry | null
}

type PreviewKind = 'none' | 'text' | 'json' | 'image' | 'log' | 'binary'
type InspectorTab = 'preview' | 'edit'
type DetectedEncoding = 'UTF-8' | 'GB18030'

interface DecodedTextPayload {
  text: string
  encoding: DetectedEncoding
  fallbackReason: 'none' | 'utf8-invalid' | 'utf8-suspect'
}

interface SftpReadApi {
  readFile?: (request: SftpReadFileRequest) => Promise<SSHResult<SftpReadFileResponse>>
  writeText?: (request: SftpWriteTextRequest) => Promise<SSHResult<void>>
}

const props = defineProps<RemoteFileInspectorProps>()
const i18n = useI18n()

function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params)
}

const emit = defineEmits<{
  (event: 'dirty-change', dirty: boolean): void
  (event: 'saved', path: string): void
  (event: 'saved-as', path: string): void
  (event: 'error', message: string): void
}>()

const loading = ref(false)
const saving = ref(false)
const loadError = ref<string | null>(null)
const capabilityHint = ref<string | null>(null)
const actionMessage = ref<string | null>(null)
const previewNotice = ref<string | null>(null)

const loadedPath = ref<string | null>(null)
const previewKind = ref<PreviewKind>('none')
const activeTab = ref<InspectorTab>('preview')
const detectedEncoding = ref<DetectedEncoding | null>(null)
const contentTruncated = ref(false)

const previewText = ref('')
const jsonParseError = ref<string | null>(null)
const imageDataUrl = ref<string | null>(null)
const editorText = ref('')
const persistedText = ref('')

const autoScrollLog = ref(true)
const logViewportRef = ref<HTMLDivElement | null>(null)

let activeLoadToken = 0

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'])
const JSON_EXTENSIONS = new Set(['json', 'geojson'])
const LOG_EXTENSIONS = new Set(['log', 'out'])
const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'env',
  'csv',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'vue',
  'html',
  'css',
  'scss',
  'less',
  'xml',
  'sh',
  'bash',
  'zsh',
  'py',
  'go',
  'java',
  'kt',
  'rb',
  'php',
  'rs',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
  'sql',
])
const LARGE_TEXT_FILE_THRESHOLD_BYTES = 2 * 1024 * 1024
const LARGE_TEXT_PREVIEW_CHAR_LIMIT = 120_000
const LARGE_LOG_TAIL_LINE_LIMIT = 500
const LARGE_LOG_TAIL_CHAR_LIMIT = 120_000
const SAVE_ENCODING: DetectedEncoding = 'UTF-8'

const sessionIdValue = computed(() => {
  if (!props.sessionId) {
    return null
  }

  const normalized = props.sessionId.trim()
  return normalized || null
})

const selectedFile = computed(() => {
  if (!props.entry || props.entry.type !== 'file') {
    return null
  }
  return props.entry
})

const isTextBased = computed(() => {
  return previewKind.value === 'text' || previewKind.value === 'json' || previewKind.value === 'log'
})

const isDirty = computed(() => {
  if (!isTextBased.value) {
    return false
  }
  return editorText.value !== persistedText.value
})

const canSave = computed(() => {
  return Boolean(
    sessionIdValue.value &&
      loadedPath.value &&
      isTextBased.value &&
      !contentTruncated.value &&
      !loading.value &&
      !saving.value,
  )
})

const canEdit = computed(() => {
  return Boolean(isTextBased.value && !contentTruncated.value && !loading.value && !saving.value)
})

const saveEncodingLabel = computed(() => {
  if (!isTextBased.value) {
    return null
  }
  return t('file.inspector.saveEncoding', { encoding: SAVE_ENCODING })
})

const fileLabel = computed(() => {
  if (!props.entry) {
    return t('file.inspector.label.noFileSelected')
  }

  if (props.entry.type !== 'file') {
    return t('file.inspector.label.directorySelected', { name: props.entry.name })
  }

  return props.entry.path
})

function unwrapSSHResult<T>(result: SSHResult<T>, fallback: string): T {
  if (result.ok) {
    return result.data
  }

  const message = result.error?.message?.trim() || fallback
  throw new Error(message)
}

function getFileExtension(path: string): string {
  const base = path.split('/').pop() ?? ''
  const index = base.lastIndexOf('.')
  if (index < 0) {
    return ''
  }

  return base.slice(index + 1).toLowerCase()
}

function detectPreviewKind(entry: RemoteFileEntry): PreviewKind {
  const extension = getFileExtension(entry.path)

  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image'
  }

  if (JSON_EXTENSIONS.has(extension)) {
    return 'json'
  }

  if (LOG_EXTENSIONS.has(extension)) {
    return 'log'
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return 'text'
  }

  if (entry.size <= 1024 * 1024) {
    return 'text'
  }

  return 'binary'
}

function mimeTypeByExtension(extension: string): string {
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
  }

  return mimeMap[extension] ?? 'application/octet-stream'
}

function countMatches(content: string, pattern: RegExp): number {
  const matches = content.match(pattern)
  return matches ? matches.length : 0
}

function base64ToBytes(content: string): Uint8Array {
  const normalized = content.replace(/\s+/g, '')
  const binary = window.atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function decodeWithEncoding(bytes: Uint8Array, encoding: string, fatal = false): string {
  return new TextDecoder(encoding, { fatal }).decode(bytes)
}

function textSuspicionScore(content: string): number {
  if (!content) {
    return 0
  }

  const replacementCharCount = countMatches(content, /\uFFFD/g)
  const controlCharCount = countMatches(content, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g)
  let score = replacementCharCount * 12 + controlCharCount * 4

  if (controlCharCount > 0 && controlCharCount / content.length > 0.01) {
    score += 20
  }

  return score
}

function decodeTextPayload(base64Content: string): DecodedTextPayload {
  const bytes = base64ToBytes(base64Content)

  let utf8Text = ''
  let utf8Invalid = false
  try {
    utf8Text = decodeWithEncoding(bytes, 'utf-8', true)
  } catch {
    utf8Invalid = true
    utf8Text = decodeWithEncoding(bytes, 'utf-8')
  }

  let gb18030Text: string | null = null
  const tryDecodeGb18030 = (): string | null => {
    if (gb18030Text !== null) {
      return gb18030Text
    }

    try {
      gb18030Text = decodeWithEncoding(bytes, 'gb18030')
      return gb18030Text
    } catch {
      return null
    }
  }

  if (utf8Invalid) {
    const fallbackText = tryDecodeGb18030()
    if (fallbackText !== null) {
      return {
        text: fallbackText,
        encoding: 'GB18030',
        fallbackReason: 'utf8-invalid',
      }
    }
  }

  const utf8Score = textSuspicionScore(utf8Text)
  const utf8IsSuspect = utf8Score > 0
  if (!utf8IsSuspect) {
    return {
      text: utf8Text,
      encoding: 'UTF-8',
      fallbackReason: 'none',
    }
  }

  const gbText = tryDecodeGb18030()
  if (gbText === null) {
    return {
      text: utf8Text,
      encoding: 'UTF-8',
      fallbackReason: 'none',
    }
  }

  const gbScore = textSuspicionScore(gbText)
  if (gbScore + 2 < utf8Score) {
    return {
      text: gbText,
      encoding: 'GB18030',
      fallbackReason: 'utf8-suspect',
    }
  }

  return {
    text: utf8Text,
    encoding: 'UTF-8',
    fallbackReason: 'none',
  }
}

function takeHeadChars(content: string, maxChars: number): { text: string; truncated: boolean } {
  if (content.length <= maxChars) {
    return {
      text: content,
      truncated: false,
    }
  }

  return {
    text: content.slice(0, maxChars),
    truncated: true,
  }
}

function takeTailChars(content: string, maxChars: number): { text: string; truncated: boolean } {
  if (content.length <= maxChars) {
    return {
      text: content,
      truncated: false,
    }
  }

  return {
    text: content.slice(content.length - maxChars),
    truncated: true,
  }
}

function takeTailLines(content: string, maxLines: number): { text: string; truncated: boolean } {
  const lines = content.split(/\r?\n/)
  if (lines.length <= maxLines) {
    return {
      text: content,
      truncated: false,
    }
  }

  return {
    text: lines.slice(lines.length - maxLines).join('\n'),
    truncated: true,
  }
}

function formatFileSize(sizeInBytes: number): string {
  if (sizeInBytes >= 1024 * 1024) {
    return `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`
  }
  if (sizeInBytes >= 1024) {
    return `${(sizeInBytes / 1024).toFixed(1)} KB`
  }
  return `${sizeInBytes} B`
}

function getSftpApi(): SftpReadApi {
  return window.electronAPI.ssh.sftp as unknown as SftpReadApi
}

function resetContentState(): void {
  previewKind.value = 'none'
  activeTab.value = 'preview'
  detectedEncoding.value = null
  contentTruncated.value = false
  previewText.value = ''
  jsonParseError.value = null
  imageDataUrl.value = null
  editorText.value = ''
  persistedText.value = ''
  loadedPath.value = null
  loadError.value = null
  capabilityHint.value = null
  actionMessage.value = null
  previewNotice.value = null
}

function formatJsonText(content: string): string {
  const parsed = JSON.parse(content) as unknown
  return `${JSON.stringify(parsed, null, 2)}\n`
}

function scrollLogToBottom(): void {
  const viewport = logViewportRef.value
  if (!viewport) {
    return
  }

  viewport.scrollTop = viewport.scrollHeight
}

async function loadSelectedFile(): Promise<void> {
  const sessionId = sessionIdValue.value
  const entry = selectedFile.value

  resetContentState()

  if (!sessionId || !entry) {
    return
  }

  loading.value = true
  const token = ++activeLoadToken

  try {
    const nextKind = detectPreviewKind(entry)
    previewKind.value = nextKind

    if (nextKind === 'binary') {
      capabilityHint.value = t('file.inspector.hint.binaryPreviewUnsupported')
      loadedPath.value = entry.path
      return
    }

    const sftpApi = getSftpApi()
    if (typeof sftpApi.readFile !== 'function') {
      capabilityHint.value =
        t('file.inspector.hint.readFileApiUnavailable')
      return
    }

    const mode: SftpReadFileMode = 'base64'
    const result = await sftpApi.readFile({
      sessionId,
      remotePath: entry.path,
      mode,
    })

    const response = unwrapSSHResult(result, t('file.inspector.error.readFileFailed'))
    if (token !== activeLoadToken) {
      return
    }

    loadedPath.value = response.remotePath || entry.path

    if (nextKind === 'image') {
      const extension = getFileExtension(entry.path)
      const mimeType = mimeTypeByExtension(extension)
      imageDataUrl.value = `data:${mimeType};base64,${response.content}`
      return
    }

    const decoded = decodeTextPayload(response.content ?? '')
    let text = decoded.text
    detectedEncoding.value = decoded.encoding

    const notices: string[] = []

    const isLargeTextFile = entry.size > LARGE_TEXT_FILE_THRESHOLD_BYTES
    if (isLargeTextFile && nextKind === 'log') {
      const tailByLines = takeTailLines(text, LARGE_LOG_TAIL_LINE_LIMIT)
      text = tailByLines.text
      const tailByChars = takeTailChars(text, LARGE_LOG_TAIL_CHAR_LIMIT)
      text = tailByChars.text
      contentTruncated.value = tailByLines.truncated || tailByChars.truncated

      if (contentTruncated.value) {
        notices.push(
          t('file.inspector.notice.largeLogTail', {
            size: formatFileSize(entry.size),
            lineLimit: LARGE_LOG_TAIL_LINE_LIMIT,
            charLimit: LARGE_LOG_TAIL_CHAR_LIMIT.toLocaleString(),
          }),
        )
      }
    } else if (isLargeTextFile) {
      const head = takeHeadChars(text, LARGE_TEXT_PREVIEW_CHAR_LIMIT)
      text = head.text
      contentTruncated.value = head.truncated
      if (head.truncated) {
        notices.push(
          t('file.inspector.notice.largeTextHead', {
            size: formatFileSize(entry.size),
            charLimit: LARGE_TEXT_PREVIEW_CHAR_LIMIT.toLocaleString(),
          }),
        )
      }
    } else {
      contentTruncated.value = false
    }

    previewNotice.value = notices.length > 0 ? notices.join(' ') : null

    if (nextKind === 'json') {
      if (contentTruncated.value) {
        previewText.value = text
        editorText.value = text
      } else {
        try {
          const formatted = formatJsonText(text)
          previewText.value = formatted
          editorText.value = formatted
        } catch (reason) {
          previewText.value = text
          editorText.value = text
          jsonParseError.value = toErrorMessage(reason, t('file.inspector.error.jsonParseFailed'))
        }
      }
    } else {
      previewText.value = text
      editorText.value = text
    }

    persistedText.value = editorText.value

    if (nextKind === 'log') {
      await nextTick()
      if (autoScrollLog.value) {
        scrollLogToBottom()
      }
    }
  } catch (reason) {
    if (token !== activeLoadToken) {
      return
    }

    const message = toErrorMessage(reason, t('file.inspector.error.readFileFailed'))
    loadError.value = message
    emit('error', message)
  } finally {
    if (token === activeLoadToken) {
      loading.value = false
    }
  }
}

function suggestSaveAsPath(path: string): string {
  const normalized = normalizeRemotePath(path)
  const slashIndex = normalized.lastIndexOf('/')
  const directory = slashIndex > 0 ? normalized.slice(0, slashIndex) : '/'
  const name = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized
  const dotIndex = name.lastIndexOf('.')

  if (dotIndex <= 0) {
    return normalizeRemotePath(`${directory}/${name}.copy`)
  }

  const stem = name.slice(0, dotIndex)
  const ext = name.slice(dotIndex)
  return normalizeRemotePath(`${directory}/${stem}.copy${ext}`)
}

async function writeText(remotePath: string, content: string): Promise<void> {
  const sessionId = sessionIdValue.value
  if (!sessionId) {
    throw new Error(t('file.inspector.error.sessionUnavailableForSave'))
  }

  const sftpApi = getSftpApi()
  if (typeof sftpApi.writeText !== 'function') {
    throw new Error(t('file.inspector.error.writeTextApiUnavailable'))
  }

  const result = await sftpApi.writeText({
    sessionId,
    remotePath,
    content,
  })

  unwrapSSHResult(result, t('file.inspector.error.saveFailed'))
}

async function handleReload(): Promise<void> {
  if (isDirty.value) {
    const confirmed = window.confirm(t('file.inspector.confirm.reloadDiscardChanges'))
    if (!confirmed) {
      return
    }
  }

  await loadSelectedFile()
}

function switchTab(nextTab: InspectorTab): void {
  if (nextTab === 'edit' && !canEdit.value) {
    return
  }
  activeTab.value = nextTab
}

async function handleSave(): Promise<void> {
  if (!canSave.value || !loadedPath.value) {
    return
  }

  if (!confirmEncodingWriteback(t('file.inspector.action.save'))) {
    return
  }

  saving.value = true
  actionMessage.value = null

  try {
    await writeText(loadedPath.value, editorText.value)
    persistedText.value = editorText.value
    actionMessage.value = t('file.inspector.message.saved', { path: loadedPath.value })
    emit('saved', loadedPath.value)
  } catch (reason) {
    const message = toErrorMessage(reason, t('file.inspector.error.saveFailed'))
    loadError.value = message
    emit('error', message)
  } finally {
    saving.value = false
  }
}

async function handleSaveAs(): Promise<void> {
  if (!sessionIdValue.value || !isTextBased.value || contentTruncated.value) {
    return
  }

  if (!confirmEncodingWriteback(t('file.inspector.action.saveAs'))) {
    return
  }

  const basePath = loadedPath.value ?? selectedFile.value?.path
  if (!basePath) {
    return
  }

  const input = window.prompt(t('file.inspector.prompt.saveAsPath'), suggestSaveAsPath(basePath))
  if (input === null) {
    return
  }

  const targetPath = normalizeRemotePath(input)
  if (!targetPath || targetPath === '/') {
    loadError.value = t('file.inspector.error.invalidSaveAsPath')
    return
  }

  saving.value = true
  actionMessage.value = null

  try {
    await writeText(targetPath, editorText.value)
    actionMessage.value = t('file.inspector.message.savedAs', { path: targetPath })
    emit('saved-as', targetPath)
  } catch (reason) {
    const message = toErrorMessage(reason, t('file.inspector.error.saveAsFailed'))
    loadError.value = message
    emit('error', message)
  } finally {
    saving.value = false
  }
}

function confirmEncodingWriteback(actionLabel: string): boolean {
  if (detectedEncoding.value !== 'GB18030') {
    return true
  }

  return window.confirm(t('file.inspector.confirm.encodingWriteback', { action: actionLabel }))
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!isDirty.value) {
    return
  }

  event.preventDefault()
  event.returnValue = ''
}

watch(
  () => [sessionIdValue.value, selectedFile.value?.path] as const,
  () => {
    void loadSelectedFile()
  },
  { immediate: true },
)

watch(
  isDirty,
  (dirty) => {
    emit('dirty-change', dirty)
  },
  { immediate: true },
)

watch(
  () => previewText.value,
  () => {
    if (previewKind.value !== 'log' || !autoScrollLog.value) {
      return
    }

    void nextTick(() => {
      scrollLogToBottom()
    })
  },
)

watch(autoScrollLog, (enabled) => {
  if (!enabled || previewKind.value !== 'log') {
    return
  }

  void nextTick(() => {
    scrollLogToBottom()
  })
})

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onBeforeUnmount(() => {
  activeLoadToken += 1
  window.removeEventListener('beforeunload', handleBeforeUnload)
  emit('dirty-change', false)
})
</script>

<template>
  <section class="remote-file-inspector">
    <header class="inspector-header">
      <div class="inspector-title">
        <h3>{{ t('file.inspector.title') }}</h3>
        <p :title="fileLabel">{{ fileLabel }}</p>
        <p v-if="detectedEncoding && isTextBased" class="inspector-meta">
          {{ t('file.inspector.currentEncoding', { encoding: detectedEncoding }) }}
        </p>
        <p v-if="saveEncodingLabel" class="inspector-meta">{{ saveEncodingLabel }}</p>
      </div>

      <div class="inspector-actions">
        <button type="button" :disabled="loading || saving || !selectedFile" @click="void handleReload">
          {{ t('file.inspector.action.reload') }}
        </button>
        <button
          v-if="isTextBased"
          type="button"
          :disabled="loading || saving || !canEdit"
          @click="switchTab(activeTab === 'preview' ? 'edit' : 'preview')"
        >
          {{ activeTab === 'preview' ? t('file.inspector.action.edit') : t('file.inspector.action.preview') }}
        </button>
        <button type="button" :disabled="!canSave" @click="void handleSave">
          {{ saving ? t('file.inspector.action.saving') : t('file.inspector.action.save') }}
        </button>
        <button
          type="button"
          :disabled="loading || saving || !isTextBased || !selectedFile || contentTruncated"
          @click="void handleSaveAs"
        >
          {{ t('file.inspector.action.saveAs') }}
        </button>
      </div>
    </header>

    <p v-if="loadError" class="inspector-message is-error">{{ loadError }}</p>
    <p v-else-if="capabilityHint" class="inspector-message is-warning">{{ capabilityHint }}</p>
    <p v-else-if="actionMessage" class="inspector-message is-success">{{ actionMessage }}</p>
    <p v-else-if="previewNotice" class="inspector-message is-warning">{{ previewNotice }}</p>
    <p v-else-if="isDirty" class="inspector-message is-warning">{{ t('file.inspector.message.unsavedChanges') }}</p>

    <main class="inspector-body">
      <div v-if="!sessionIdValue" class="inspector-placeholder">{{ t('file.inspector.placeholder.selectSession') }}</div>
      <div v-else-if="!props.entry" class="inspector-placeholder">{{ t('file.inspector.placeholder.selectFile') }}</div>
      <div v-else-if="props.entry.type !== 'file'" class="inspector-placeholder">{{ t('file.inspector.placeholder.directoryUnsupported') }}</div>
      <div v-else-if="loading" class="inspector-placeholder">{{ t('file.inspector.placeholder.loading') }}</div>
      <div v-else-if="capabilityHint" class="inspector-placeholder">{{ capabilityHint }}</div>
      <div v-else-if="previewKind === 'image'" class="image-preview-wrap">
        <img v-if="imageDataUrl" :src="imageDataUrl" :alt="props.entry.name" class="image-preview" />
        <p v-else class="inspector-placeholder">{{ t('file.inspector.placeholder.emptyImage') }}</p>
      </div>
      <div v-else-if="isTextBased && activeTab === 'edit'" class="editor-wrap">
        <textarea
          v-model="editorText"
          class="text-editor"
          spellcheck="false"
          :placeholder="t('file.inspector.placeholder.editor')"
        />
      </div>
      <div v-else-if="previewKind === 'json'" class="text-preview-wrap">
        <p v-if="jsonParseError" class="json-error">{{ t('file.inspector.error.jsonParseFailed') }}: {{ jsonParseError }}</p>
        <pre class="text-preview">{{ previewText }}</pre>
      </div>
      <div v-else-if="previewKind === 'log'" class="log-preview-wrap">
        <div class="log-tools">
          <label>
            <input v-model="autoScrollLog" type="checkbox" />
            {{ t('file.inspector.action.autoScrollBottom') }}
          </label>
          <button type="button" @click="scrollLogToBottom">{{ t('file.inspector.action.scrollBottom') }}</button>
        </div>
        <div ref="logViewportRef" class="log-viewport">
          <pre class="text-preview">{{ previewText }}</pre>
        </div>
      </div>
      <div v-else-if="previewKind === 'text'" class="text-preview-wrap">
        <pre class="text-preview">{{ previewText }}</pre>
      </div>
      <div v-else class="inspector-placeholder">{{ t('file.inspector.placeholder.unsupportedPreview') }}</div>
    </main>
  </section>
</template>

<style scoped>
.remote-file-inspector {
  display: flex;
  flex-direction: column;
  min-height: 240px;
  border: 1px solid #d0d7de;
  background: #ffffff;
}

.inspector-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid #d0d7de;
  background: #f6f8fa;
}

.inspector-title {
  min-width: 0;
}

.inspector-title h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #1f2937;
}

.inspector-title p {
  margin: 4px 0 0;
  font-size: 12px;
  color: #57606a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.inspector-title .inspector-meta {
  margin-top: 2px;
  color: #0f4c81;
}

.inspector-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.inspector-actions button,
.log-tools button {
  height: 28px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  background: #ffffff;
  color: #24292f;
  font-size: 12px;
  cursor: pointer;
  padding: 0 10px;
}

.inspector-actions button:disabled,
.log-tools button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.inspector-message {
  margin: 0;
  padding: 8px 12px;
  border-bottom: 1px solid #d0d7de;
  font-size: 12px;
}

.inspector-message.is-error {
  color: #cf222e;
  background: #ffebe9;
}

.inspector-message.is-warning {
  color: #9a6700;
  background: #fff8c5;
}

.inspector-message.is-success {
  color: #0550ae;
  background: #ddf4ff;
}

.inspector-body {
  position: relative;
  min-height: 0;
  flex: 1;
  overflow: auto;
}

.inspector-placeholder {
  padding: 16px 12px;
  font-size: 13px;
  color: #57606a;
}

.image-preview-wrap,
.text-preview-wrap,
.log-preview-wrap,
.editor-wrap {
  min-height: 0;
  height: 100%;
}

.image-preview-wrap {
  display: grid;
  place-items: center;
  padding: 12px;
}

.image-preview {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border: 1px solid #d0d7de;
  border-radius: 8px;
  background: #ffffff;
}

.text-preview {
  margin: 0;
  padding: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre;
  overflow: auto;
  color: #111827;
}

.json-error {
  margin: 0;
  padding: 10px 12px;
  border-bottom: 1px solid #f5c2c7;
  background: #ffebe9;
  color: #b42318;
  font-size: 12px;
}

.editor-wrap {
  padding: 10px;
}

.text-editor {
  width: 100%;
  min-height: 220px;
  height: 100%;
  border: 1px solid #d0d7de;
  border-radius: 8px;
  resize: vertical;
  padding: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #0f172a;
}

.log-preview-wrap {
  display: flex;
  flex-direction: column;
}

.log-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #d0d7de;
  background: #f8fafc;
  font-size: 12px;
  color: #475569;
}

.log-viewport {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>
