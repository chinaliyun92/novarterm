<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { useSftpDownloadCenter } from '../../composables/useSftpDownloadCenter'
import type { DownloadCenterRecord } from '../../composables/useSftpDownloadCenter'
import type { TerminalWorkspaceTab } from '../../types/terminal'

const props = defineProps<{
  sessions: TerminalWorkspaceTab[]
  activeSessionId: string | null
  canCreate: boolean
}>()

const emit = defineEmits<{
  (event: 'switch', sessionId: string): void
  (event: 'create'): void
  (event: 'request-close', sessionId: string): void
  (
    event: 'reorder',
    payload: { fromSessionId: string; toSessionId: string; position: 'before' | 'after' }
  ): void
}>()

const i18n = useI18n()
const downloadCenter = useSftpDownloadCenter()

function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params)
}

const draggingSessionId = ref<string | null>(null)
const dragOverSessionId = ref<string | null>(null)
const dragOverPosition = ref<'before' | 'after' | null>(null)
const downloadContainerRef = ref<HTMLElement | null>(null)

function handleSwitch(sessionId: string): void {
  emit('switch', sessionId)
}

function requestClose(sessionId: string): void {
  emit('request-close', sessionId)
}

function clearDragState(): void {
  draggingSessionId.value = null
  dragOverSessionId.value = null
  dragOverPosition.value = null
}

function resolveDropPosition(event: DragEvent): 'before' | 'after' {
  const element = event.currentTarget as HTMLElement | null
  if (!element) {
    return 'after'
  }

  const rect = element.getBoundingClientRect()
  const midpoint = rect.left + rect.width / 2
  const pointX = event.clientX
  return pointX < midpoint ? 'before' : 'after'
}

function handleDragStart(event: DragEvent, sessionId: string): void {
  draggingSessionId.value = sessionId
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', sessionId)
  }
}

