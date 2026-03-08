<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSessionPathSync } from './src/composables/useSessionPathSync'
import { useTerminalWorkspaceState } from './src/composables/useTerminalWorkspaceState'
import { useServerSidebarState } from './src/composables/useServerSidebarState'
import { useFileBrowserPaneState } from './src/composables/useFileBrowserPaneState'
import { useAppUiSettings } from './src/composables/useAppUiSettings'
import { useRuntimeSettings } from './src/composables/useRuntimeSettings'
import LocalFileBrowser from './src/components/file/LocalFileBrowser.vue'
import RemoteFileBrowser from './src/components/file/RemoteFileBrowser.vue'
import GlobalSettingsDialog from './src/components/settings/GlobalSettingsDialog.vue'
import GlobalMessageHost from './src/components/common/GlobalMessageHost.vue'
import { TerminalWorkspace } from './src/components/terminal'

const pingStatus = ref('未检测')
const LATENCY_WINDOW_SIZE = 10
const LATENCY_EMPTY_LABEL = '—'
const LATENCY_TREND_EMPTY_LABEL = '—'
const LATENCY_TREND_BASELINE_MS = 8
const LATENCY_TREND_RATIO = 0.12
const DIRECTORY_RECORD_THROTTLE_MS = 1500
const SIDEBAR_DEFAULT_WIDTH = 320
const SIDEBAR_MIN_WIDTH = 240
const SIDEBAR_MAX_WIDTH = 560
const MIN_WORKSPACE_WIDTH = 420
const FILE_PANE_NAVIGATE_UP_EVENT = 'iterm:file-pane:navigate-up'
const OPEN_SETTINGS_EVENT = 'novarterm:open-settings'
const FIRST_LAUNCH_SHORTCUTS_GUIDE_KEY = 'novarterm.shortcuts-guide.shown.v1'

type SettingsTab = 'general' | 'servers' | 'triggers' | 'ai'

const currentLatencyMs = ref<number | null>(null)
const latencyWindow = ref<number[]>([])
const workspace = useTerminalWorkspaceState()
const serverState = useServerSidebarState()
const fileBrowserPane = useFileBrowserPaneState()
const uiSettings = useAppUiSettings()
const runtimeSettings = useRuntimeSettings()

const TERMINAL_MONOSPACE_FALLBACK =
  '"JetBrains Mono","SF Mono",Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace'

