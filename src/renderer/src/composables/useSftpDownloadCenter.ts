import { computed, ref } from 'vue'
import type {
  SftpDownloadProgressEvent,
  SftpTransferDirection,
  SftpTransferState,
  SftpUploadProgressEvent,
} from '../../../shared/types/ssh'

type TransferCenterRecordState = SftpTransferState

export interface DownloadCenterRecord {
  taskId: string
  direction: SftpTransferDirection
  sessionId: string
  remotePath: string
  localPath: string
  fileName: string
  transferredBytes: number
  totalBytes: number | null
  percent: number | null
  state: TransferCenterRecordState
  startedAt: string
  updatedAt: string
  errorMessage: string | null
}

const MAX_RECORDS = 120
const RECORDS_SETTING_KEY = 'transfer.center.records.v1'
const PERSIST_DEBOUNCE_MS = 600

const panelOpen = ref(false)
const records = ref<DownloadCenterRecord[]>([])
let listenerBound = false
let hydrateTriggered = false
let persistTimer: ReturnType<typeof setTimeout> | null = null
let persistInFlight = false
let persistPending = false

export interface InvokeTransferTracker {
  taskId: string
  direction: SftpTransferDirection
  sessionId: string
  remotePath: string
  localPath: string
  startedAt: string
}

type ProgressEventLike = SftpDownloadProgressEvent | SftpUploadProgressEvent

function toFileName(remotePath: string, localPath: string): string {
  const remoteSegments = remotePath
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
  if (remoteSegments.length > 0) {
    return remoteSegments[remoteSegments.length - 1]
  }

  const localSegments = localPath
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
  return localSegments.length > 0 ? localSegments[localSegments.length - 1] : '(unknown)'
}

function normalizePercent(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  return Math.max(0, Math.min(100, Math.round(value)))
}

function isRunningState(state: TransferCenterRecordState): boolean {
  return state === 'started' || state === 'progress'
}

function getSettingsApi(): SettingsApi | null {
  const settings = window.electronAPI?.settings
  if (!settings || typeof settings.get !== 'function' || typeof settings.set !== 'function') {
    return null
  }
  return settings
}

function toPersistableRecords(): DownloadCenterRecord[] {
  return records.value
    .filter((item) => !isRunningState(item.state))
    .slice(0, MAX_RECORDS)
}

function queuePersistHistory(): void {
  if (!getSettingsApi()) {
    return
  }
  persistPending = true
  if (persistTimer) {
    clearTimeout(persistTimer)
  }
  persistTimer = setTimeout(() => {
    persistTimer = null
    void flushPersistHistoryQueue()
  }, PERSIST_DEBOUNCE_MS)
}

async function flushPersistHistoryQueue(): Promise<void> {
  if (persistInFlight || !persistPending) {
    return
  }

  const api = getSettingsApi()
  if (!api) {
    persistPending = false
    return
  }

  persistInFlight = true
  persistPending = false

  try {
    await api.set(RECORDS_SETTING_KEY, JSON.stringify(toPersistableRecords()))
  } catch {
    // Ignore persistence errors and keep UI responsive.
  } finally {
    persistInFlight = false
  }

  if (persistPending) {
    void flushPersistHistoryQueue()
  }
}

function normalizeLoadedRecord(raw: unknown): DownloadCenterRecord | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const item = raw as Partial<DownloadCenterRecord>
  const direction = item.direction === 'upload' ? 'upload' : item.direction === 'download' ? 'download' : null
  const state: TransferCenterRecordState | null =
    item.state === 'started' ||
    item.state === 'progress' ||
    item.state === 'completed' ||
    item.state === 'failed'
      ? item.state
      : null

  if (!direction || !state || isRunningState(state)) {
    return null
  }

  const taskId = typeof item.taskId === 'string' && item.taskId.trim() ? item.taskId.trim() : null
  const sessionId = typeof item.sessionId === 'string' ? item.sessionId.trim() : ''
  const remotePath = typeof item.remotePath === 'string' ? item.remotePath.trim() : ''
  const localPath = typeof item.localPath === 'string' ? item.localPath.trim() : ''
  const fileName =
    typeof item.fileName === 'string' && item.fileName.trim()
      ? item.fileName.trim()
      : toFileName(remotePath, localPath)

  if (!taskId || !sessionId || !fileName) {
    return null
  }

  const updatedAt =
    typeof item.updatedAt === 'string' && item.updatedAt.trim()
      ? item.updatedAt
      : new Date().toISOString()
  const startedAt =
    typeof item.startedAt === 'string' && item.startedAt.trim() ? item.startedAt : updatedAt

  return {
    taskId,
    direction,
    sessionId,
    remotePath,
    localPath,
    fileName,
    transferredBytes:
      typeof item.transferredBytes === 'number' && Number.isFinite(item.transferredBytes)
        ? Math.max(0, Math.floor(item.transferredBytes))
        : 0,
    totalBytes:
      typeof item.totalBytes === 'number' && Number.isFinite(item.totalBytes) && item.totalBytes > 0
        ? Math.max(0, Math.floor(item.totalBytes))
        : null,
    percent: normalizePercent(typeof item.percent === 'number' ? item.percent : null),
    state,
    startedAt,
    updatedAt,
    errorMessage:
      typeof item.errorMessage === 'string' && item.errorMessage.trim() ? item.errorMessage.trim() : null,
  }
}