function handleDragOver(event: DragEvent, sessionId: string): void {
  if (!draggingSessionId.value || draggingSessionId.value === sessionId) {
    return
  }

  event.preventDefault()
  dragOverSessionId.value = sessionId
  dragOverPosition.value = resolveDropPosition(event)
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function handleDragLeave(sessionId: string): void {
  if (dragOverSessionId.value === sessionId) {
    dragOverSessionId.value = null
    dragOverPosition.value = null
  }
}

function handleDrop(event: DragEvent, sessionId: string): void {
  event.preventDefault()
  const fromSessionId = draggingSessionId.value
  const position = resolveDropPosition(event)
  clearDragState()

  if (!fromSessionId || fromSessionId === sessionId) {
    return
  }

  emit('reorder', {
    fromSessionId,
    toSessionId: sessionId,
    position,
  })
}

function formatBytes(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '—'
  }
  if (value < 1024) {
    return `${Math.round(value)} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = value / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024
    unit = units[index]
  }
  const fixed = size >= 100 ? 0 : 1
  return `${size.toFixed(fixed)} ${unit}`
}

function formatProgress(record: DownloadCenterRecord): string {
  const transferred = formatBytes(record.transferredBytes)
  if (typeof record.totalBytes === 'number' && record.totalBytes > 0) {
    return `${transferred} / ${formatBytes(record.totalBytes)}`
  }
  return t('terminal.downloadCenter.progressUnknown', { transferred })
}

function statusLabel(record: DownloadCenterRecord): string {
  const prefix =
    record.direction === 'upload'
      ? 'terminal.downloadCenter.status.upload'
      : 'terminal.downloadCenter.status.download'

  switch (record.state) {
    case 'started':
      return t(`${prefix}.started`)
    case 'progress':
      return t(`${prefix}.progress`)
    case 'completed':
      return t(`${prefix}.completed`)
    case 'failed':
      return t(`${prefix}.failed`)
    default:
      return record.state
  }
}

function displayPath(record: DownloadCenterRecord): string {
  const value = record.localPath?.trim()
  if (value) {
    return value
  }
  return record.remotePath
}

function resolveDirectoryPath(value: string): string | null {
  const raw = value.trim()
  if (!raw) {
    return null
  }

  if (raw === '/' || raw === '\\') {
    return raw
  }

  if (/^[A-Za-z]:[\\/]?$/.test(raw)) {
    return raw.endsWith('\\') ? raw : `${raw.replace(/[\\/]$/, '')}\\`
  }

  const compact = raw.replace(/[\\/]+$/g, '')
  if (!compact) {
    return null
  }

  const separatorIndex = Math.max(compact.lastIndexOf('/'), compact.lastIndexOf('\\'))
  if (separatorIndex < 0) {
    return null
  }

  if (separatorIndex === 0) {
    return compact[0]
  }

  if (separatorIndex === 2 && /^[A-Za-z]:/.test(compact)) {
    return `${compact.slice(0, 2)}\\`
  }

  return compact.slice(0, separatorIndex)
}

function directoryPathForRecord(record: DownloadCenterRecord): string | null {
  return resolveDirectoryPath(displayPath(record))
}

function canOpenDirectory(record: DownloadCenterRecord): boolean {
  return directoryPathForRecord(record) !== null
}

async function openDirectory(record: DownloadCenterRecord): Promise<void> {
  const targetPath = directoryPathForRecord(record)
  if (!targetPath) {
    return
  }

  await window.electronAPI.shell.openPath(targetPath).catch(() => {})
}

function toggleDownloadPanel(): void {
  downloadCenter.toggle()
}

function clearDownloadHistory(): void {
  downloadCenter.clearHistory()
}

function handleGlobalPointerDown(event: PointerEvent): void {
  if (!downloadCenter.panelOpen.value) {
    return
  }

  const target = event.target
  if (!(target instanceof Node)) {
    return
  }

  const container = downloadContainerRef.value
  if (container?.contains(target)) {
    return
  }

  downloadCenter.close()
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !downloadCenter.panelOpen.value) {
    return
  }
  downloadCenter.close()
}

onMounted(() => {
  window.addEventListener('pointerdown', handleGlobalPointerDown)
  window.addEventListener('keydown', handleGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handleGlobalPointerDown)
  window.removeEventListener('keydown', handleGlobalKeydown)
})
</script>

<template>
  <div class="session-tabs">
    <div class="tab-list">
      <div
        v-for="(session, index) in props.sessions"
        :key="session.id"
        class="tab-item"
        :class="{
          active: props.activeSessionId === session.id,
          'drag-over-before': dragOverSessionId === session.id && dragOverPosition === 'before',
          'drag-over-after': dragOverSessionId === session.id && dragOverPosition === 'after',
          dragging: draggingSessionId === session.id,
        }"
        draggable="true"
        @click="handleSwitch(session.id)"
        @dragstart="handleDragStart($event, session.id)"
        @dragover="handleDragOver($event, session.id)"
        @dragleave="handleDragLeave(session.id)"
        @drop="handleDrop($event, session.id)"
        @dragend="clearDragState"
      >
        <button class="tab-title" type="button">{{ `T ${index + 1}` }}</button>

        <button
          class="tab-close"
          type="button"
          :aria-label="t('terminal.tabs.closeAria')"
          @click.stop="requestClose(session.id)"
        >
          ×
        </button>
      </div>

      <button
        class="create-btn"
        type="button"
        :disabled="!props.canCreate"
        :title="props.canCreate ? t('terminal.tabs.createTitle') : t('terminal.tabs.maxTitle', { max: 6 })"
        @click="emit('create')"
      >
        +
      </button>
    </div>

    <div ref="downloadContainerRef" class="download-center">
      <button
        class="download-center__toggle"
        :class="{ 'is-open': downloadCenter.panelOpen.value }"
        type="button"
        :aria-label="t('terminal.downloadCenter.buttonAria')"
        :title="t('terminal.downloadCenter.buttonTitle')"
        @click.stop="toggleDownloadPanel"
      >
        <span class="download-center__icon i-mdi-download" aria-hidden="true" />
        <span class="download-center__label">{{ t('terminal.downloadCenter.buttonLabel') }}</span>
        <span v-if="downloadCenter.runningCount.value > 0" class="download-center__badge">
          {{ downloadCenter.runningCount.value }}
        </span>
      </button>

      <section
        v-if="downloadCenter.panelOpen.value"
        class="download-center__panel"
        role="dialog"
        :aria-label="t('terminal.downloadCenter.title')"
      >
        <header class="download-center__header">
          <h4>{{ t('terminal.downloadCenter.title') }}</h4>
          <button
            type="button"
            class="download-center__clear"
            :disabled="downloadCenter.records.value.length === 0"
            @click="clearDownloadHistory"
          >
            {{ t('terminal.downloadCenter.clear') }}
          </button>
        </header>

        <p v-if="downloadCenter.records.value.length === 0" class="download-center__empty">
          {{ t('terminal.downloadCenter.empty') }}
        </p>

        <ul v-else class="download-center__list">
          <li
            v-for="record in downloadCenter.records.value"
            :key="record.taskId"
            class="download-center__item"
          >
            <div class="download-center__item-header">
              <strong :title="record.fileName">{{ record.fileName }}</strong>
              <span
                class="download-center__status"
                :class="{
                  'is-started': record.state === 'started',
                  'is-progress': record.state === 'progress',
                  'is-completed': record.state === 'completed',
                  'is-failed': record.state === 'failed',
                }"
              >
                {{ statusLabel(record) }}
              </span>
            </div>

            <div class="download-center__path-row" :data-tooltip="displayPath(record)">
              <p class="download-center__path">
                {{ displayPath(record) }}
              </p>
              <button
                type="button"
                class="download-center__open-dir"
                :disabled="!canOpenDirectory(record)"
                @click="void openDirectory(record)"
              >
                {{ t('terminal.downloadCenter.openDirectory') }}
              </button>
            </div>

            <div class="download-center__progress-label">
              <span>{{ formatProgress(record) }}</span>
              <span v-if="record.percent !== null">{{ record.percent }}%</span>
            </div>
            <div class="download-center__progress-track">
              <span
                class="download-center__progress-fill"
                :style="{ width: `${record.percent ?? 0}%` }"
              />
            </div>

            <p v-if="record.errorMessage" class="download-center__error">{{ record.errorMessage }}</p>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.session-tabs {
  display: flex;
  align-items: center;
  min-height: 40px;
  padding: 5px 10px;
  border-bottom: 1px solid #c5c9d1;
  background: #e7e9ee;
  gap: 10px;
}

.tab-list {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 1px 0;
  scrollbar-width: none;
}

.tab-list::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.create-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid #c5cad4;
  background: #f8f9fb;
  color: #4d5664;
  border-radius: 999px;
  padding: 0;
  font-size: 18px;
  line-height: 1;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}

.create-btn:hover {
  background: #ffffff;
  border-color: #b7becb;
  color: #2d3440;
  box-shadow: 0 1px 1px rgba(17, 24, 39, 0.08);
}

.create-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.tab-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  min-width: 170px;
  max-width: 260px;
  padding: 0 12px;
  border: 1px solid #bcc4d0;
  border-radius: 999px;
  background: #d5d9e1;
  color: #4a5361;
  margin: 0;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.tab-item.dragging {
  opacity: 0.55;
}

.tab-item.active {
  color: #1f2732;
  border-color: #cfd5de;
  background: #f8f9fb;
  box-shadow: 0 1px 0 rgba(17, 24, 39, 0.08);
}

.tab-item:not(.active):hover {
  background: #e1e5ec;
  color: #353e4b;
  border-color: #c4cbd7;
}

.tab-item.drag-over-before::before,
.tab-item.drag-over-after::after {
  content: '';
  position: absolute;
  top: 3px;
  bottom: 3px;
  width: 2px;
  border-radius: 2px;
  background: #60a5fa;
}

.tab-item.drag-over-before::before {
  left: -5px;
}

.tab-item.drag-over-after::after {
  right: -5px;
}

.tab-title {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  text-align: center;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-close {
  border: 0;
  background: transparent;
  color: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  cursor: pointer;
  opacity: 0.78;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  transition: opacity 0.12s ease, background 0.12s ease;
}

.tab-close:hover {
  opacity: 1;
  background: rgba(71, 85, 105, 0.16);
}

.download-center {
  position: relative;
  flex: 0 0 auto;
}

.download-center__toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  color: #334155;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
}

.download-center__toggle:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
}

.download-center__toggle:focus,
.download-center__toggle:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.18);
}

.download-center__toggle.is-open {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1e40af;
}

.download-center__icon {
  font-size: 13px;
}

.download-center__badge {
  min-width: 18px;
  height: 18px;
  border-radius: 999px;
  padding: 0 5px;
  border: 1px solid #93c5fd;
  background: #dbeafe;
  color: #1d4ed8;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
}

.download-center__panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: min(460px, calc(100vw - 30px));
  max-height: min(560px, calc(100vh - 120px));
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid #d7e0eb;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 22px 44px rgba(15, 23, 42, 0.2);
  z-index: 80;
}

.download-center__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid #e2e8f0;
}

.download-center__header h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #111827;
}

.download-center__clear {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #f8fafc;
  color: #334155;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.16s ease, border-color 0.16s ease;
}

.download-center__clear:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.download-center__clear:not(:disabled):hover {
  background: #eef2f7;
  border-color: #94a3b8;
}

.download-center__empty {
  margin: 0;
  padding: 16px 12px;
  font-size: 12px;
  color: #64748b;
}

.download-center__list {
  list-style: none;
  margin: 0;
  padding: 8px 8px 12px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.download-center__item {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.download-center__item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.download-center__item-header strong {
  font-size: 12px;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.download-center__status {
  flex: 0 0 auto;
  font-size: 11px;
  border-radius: 999px;
  padding: 2px 7px;
  border: 1px solid transparent;
}

.download-center__status.is-started,
.download-center__status.is-progress {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1d4ed8;
}

.download-center__status.is-completed {
  background: #ecfdf5;
  border-color: #bbf7d0;
  color: #15803d;
}

.download-center__status.is-failed {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}

.download-center__path {
  margin: 0;
  font-size: 11px;
  color: #64748b;
  line-height: 1.3;
  flex: 0 0 40%;
  max-width: 40%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.download-center__path-row {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
}

.download-center__open-dir {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: #2563eb;
  font-size: 11px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
}

.download-center__open-dir:hover {
  color: #1d4ed8;
  text-decoration: underline;
}

.download-center__open-dir:disabled {
  color: #94a3b8;
  cursor: not-allowed;
  text-decoration: none;
}

.download-center__path-row::after {
  content: attr(data-tooltip);
  position: absolute;
  left: 0;
  top: calc(100% + 6px);
  width: max-content;
  max-width: min(420px, calc(100vw - 56px));
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: #0f172a;
  color: #f8fafc;
  font-size: 11px;
  line-height: 1.3;
  white-space: normal;
  word-break: break-all;
  box-shadow: 0 10px 26px rgba(2, 6, 23, 0.28);
  opacity: 0;
  transform: translateY(-2px);
  pointer-events: none;
  transition: opacity 0.12s ease, transform 0.12s ease;
  z-index: 5;
}

.download-center__path-row:hover::after {
  opacity: 1;
  transform: translateY(0);
}

.download-center__progress-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: #334155;
}

.download-center__progress-track {
  width: 100%;
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  background: #e2e8f0;
}

.download-center__progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #2563eb 0%, #3b82f6 100%);
  transition: width 0.18s ease;
}

.download-center__error {
  margin: 0;
  font-size: 11px;
  color: #dc2626;
  line-height: 1.3;
}
</style>