function toFirstFontFamilyName(fontFamily: string): string {
  const firstSegment = fontFamily.split(',')[0] ?? ''
  return firstSegment.trim().replace(/^['"]|['"]$/g, '').toLowerCase()
}

function isMonospacePrimaryFont(fontFamily: string): boolean {
  const primary = toFirstFontFamilyName(fontFamily)
  if (!primary) {
    return false
  }

  const monospaceKeywords = [
    'mono',
    'code',
    'consolas',
    'menlo',
    'monaco',
    'courier',
    'fira',
    'jetbrains',
    'sf mono',
    'source code',
    'ubuntu mono',
    'cascadia',
    'iosevka',
  ]

  return monospaceKeywords.some((keyword) => primary.includes(keyword))
}

function resolveTerminalFontFamily(preferredFontFamily: string): string {
  const normalized = preferredFontFamily.trim()
  if (!normalized) {
    return TERMINAL_MONOSPACE_FALLBACK
  }

  if (!isMonospacePrimaryFont(normalized)) {
    return TERMINAL_MONOSPACE_FALLBACK
  }

  return normalized
}

const uiCssVars = computed<Record<string, string>>(() => ({
  ...uiSettings.cssVars.value,
  '--app-font-family': runtimeSettings.fontFamily.value,
  '--term-font-family': resolveTerminalFontFamily(runtimeSettings.fontFamily.value),
}))
const sidebarWidth = ref(SIDEBAR_DEFAULT_WIDTH)
const sidebarVisible = ref(false)
const settingsDialogOpen = ref(false)
const settingsDialogInitialTab = ref<SettingsTab>('general')
const viewportWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)
const isSidebarResizing = ref(false)
const isSidebarResizeEnabled = computed(() => sidebarVisible.value && viewportWidth.value > 1200)
const shellStyle = computed<Record<string, string>>(() => ({
  ...uiCssVars.value,
  '--sidebar-width': `${sidebarWidth.value}px`,
}))
const activeSessionId = computed(() => workspace.activeSessionId.value)
const sessionPathSync = useSessionPathSync()
const terminalCwd = computed(() => {
  const sessionId = activeSessionId.value
  if (!sessionId) {
    return null
  }
  return sessionPathSync.cwdBySession[sessionId] ?? null
})
const activeBoundServer = computed(() => serverState.getSessionBoundServer(activeSessionId.value))
const sshStatusLabel = computed(() => serverState.getSessionStateLabel(activeSessionId.value))
const activeSessionSnapshot = computed(() => serverState.getSessionSnapshot(activeSessionId.value))
const filePaneSourceSessionId = computed(() => fileBrowserPane.state.sourceSessionId)
const filePaneSourceSession = computed(() => {
  const sessionId = filePaneSourceSessionId.value
  if (!sessionId) {
    return null
  }
  return workspace.sessions.value.find((item) => item.id === sessionId) ?? null
})
function resolveSessionSshHost(sessionId: string | null | undefined): string | null {
  if (!sessionId) {
    return null
  }

  const session = workspace.sessions.value.find((item) => item.id === sessionId)
  const host = session?.sshHost?.trim() ?? ''
  return host || null
}

function isSessionInSshShell(sessionId: string | null | undefined): boolean {
  if (!sessionId) {
    return false
  }

  if (serverState.getSessionBoundServer(sessionId)) {
    return true
  }

  return Boolean(resolveSessionSshHost(sessionId))
}

const filePaneSourceKind = computed<'ssh' | 'local'>(() => {
  return isSessionInSshShell(filePaneSourceSessionId.value) ? 'ssh' : 'local'
})
const filePanePath = computed(() => fileBrowserPane.state.path)
const filePaneKey = computed(() => {
  return `${filePaneSourceSessionId.value ?? 'none'}:${filePanePath.value ?? 'none'}:${fileBrowserPane.state.requestId}`
})

const activeServerName = computed(() => {
  if (activeBoundServer.value) {
    return activeBoundServer.value.name
  }

  return serverState.selectedServer.value?.name ?? '未选择服务器'
})

let latencyPollTimer: number | null = null
let connectionDurationTimer: number | null = null
let directoryRecordTimer: number | null = null
let directoryRecordNextRunAt = 0
let pendingDirectoryRecord: { sessionId: string; path: string } | null = null
const lastRecordedDirectoryBySession = new Map<string, string>()
const connectionNow = ref(Date.now())
let removeSidebarResizeListeners: (() => void) | null = null
let removeWindowResizeListener: (() => void) | null = null
let removeSidebarShortcutListener: (() => void) | null = null
let removeOpenSettingsEventListener: (() => void) | null = null

function clampSidebarWidth(nextWidth: number): number {
  if (!Number.isFinite(nextWidth)) {
    return SIDEBAR_DEFAULT_WIDTH
  }

  const minWidth = SIDEBAR_MIN_WIDTH
  const maxByViewport = Math.max(minWidth, viewportWidth.value - MIN_WORKSPACE_WIDTH)
  const maxWidth = Math.max(minWidth, Math.min(SIDEBAR_MAX_WIDTH, maxByViewport))
  return Math.min(maxWidth, Math.max(minWidth, Math.round(nextWidth)))
}

function applySidebarWidth(nextWidth: number): void {
  sidebarWidth.value = clampSidebarWidth(nextWidth)
}

function isCloseWorkspaceShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat) {
    return false
  }

  if (event.altKey || event.shiftKey) {
    return false
  }

  if (!event.metaKey || event.ctrlKey) {
    return false
  }

  if (event.key.toLowerCase() !== 'w') {
    return false
  }

  return true
}

function isOpenSettingsShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat) {
    return false
  }

  if (event.altKey || event.shiftKey) {
    return false
  }

  if (!event.metaKey || event.ctrlKey) {
    return false
  }

  return event.key === ','
}

function openSettingsDialog(tab: SettingsTab = 'general'): void {
  settingsDialogInitialTab.value = tab
  settingsDialogOpen.value = true
}

function normalizeSettingsTab(raw: unknown): SettingsTab {
  if (raw === 'general' || raw === 'servers' || raw === 'triggers' || raw === 'ai') {
    return raw
  }
  return 'general'
}