function mergeLoadedHistory(loaded: DownloadCenterRecord[]): void {
  if (!loaded.length) {
    return
  }

  const merged: DownloadCenterRecord[] = []
  const seen = new Set<string>()
  const combined = [...records.value, ...loaded]
  combined.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))

  for (const item of combined) {
    if (seen.has(item.taskId)) {
      continue
    }
    seen.add(item.taskId)
    merged.push(item)
    if (merged.length >= MAX_RECORDS) {
      break
    }
  }

  records.value = merged
}

function hydratePersistedHistory(): void {
  if (hydrateTriggered) {
    return
  }
  hydrateTriggered = true

  const api = getSettingsApi()
  if (!api) {
    return
  }

  void api
    .get(RECORDS_SETTING_KEY)
    .then((result) => {
      if (!result.ok) {
        return
      }

      const rawValue = result.data.setting?.value
      if (!rawValue) {
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(rawValue)
      } catch {
        return
      }

      if (!Array.isArray(parsed)) {
        return
      }

      const loaded = parsed
        .map((item) => normalizeLoadedRecord(item))
        .filter((item): item is DownloadCenterRecord => item !== null)
        .slice(0, MAX_RECORDS)

      mergeLoadedHistory(loaded)
    })
    .catch(() => {
      // Ignore restore errors.
    })
}

function findActiveRecordIndexByPath(
  direction: SftpTransferDirection,
  sessionId: string,
  remotePath: string,
  localPath: string,
): number {
  return records.value.findIndex(
    (item) =>
      item.direction === direction &&
      isRunningState(item.state) &&
      item.sessionId === sessionId &&
      item.remotePath === remotePath &&
      item.localPath === localPath,
  )
}

function upsertRecord(direction: SftpTransferDirection, event: ProgressEventLike): void {
  const nowIso = event.at || new Date().toISOString()
  const normalizedPercent = event.state === 'completed' ? 100 : normalizePercent(event.percent)

  const nextPartial: Omit<DownloadCenterRecord, 'startedAt'> = {
    taskId: event.taskId,
    direction,
    sessionId: event.sessionId,
    remotePath: event.remotePath,
    localPath: event.localPath,
    fileName: toFileName(event.remotePath, event.localPath),
    transferredBytes: Math.max(0, Math.floor(event.transferredBytes || 0)),
    totalBytes:
      typeof event.totalBytes === 'number' && Number.isFinite(event.totalBytes) && event.totalBytes > 0
        ? Math.max(0, Math.floor(event.totalBytes))
        : null,
    percent: normalizedPercent,
    state: event.state,
    updatedAt: nowIso,
    errorMessage: event.error?.message?.trim() || null,
  }

  let existingIndex = records.value.findIndex((item) => item.taskId === event.taskId)
  if (existingIndex < 0) {
    existingIndex = findActiveRecordIndexByPath(direction, event.sessionId, event.remotePath, event.localPath)
  }
  if (existingIndex >= 0) {
    const current = records.value[existingIndex]
    const merged: DownloadCenterRecord = {
      ...current,
      ...nextPartial,
      taskId: event.taskId,
      startedAt: current.startedAt,
    }
    records.value.splice(existingIndex, 1)
    records.value.unshift(merged)
  } else {
    const next: DownloadCenterRecord = {
      ...nextPartial,
      startedAt: nowIso,
    }
    records.value.unshift(next)
  }

  if (records.value.length > MAX_RECORDS) {
    records.value.splice(MAX_RECORDS)
  }

  if (!isRunningState(nextPartial.state)) {
    queuePersistHistory()
  }
}

function ensureListener(): void {
  if (listenerBound) {
    return
  }
  if (!window.electronAPI?.ssh) {
    return
  }

  if (window.electronAPI.ssh.onSftpDownloadProgress) {
    window.electronAPI.ssh.onSftpDownloadProgress((event) => {
      upsertRecord('download', event)
      if (event.state === 'started') {
        panelOpen.value = true
      }
    })
  }

  if (window.electronAPI.ssh.onSftpUploadProgress) {
    window.electronAPI.ssh.onSftpUploadProgress((event) => {
      upsertRecord('upload', event)
      if (event.state === 'started') {
        panelOpen.value = true
      }
    })
  }

  listenerBound = true
}