function shouldShowShortcutsGuideOnFirstLaunch(): boolean {
  try {
    const marker = window.localStorage.getItem(FIRST_LAUNCH_SHORTCUTS_GUIDE_KEY)
    if (marker === '1') {
      return false
    }
    window.localStorage.setItem(FIRST_LAUNCH_SHORTCUTS_GUIDE_KEY, '1')
    return true
  } catch {
    return false
  }
}

function closeCurrentWorkspaceByShortcut(): void {
  const closedPane = workspace.closeFocusedPane()
  if (closedPane) {
    return
  }

  const activeTabId = workspace.activeTabSessionId.value
  if (!activeTabId) {
    return
  }

  workspace.requestCloseSession(activeTabId)
}

function isCreateTabShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat) {
    return false
  }

  if (event.altKey || event.shiftKey) {
    return false
  }

  if (!event.metaKey || event.ctrlKey) {
    return false
  }

  return event.key.toLowerCase() === 't'
}

function isEditableTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  if (!target) {
    return false
  }

  const tag = target.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    return true
  }

  if (target.isContentEditable) {
    return true
  }

  return Boolean(target.closest('[contenteditable="true"]'))
}

function isNavigateFilePaneParentShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat) {
    return false
  }

  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return false
  }

  if (isEditableTarget(event)) {
    return false
  }

  return event.key === 'Backspace' || event.key === 'Delete'
}

function requestNavigateParentForActiveFilePane(): boolean {
  const session = workspace.activeSession.value
  if (!session || session.kind !== 'file') {
    return false
  }

  const sessionId = session.id.trim()
  if (!sessionId) {
    return false
  }

  window.dispatchEvent(
    new CustomEvent<{ sessionId: string }>(FILE_PANE_NAVIGATE_UP_EVENT, {
      detail: { sessionId },
    }),
  )
  return true
}

function resolveTabSwitchShortcutIndex(event: KeyboardEvent): number | null {
  if (event.defaultPrevented || event.repeat) {
    return null
  }

  if (event.altKey || event.shiftKey) {
    return null
  }

  if (!event.metaKey || event.ctrlKey) {
    return null
  }

  const key = event.key.trim()
  if (!/^[1-9]$/.test(key)) {
    return null
  }

  return Number.parseInt(key, 10) - 1
}

function switchSessionByShortcut(index: number): boolean {
  if (!Number.isInteger(index) || index < 0) {
    return false
  }

  const target = workspace.tabSessions.value[index]
  if (!target) {
    return false
  }

  workspace.switchSession(target.id)
  return true
}

function isRemoteManagedSession(sessionId: string): boolean {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) {
    return false
  }

  return isSessionInSshShell(normalizedSessionId)
}

function stopSidebarResize(): void {
  isSidebarResizing.value = false
  removeSidebarResizeListeners?.()
  removeSidebarResizeListeners = null
}

function startSidebarResize(event: PointerEvent): void {
  if (!isSidebarResizeEnabled.value || event.button !== 0) {
    return
  }

  event.preventDefault()
  stopSidebarResize()
  isSidebarResizing.value = true

  const pointerMoveHandler = (moveEvent: PointerEvent) => {
    applySidebarWidth(moveEvent.clientX)
  }
  const pointerUpHandler = () => {
    stopSidebarResize()
  }

  document.addEventListener('pointermove', pointerMoveHandler)
  document.addEventListener('pointerup', pointerUpHandler)
  document.addEventListener('pointercancel', pointerUpHandler)
  removeSidebarResizeListeners = () => {
    document.removeEventListener('pointermove', pointerMoveHandler)
    document.removeEventListener('pointerup', pointerUpHandler)
    document.removeEventListener('pointercancel', pointerUpHandler)
  }
}

function handleWindowResize(): void {
  viewportWidth.value = window.innerWidth
  if (!isSidebarResizeEnabled.value) {
    stopSidebarResize()
  }
  applySidebarWidth(sidebarWidth.value)
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return '00:00:00'
  }

  const totalSeconds = Math.floor(durationMs / 1000)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600) % 24
  const days = Math.floor(totalSeconds / 86400)

  const hh = String(hours).padStart(2, '0')
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')

  if (days > 0) {
    return `${days}d ${hh}:${mm}:${ss}`
  }
  return `${hh}:${mm}:${ss}`
}

function summarizeErrorMessage(message: string, maxLength = 44): string {
  const normalized = message.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return '无'
  }
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength - 1)}…`
}

function pushLatencySample(latencyMs: number): void {
  const nextWindow = [...latencyWindow.value, latencyMs]
  if (nextWindow.length > LATENCY_WINDOW_SIZE) {
    nextWindow.splice(0, nextWindow.length - LATENCY_WINDOW_SIZE)
  }
  latencyWindow.value = nextWindow
}

function resetLatencyMetrics(): void {
  currentLatencyMs.value = null
  latencyWindow.value = []
}

function isLatencySamplingState(state: string): boolean {
  return state === 'connected' || state === 'reconnecting'
}

const currentLatencyLabel = computed(() => {
  if (currentLatencyMs.value === null) {
    return LATENCY_EMPTY_LABEL
  }
  return `${currentLatencyMs.value}ms`
})

const averageLatencyMs = computed(() => {
  if (latencyWindow.value.length === 0) {
    return null
  }

  const total = latencyWindow.value.reduce((sum, value) => sum + value, 0)
  return Math.round(total / latencyWindow.value.length)
})

const averageLatencyLabel = computed(() => {
  if (averageLatencyMs.value === null) {
    return LATENCY_EMPTY_LABEL
  }
  return `${averageLatencyMs.value}ms`
})

const jitterLatencyMs = computed(() => {
  if (latencyWindow.value.length === 0) {
    return null
  }

  const mean =
    latencyWindow.value.reduce((sum, value) => sum + value, 0) /
    latencyWindow.value.length
  const variance =
    latencyWindow.value.reduce((sum, value) => {
      const delta = value - mean
      return sum + delta * delta
    }, 0) / latencyWindow.value.length
  return Math.round(Math.sqrt(variance))
})

const jitterLatencyLabel = computed(() => {
  if (jitterLatencyMs.value === null) {
    return LATENCY_EMPTY_LABEL
  }
  return `${jitterLatencyMs.value}ms`
})

const latencyTrendDirection = computed<'up' | 'down' | 'flat' | null>(() => {
  const current = currentLatencyMs.value
  const average = averageLatencyMs.value
  if (current === null || average === null) {
    return null
  }

  const delta = current - average
  const threshold = Math.max(LATENCY_TREND_BASELINE_MS, Math.round(average * LATENCY_TREND_RATIO))
  if (delta > threshold) {
    return 'up'
  }
  if (delta < -threshold) {
    return 'down'
  }
  return 'flat'
})

const latencyTrendSymbol = computed(() => {
  if (!latencyTrendDirection.value) {
    return LATENCY_TREND_EMPTY_LABEL
  }
  if (latencyTrendDirection.value === 'up') {
    return '↑'
  }
  if (latencyTrendDirection.value === 'down') {
    return '↓'
  }
  return '→'
})

const latencyTrendLabel = computed(() => {
  if (!latencyTrendDirection.value) {
    return '未知'
  }
  if (latencyTrendDirection.value === 'up') {
    return '上升'
  }
  if (latencyTrendDirection.value === 'down') {
    return '下降'
  }
  return '平稳'
})

const connectionDurationLabel = computed(() => {
  const sessionId = activeSessionId.value
  if (!sessionId) {
    return '无会话'
  }

  const snapshot = activeSessionSnapshot.value
  if (!isLatencySamplingState(snapshot.state)) {
    return '未连接'
  }

  if (!snapshot.connectedAt) {
    return '未知'
  }

  const connectedAt = Date.parse(snapshot.connectedAt)
  if (Number.isNaN(connectedAt)) {
    return '未知'
  }

  return formatDuration(connectionNow.value - connectedAt)
})

const recentFailureFullMessage = computed(() => {
  const sessionId = activeSessionId.value
  if (!sessionId) {
    return null
  }
  return activeSessionSnapshot.value.lastError?.message?.trim() || null
})

const recentFailureSummaryLabel = computed(() => {
  if (!activeSessionId.value) {
    return '无会话'
  }
  if (!recentFailureFullMessage.value) {
    return '无'
  }
  return summarizeErrorMessage(recentFailureFullMessage.value)
})

async function checkIpc() {
  const res = await window.electronAPI.ping()
  pingStatus.value = `${res.message} @ ${res.at} | dbReady=${res.dbReady}`
}

async function fallbackProbeLatency(sessionId: string): Promise<number | null> {
  const startedAt = performance.now()
  try {
    const result = await window.electronAPI.ssh.status({ sessionId })
    if (!result.ok) {
      return null
    }
    return Math.round(performance.now() - startedAt)
  } catch {
    return null
  }
}

async function refreshNetworkLatency(): Promise<void> {
  const sessionId = activeSessionId.value
  if (!sessionId) {
    resetLatencyMetrics()
    return
  }

  if (!isLatencySamplingState(activeSessionSnapshot.value.state)) {
    resetLatencyMetrics()
    return
  }

  const fromServerState = await serverState.probeSessionStatusLatency(sessionId)
  const latencyMs = fromServerState ?? (await fallbackProbeLatency(sessionId))
  if (latencyMs === null) {
    currentLatencyMs.value = null
    return
  }

  currentLatencyMs.value = latencyMs
  pushLatencySample(latencyMs)
}

function startLatencyPolling(): void {
  if (latencyPollTimer !== null) {
    window.clearInterval(latencyPollTimer)
  }

  latencyPollTimer = window.setInterval(() => {
    void refreshNetworkLatency()
  }, 8000)
}

function stopLatencyPolling(): void {
  if (latencyPollTimer === null) {
    return
  }

  window.clearInterval(latencyPollTimer)
  latencyPollTimer = null
}

function startConnectionDurationTicker(): void {
  if (connectionDurationTimer !== null) {
    window.clearInterval(connectionDurationTimer)
  }

  connectionNow.value = Date.now()
  connectionDurationTimer = window.setInterval(() => {
    connectionNow.value = Date.now()
  }, 1000)
}

function stopConnectionDurationTicker(): void {
  if (connectionDurationTimer === null) {
    return
  }

  window.clearInterval(connectionDurationTimer)
  connectionDurationTimer = null
}

function flushDirectoryRecordQueue(): void {
  const payload = pendingDirectoryRecord
  if (!payload) {
    return
  }

  pendingDirectoryRecord = null
  void serverState
    .recordSessionDirectory(payload.sessionId, payload.path)
    .then(() => {
      lastRecordedDirectoryBySession.set(payload.sessionId, payload.path)
    })
    .finally(() => {
      directoryRecordNextRunAt = Date.now()
      if (pendingDirectoryRecord) {
        scheduleDirectoryRecordFlush()
      }
    })
}

function scheduleDirectoryRecordFlush(): void {
  if (directoryRecordTimer !== null) {
    return
  }

  const delay = Math.max(
    0,
    directoryRecordNextRunAt + DIRECTORY_RECORD_THROTTLE_MS - Date.now(),
  )
  directoryRecordTimer = window.setTimeout(() => {
    directoryRecordTimer = null
    flushDirectoryRecordQueue()
  }, delay)
}

function queueDirectoryRecord(sessionId: string, path: string): void {
  const normalizedSessionId = sessionId.trim()
  const normalizedPath = path.trim()
  if (!normalizedSessionId || !normalizedPath) {
    return
  }

  if (lastRecordedDirectoryBySession.get(normalizedSessionId) === normalizedPath) {
    return
  }

  pendingDirectoryRecord = {
    sessionId: normalizedSessionId,
    path: normalizedPath,
  }
  scheduleDirectoryRecordFlush()
}

function stopDirectoryRecordScheduler(): void {
  if (directoryRecordTimer !== null) {
    window.clearTimeout(directoryRecordTimer)
    directoryRecordTimer = null
  }
  pendingDirectoryRecord = null
}

function closeFileBrowserPane(): void {
  fileBrowserPane.close()
}

function handleFilePanePathChange(path: string): void {
  fileBrowserPane.updatePath(path)
}

onMounted(() => {
  void checkIpc()
  void serverState.ensureLoaded()
  void refreshNetworkLatency()
  startLatencyPolling()
  startConnectionDurationTicker()
  handleWindowResize()

  const resizeHandler = () => {
    handleWindowResize()
  }
  window.addEventListener('resize', resizeHandler)
  removeWindowResizeListener = () => {
    window.removeEventListener('resize', resizeHandler)
  }

  const sidebarShortcutHandler = (event: KeyboardEvent) => {
    if (isOpenSettingsShortcut(event)) {
      event.preventDefault()
      event.stopPropagation()
      if (settingsDialogOpen.value) {
        settingsDialogOpen.value = false
      } else {
        openSettingsDialog('general')
      }
      return
    }

    if (settingsDialogOpen.value) {
      return
    }

    if (isNavigateFilePaneParentShortcut(event) && requestNavigateParentForActiveFilePane()) {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (isCloseWorkspaceShortcut(event)) {
      event.preventDefault()
      event.stopPropagation()
      closeCurrentWorkspaceByShortcut()
      return
    }

    if (isCreateTabShortcut(event)) {
      event.preventDefault()
      event.stopPropagation()
      workspace.createSession({ activate: true })
      return
    }

    const tabIndex = resolveTabSwitchShortcutIndex(event)
    if (tabIndex === null || !switchSessionByShortcut(tabIndex)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
  }
  window.addEventListener('keydown', sidebarShortcutHandler, true)
  removeSidebarShortcutListener = () => {
    window.removeEventListener('keydown', sidebarShortcutHandler, true)
  }

  const openSettingsEventHandler = (event: Event) => {
    const detail = (event as CustomEvent<{ tab?: SettingsTab } | undefined>).detail
    openSettingsDialog(normalizeSettingsTab(detail?.tab))
  }
  window.addEventListener(OPEN_SETTINGS_EVENT, openSettingsEventHandler as EventListener)
  removeOpenSettingsEventListener = () => {
    window.removeEventListener(OPEN_SETTINGS_EVENT, openSettingsEventHandler as EventListener)
  }

  if (shouldShowShortcutsGuideOnFirstLaunch()) {
    openSettingsDialog('general')
  }
})

onBeforeUnmount(() => {
  stopLatencyPolling()
  stopConnectionDurationTicker()
  stopDirectoryRecordScheduler()
  stopSidebarResize()
  removeSidebarShortcutListener?.()
  removeSidebarShortcutListener = null
  removeOpenSettingsEventListener?.()
  removeOpenSettingsEventListener = null
  removeWindowResizeListener?.()
  removeWindowResizeListener = null
})

watch(
  activeSessionId,
  (nextSessionId, prevSessionId) => {
    if (nextSessionId === prevSessionId) {
      return
    }

    resetLatencyMetrics()

    if (prevSessionId) {
      sessionPathSync.clearSession(prevSessionId)
    }
    if (nextSessionId) {
      if (!isRemoteManagedSession(nextSessionId)) {
        void sessionPathSync.refreshCwd(nextSessionId)
      }
    }
  },
  { immediate: true },
)

watch(
  () => activeSessionSnapshot.value.state,
  (nextState, prevState) => {
    if (nextState === prevState) {
      return
    }

    if (!isLatencySamplingState(nextState)) {
      resetLatencyMetrics()
    }
  },
)

watch([activeSessionId, activeBoundServer], () => {
  void refreshNetworkLatency()
})

watch(
  [activeSessionId, terminalCwd],
  ([sessionId, cwd]) => {
    if (!sessionId || !cwd) {
      return
    }
    queueDirectoryRecord(sessionId, cwd)
  },
)

watch(
  () =>
    [
      fileBrowserPane.state.visible,
      filePaneSourceSessionId.value,
      workspace.sessions.value.map((item) => item.id).join('|'),
    ] as const,
  ([visible, sourceSessionId]) => {
    if (!visible || !sourceSessionId) {
      return
    }

    const exists = workspace.sessions.value.some((item) => item.id === sourceSessionId)
    if (!exists) {
      fileBrowserPane.close()
    }
  },
)
</script>

<template>
  <div
    class="shell"
    :class="{ 'is-sidebar-resizing': isSidebarResizing, 'is-sidebar-hidden': !sidebarVisible }"
    :style="shellStyle"
  >
    <aside v-if="sidebarVisible" class="sidebar">
      <div class="sidebar-placeholder" />
    </aside>

    <div
      v-if="isSidebarResizeEnabled"
      class="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧边栏宽度"
      @pointerdown="startSidebarResize"
    />

    <section class="workspace">
      <main class="panels" :class="{ 'with-file-pane': fileBrowserPane.state.visible }">
        <TerminalWorkspace />
        <aside v-if="fileBrowserPane.state.visible" class="file-pane">
          <header class="file-pane__header">
            <p>文件管理器</p>
            <button type="button" @click="closeFileBrowserPane">关闭</button>
          </header>

          <div class="file-pane__body">
            <RemoteFileBrowser
              v-if="filePaneSourceKind === 'ssh' && filePaneSourceSessionId"
              :key="`remote-${filePaneKey}`"
              :session-id="filePaneSourceSessionId"
              :initial-path="filePanePath || '/'"
              :session-cwd="filePanePath"
              @path-change="handleFilePanePathChange"
            />
            <LocalFileBrowser
              v-else
              :key="`local-${filePaneKey}`"
              :initial-path="filePanePath"
              :reload-key="fileBrowserPane.state.requestId"
              @path-change="handleFilePanePathChange"
            />
          </div>
        </aside>
      </main>
    </section>
  </div>
  <GlobalSettingsDialog :open="settingsDialogOpen" :initial-tab="settingsDialogInitialTab" @close="settingsDialogOpen = false" />
  <GlobalMessageHost />
</template>

<style scoped>
:global(*) {
  box-sizing: border-box;
}

:global(html),
:global(body),
:global(#app) {
  width: 100%;
  height: 100%;
}

:global(body) {
  margin: 0;
  font-family: var(--app-font-family, 'PingFang SC', 'Helvetica Neue', Arial, sans-serif);
  font-size: var(--app-font-size, 14px);
  line-height: var(--app-line-height, 1.5);
  background: var(--app-bg, #f4f6fb);
  color: var(--app-fg, #1f2a44);
}

.shell {
  position: relative;
  display: grid;
  grid-template-columns: var(--sidebar-width, 320px) 1fr;
  width: 100%;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  color: var(--app-fg, #1f2a44);
}

.shell.is-sidebar-hidden {
  grid-template-columns: 1fr;
}

.shell.is-sidebar-resizing {
  cursor: col-resize;
  user-select: none;
}

.sidebar {
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: #0f172a;
  border-right: 1px solid #1e293b;
}

.sidebar-placeholder {
  width: 100%;
  height: 100%;
}

.sidebar-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--sidebar-width, 320px) - 3px);
  width: 6px;
  cursor: col-resize;
  z-index: 40;
  touch-action: none;
}

.sidebar-resizer::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 1px;
  background: var(--app-panel-border, #d9dfef);
  opacity: 0.35;
  transition: opacity 0.15s ease;
}

.sidebar-resizer:hover::before,
.shell.is-sidebar-resizing .sidebar-resizer::before {
  opacity: 0.95;
}

.workspace {
  display: grid;
  grid-template-rows: 1fr;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.panels {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  min-width: 0;
  width: 100%;
  overflow: hidden;
}

.panels.with-file-pane {
  grid-template-columns: minmax(0, 1fr) minmax(300px, 420px);
}

.file-pane {
  width: min(100%, 420px);
  min-width: 300px;
  height: 100%;
  min-height: 0;
  border-left: 1px solid var(--app-panel-border, #d9dfef);
  background: #0b1220;
  display: grid;
  grid-template-rows: auto 1fr;
}

.file-pane__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 34px;
  padding: 0 10px;
  border-bottom: 1px solid #1f2937;
  background: #0f172a;
}

.file-pane__header p {
  margin: 0;
  color: #e2e8f0;
  font-size: 12px;
}

.file-pane__header button {
  height: 22px;
  padding: 0 8px;
  border: 1px solid #334155;
  border-radius: 6px;
  background: #0b1220;
  color: #e2e8f0;
  cursor: pointer;
  font-size: 12px;
}

.file-pane__body {
  min-height: 0;
}

@media (max-width: 1200px) {
  .shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  .shell.is-sidebar-hidden {
    grid-template-rows: 1fr;
  }

  .sidebar-resizer {
    display: none;
  }

  .panels {
    grid-template-columns: 1fr;
  }

  .panels.with-file-pane {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) minmax(240px, 45%);
  }

  .file-pane {
    width: 100%;
    min-width: 0;
    border-left: 0;
    border-top: 1px solid var(--app-panel-border, #d9dfef);
  }
}
</style>