function startInvokeTransfer(params: {
  direction: SftpTransferDirection
  sessionId: string
  remotePath: string
  localPath: string
}): InvokeTransferTracker {
  const startedAt = new Date().toISOString()
  const tracker: InvokeTransferTracker = {
    taskId: `invoke:${params.direction}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
    direction: params.direction,
    sessionId: params.sessionId,
    remotePath: params.remotePath,
    localPath: params.localPath,
    startedAt,
  }

  const record: DownloadCenterRecord = {
    taskId: tracker.taskId,
    direction: params.direction,
    sessionId: params.sessionId,
    remotePath: params.remotePath,
    localPath: params.localPath,
    fileName: toFileName(params.remotePath, params.localPath),
    transferredBytes: 0,
    totalBytes: null,
    percent: 0,
    state: 'started',
    startedAt,
    updatedAt: startedAt,
    errorMessage: null,
  }

  records.value.unshift(record)
  if (records.value.length > MAX_RECORDS) {
    records.value.splice(MAX_RECORDS)
  }

  panelOpen.value = true
  return tracker
}

function resolveTrackerRecordIndex(tracker: InvokeTransferTracker): number {
  let index = records.value.findIndex((item) => item.taskId === tracker.taskId)
  if (index >= 0) {
    return index
  }

  index = records.value.findIndex(
    (item) =>
      item.direction === tracker.direction &&
      item.sessionId === tracker.sessionId &&
      item.remotePath === tracker.remotePath &&
      item.localPath === tracker.localPath &&
      item.updatedAt >= tracker.startedAt,
  )
  return index
}

function completeInvokeTransfer(tracker: InvokeTransferTracker): void {
  const index = resolveTrackerRecordIndex(tracker)
  if (index < 0) {
    return
  }

  const current = records.value[index]
  const next: DownloadCenterRecord = {
    ...current,
    state: 'completed',
    percent: 100,
    updatedAt: new Date().toISOString(),
    errorMessage: null,
  }
  records.value.splice(index, 1)
  records.value.unshift(next)
  queuePersistHistory()
}

function failInvokeTransfer(tracker: InvokeTransferTracker, message: string): void {
  const index = resolveTrackerRecordIndex(tracker)
  if (index < 0) {
    return
  }

  const current = records.value[index]
  const next: DownloadCenterRecord = {
    ...current,
    state: 'failed',
    updatedAt: new Date().toISOString(),
    errorMessage: message.trim() || null,
  }
  records.value.splice(index, 1)
  records.value.unshift(next)
  queuePersistHistory()
}

const runningRecords = computed(() => records.value.filter((item) => isRunningState(item.state)))
const historyRecords = computed(() => records.value.filter((item) => !isRunningState(item.state)))
const runningCount = computed(() => runningRecords.value.length)

export function useSftpDownloadCenter() {
  hydratePersistedHistory()
  ensureListener()

  function startInvokeDownload(params: {
    sessionId: string
    remotePath: string
    localPath: string
  }): InvokeTransferTracker {
    return startInvokeTransfer({
      direction: 'download',
      ...params,
    })
  }

  function startInvokeUpload(params: {
    sessionId: string
    remotePath: string
    localPath: string
  }): InvokeTransferTracker {
    return startInvokeTransfer({
      direction: 'upload',
      ...params,
    })
  }

  function completeInvokeDownload(tracker: InvokeTransferTracker): void {
    completeInvokeTransfer(tracker)
  }

  function completeInvokeUpload(tracker: InvokeTransferTracker): void {
    completeInvokeTransfer(tracker)
  }

  function failInvokeDownload(tracker: InvokeTransferTracker, message: string): void {
    failInvokeTransfer(tracker, message)
  }

  function failInvokeUpload(tracker: InvokeTransferTracker, message: string): void {
    failInvokeTransfer(tracker, message)
  }

  function open(): void {
    panelOpen.value = true
  }

  function close(): void {
    panelOpen.value = false
  }

  function toggle(): void {
    panelOpen.value = !panelOpen.value
  }

  function clearHistory(): void {
    records.value = []
    queuePersistHistory()
  }

  return {
    panelOpen,
    records,
    runningRecords,
    historyRecords,
    runningCount,
    open,
    close,
    toggle,
    clearHistory,
    startInvokeDownload,
    startInvokeUpload,
    completeInvokeDownload,
    completeInvokeUpload,
    failInvokeDownload,
    failInvokeUpload,
  }
}
