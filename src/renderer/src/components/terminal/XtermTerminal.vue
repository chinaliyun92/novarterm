<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  expandHomePathWithKnownBase,
  normalizeSessionCwdValue,
  resolvePreferredSessionCwd,
  resolveSessionCwdHintFromCommand,
} from '../../../../shared/utils/session-cwd'
import {
  escapeShellPath,
} from '../../../../shared/utils/terminal-smoke'
import type { LocalFileListData } from '../../../../shared/types/local-file'
import { useAppUiSettings } from '../../composables/useAppUiSettings'
import { useGlobalMessage } from '../../composables/useGlobalMessage'
import { useI18n } from '../../composables/useI18n'
import { useServerSidebarState } from '../../composables/useServerSidebarState'
import { useSessionPathSync } from '../../composables/useSessionPathSync'
import { useSplitCwdInheritState } from '../../composables/useSplitCwdInheritState'
import { useTerminalSessionCache } from '../../composables/useTerminalSessionCache'
import { useTerminalTriggers } from '../../composables/useTerminalTriggers'
import { useTerminalWorkspaceState } from '../../composables/useTerminalWorkspaceState'
import { useRuntimeSettings } from '../../composables/useRuntimeSettings'
import type { ServerRecord } from '../../types/server'
import type {
  TerminalBridgeApi,
  TerminalDataEvent,
  TerminalErrorEvent,
  TerminalListenerCleanup,
} from '../../types/terminal'

interface TerminalLike {
  open: (element: HTMLElement) => void
  dispose: () => void
  write: (data: string) => void
  setOption?: (key: string, value: unknown) => void
  scrollToBottom?: () => void
  onData?: (listener: (data: string) => void) => { dispose: () => void }
  loadAddon?: (addon: unknown) => void
  attachCustomKeyEventHandler?: (customKeyEventHandler: (event: KeyboardEvent) => boolean) => void
  clear?: () => void
  refresh?: (start: number, end: number) => void
  focus?: () => void
  getSelection?: () => string
  cols: number
  rows: number
}

const props = defineProps<{
  sessionId: string
}>()

const mountEl = ref<HTMLDivElement | null>(null)
const contextMenuEl = ref<HTMLDivElement | null>(null)
const fallbackMode = ref(false)
const fallbackReason = ref('Terminal is initializing...')
const sessionPathSync = useSessionPathSync()
const contextMenuState = reactive({
  visible: false,
  x: 0,
  y: 0,
})
const contextMenuSelectedText = ref('')
const contextServerSubmenu = ref<null | 'new-tab' | 'new-pane' | 'connect-shell'>(null)
const contextServerSubmenuDirection = ref<'left' | 'right'>('right')
const uiSettings = useAppUiSettings()
const runtimeSettings = useRuntimeSettings()
const serverState = useServerSidebarState()
const triggerState = useTerminalTriggers()
const workspace = useTerminalWorkspaceState()
const sessionCache = useTerminalSessionCache()
const splitCwdInheritState = useSplitCwdInheritState()
const i18n = useI18n()
const globalMessage = useGlobalMessage()

let terminal: TerminalLike | null = null
let fitAddon: { fit?: () => void } | null = null
let webLinksAddon: { dispose?: () => void } | null = null
let resizeObserver: ResizeObserver | null = null
let xtermInputSubscription: { dispose: () => void } | null = null
let removeBridgeDataListener: (() => void) | null = null
let removeBridgeExitListener: (() => void) | null = null
let removeBridgeErrorListener: (() => void) | null = null
let hostInteractionCleanup: (() => void) | null = null
let removeDocumentPointerDownListener: (() => void) | null = null
let removeDocumentKeydownListener: (() => void) | null = null
let removeDocumentKeyupListener: (() => void) | null = null
let removeDocumentWheelListener: (() => void) | null = null
let removeWindowWheelListener: (() => void) | null = null
let removeWindowBlurListener: (() => void) | null = null
let activeBridgeSessionId: string | null = null
let lifecycleDisposed = false
let sessionBindingVersion = 0
let bridgeMissingReported = false
let zoomModifierPressed = false
let pointerInsideTerminalHost = false
const fontZoomHint = ref('')
let fontZoomHintTimer: ReturnType<typeof setTimeout> | null = null
type AIChatMessage =
  | { role: 'user'; content: string; displayCard?: AIUserDisplayCard }
  | { role: 'assistant'; content: string; isCommand?: boolean; commandText?: string }

interface AIUserDisplayCardSection {
  label: string
  value: string
}

interface AIUserDisplayCard {
  title: string
  sections: AIUserDisplayCardSection[]
}

type AIModelTarget =
  | {
      id: string
      kind: 'built_in'
      label: string
      model: string
    }
  | {
      id: string
      kind: 'user_custom'
      label: string
      model: string
      apiUrl: string
      apiKey: string
    }

interface AIUserPlatformConfig {
  id: number
  platformName: string
  apiUrl: string
  apiKey: string
  model: string
}

type AIResponseLanguage = 'en' | 'zh-CN' | 'ja' | 'ko' | 'ru' | 'ar' | 'hi'

const AI_COMMAND_MARKER = '<COMMAND>'
const AI_COMMAND_BAR_HISTORY_MAX_MESSAGES = 50
const AI_COMMAND_BAR_HISTORY_KEY_PREFIX = 'ai.commandBar.history.'
const AI_COMMAND_BAR_CONTEXT_RECENT_MESSAGES = 2
const AI_PLATFORMS_KEY = 'ai.platforms'
const AI_SELECTED_MODEL_KEY = 'ai.commandBar.selectedModel'
const AI_RESPONSE_LANGUAGE_KEY = 'ai.commandBar.responseLanguage'
const AI_PROXY_BASE_URL_KEY = 'ai.proxy.baseUrl'
const AI_PROXY_INSTALLATION_ID_KEY = 'ai.proxy.installationId'
const AI_PROXY_CLIENT_TOKEN_KEY = 'ai.proxy.clientToken'
const AI_BUILT_IN_MODEL_TARGET_ID = 'built_in_default'
const AI_BUILT_IN_MODEL_NAME = 'deepseek-chat'
const AI_PROXY_BASE_URL_DEFAULT_DEV = 'http://127.0.0.1:8787'
const AI_PROXY_BASE_URL_DEFAULT_PROD = 'https://novarterm.lanshansoft.com'
const AI_PROXY_BASE_URL_DEFAULT = resolveAIProxyBaseUrlDefault()
const AI_RESPONSE_LANGUAGE_DEFAULT: AIResponseLanguage = 'en'
const OPEN_SETTINGS_EVENT = 'novarterm:open-settings'
const SHOW_AI_RESPONSE_LANGUAGE_DEBUG = import.meta.env.DEV
const AI_COMMAND_BAR_DEBUG_LOG_ENABLED = import.meta.env.DEV
const TERMINAL_DEBUG_HINT_COOLDOWN_MS = 45_000
const TERMINAL_DEBUG_CONTEXT_MAX_LINES = 30
const TERMINAL_DEBUG_CONTEXT_MAX_CHARS = 10_000
const TERMINAL_DEBUG_HINT_PATTERNS: RegExp[] = [
  /\berror:/i,
  /\bfatal:/i,
  /\bexception\b/i,
  /\btraceback\b/i,
  /\bpanic:/i,
  /\bcommand not found\b/i,
  /\bpermission denied\b/i,
  /\bsegmentation fault\b/i,
  /\bcannot find module\b/i,
  /\bfailed with exit code\b/i,
  /\bexit status\s*[1-9]\d*\b/i,
  /\bnpm ERR!/i,
]

const aiCommandBarVisible = ref(false)
const aiCommandBarInput = ref('')
const aiCommandBarMessages = ref<AIChatMessage[]>([])
const aiCommandBarStreamingReply = ref('')
const aiCommandBarLoading = ref(false)
const aiCommandBarLastErrorCode = ref<string | null>(null)
const aiModelTargets = ref<AIModelTarget[]>([getBuiltInModelTarget()])
const aiSelectedModelTargetId = ref<string>(AI_BUILT_IN_MODEL_TARGET_ID)
const aiCommandBarInputEl = ref<HTMLTextAreaElement | null>(null)
const aiCommandBarContentEl = ref<HTMLDivElement | null>(null)
const aiCommandBarEl = ref<HTMLDivElement | null>(null)
const xtermShellEl = ref<HTMLElement | null>(null)
const aiCommandBarHeightPx = ref<number | null>(null)
const aiResponseLanguage = ref<AIResponseLanguage>(AI_RESPONSE_LANGUAGE_DEFAULT)
const terminalDebugHintVisible = ref(false)
const terminalDebugHintSessionId = ref('')
const terminalDebugHintContext = ref('')
let aiCommandBarResizeCleanup: (() => void) | null = null
let aiCommandBarRequestSequence = 0
let delayedCwdRefreshTimer: ReturnType<typeof setTimeout> | null = null
let backgroundBindTimer: ReturnType<typeof setTimeout> | null = null
let contextSubmenuHideTimer: ReturnType<typeof setTimeout> | null = null
let lastSyncedCols: number | null = null
let lastSyncedRows: number | null = null
const SESSION_HISTORY_LIMIT = 200
const PROMPT_BUFFER_LIMIT = 1024
const PERSISTED_TRANSCRIPT_LOAD_MAX_BYTES = 600_000
const LOCAL_SNAPSHOT_PERSIST_DELAY_MS = 1_800
const LOCAL_HISTORY_PERSIST_DELAY_MS = 1_200
const sessionCommandHistory = new Map<string, string[]>()
const sessionPendingInput = new Map<string, string>()
const sessionPromptBuffer = new Map<string, string>()
const localEchoLineBySession = new Map<string, string>()
const snapshotPersistTimerBySession = new Map<string, ReturnType<typeof setTimeout>>()
const historyPersistTimerBySession = new Map<string, ReturnType<typeof setTimeout>>()
const openedBridgeSessionIds = new Set<string>()
const sessionOpenedWithLocalFallback = new Set<string>()
const resizeSyncSuppressedUntilBySession = new Map<string, number>()
const deferredResizeSyncTimerBySession = new Map<string, ReturnType<typeof setTimeout>>()
const lastResizeSyncAtBySession = new Map<string, number>()
const sessionBindStartedAtBySession = new Map<string, number>()
const firstDataLoggedBySession = new Set<string>()
const firstPromptLoggedBySession = new Set<string>()
const RESIZE_SYNC_INTERVAL_MS = 140
const RESIZE_PROMPT_REDRAW_WINDOW_MS = 1200
const SPLIT_DEBUG_STORAGE_KEY = 'iterm.split-debug'
const SHELL_OUTPUT_DEBUG_STORAGE_KEY = 'iterm.shell-output-debug'
const REDRAW_DEBUG_STORAGE_KEY = 'iterm.redraw-debug'
const TRIGGER_DEBUG_STORAGE_KEY = 'iterm.trigger-debug'
const CONTEXT_MENU_MAIN_WIDTH = 220
const CONTEXT_MENU_MAIN_HEIGHT = 336
const CONTEXT_MENU_SUBMENU_WIDTH = 290
const CONTEXT_SUBMENU_HIDE_DELAY_MS = 180
const BACKGROUND_BIND_BASE_DELAY_MS = 640
const BACKGROUND_BIND_STEP_DELAY_MS = 260
const BACKGROUND_BIND_MAX_DELAY_MS = 4200
const sshAutoConnectCommandIssuedBySession = new Set<string>()
const sshAutoConnectAttemptBySession = new Map<string, number>()
const localPromptReadyBySession = new Set<string>()
const autoSshPromptSettleTimerBySession = new Map<string, ReturnType<typeof setTimeout>>()
const TERMINAL_COMMAND_SETTLE_DELAY_MS = 120
const splitInheritedCwdApplyingBySession = new Set<string>()
const splitInheritedCwdSettleTimerBySession = new Map<string, ReturnType<typeof setTimeout>>()
const remoteUploadHelperSessionIdsBySession = new Map<string, Set<string>>()
const remoteHostStackBySession = new Map<string, string[]>()
const triggerMatchTailBySession = new Map<string, string>()
const triggerRuleArmedBySession = new Map<string, boolean>()
const triggerLastFiredAtBySessionRule = new Map<string, number>()
const lastTerminalDebugHintAtBySession = new Map<string, number>()
const TRIGGER_MATCH_TAIL_MAX = 1024
const TRIGGER_MATCH_MIN_TAIL = 24
const TRIGGER_FIRE_COOLDOWN_MS = 500
const NEW_PANE_LOCALHOST_ITEM_ID = 'localhost'

function resolveAIProxyBaseUrlDefault(): string {
  const envDefault = import.meta.env.DEV
    ? import.meta.env.VITE_AI_PROXY_BASE_URL_DEV
    : import.meta.env.VITE_AI_PROXY_BASE_URL_PROD
  if (typeof envDefault === 'string' && envDefault.trim()) {
    return envDefault.trim().replace(/\/$/, '')
  }
  return import.meta.env.DEV
    ? AI_PROXY_BASE_URL_DEFAULT_DEV
    : AI_PROXY_BASE_URL_DEFAULT_PROD
}

const contextMenuServerList = computed<ServerRecord[]>(() => {
  return [...serverState.servers.value].sort((left, right) => {
    const byName = left.name.localeCompare(right.name)
    if (byName !== 0) {
      return byName
    }
    const byHost = left.host.localeCompare(right.host)
    if (byHost !== 0) {
      return byHost
    }
    return left.username.localeCompare(right.username)
  })
})

const newPaneContextMenuList = computed<Array<{ id: number | 'localhost'; label: string }>>(() => {
  return [
    { id: NEW_PANE_LOCALHOST_ITEM_ID, label: 'localhost' },
    ...contextMenuServerList.value.map((server) => ({
      id: server.id,
      label: formatServerMenuMeta(server),
    })),
  ]
})

function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params)
}

function isSplitDebugEnabled(): boolean {
  return false
}

function logSplitDebug(event: string, detail?: Record<string, unknown>): void {
  if (!isSplitDebugEnabled()) {
    return
  }

  const timestamp = new Date().toISOString()
  if (detail) {
    console.log(`[split-debug][terminal][${timestamp}] ${event}`, detail)
    return
  }

  console.log(`[split-debug][terminal][${timestamp}] ${event}`)
}

function isSplitCwdDebugEnabled(): boolean {
  return true
}

function logSplitCwdDebug(event: string, detail?: Record<string, unknown>): void {
  if (!isSplitCwdDebugEnabled()) {
    return
  }

  const timestamp = new Date().toISOString()
  if (detail) {
    console.log(`[split-cwd-debug][${timestamp}] ${event}`, detail)
    return
  }

  console.log(`[split-cwd-debug][${timestamp}] ${event}`)
}

function isShellOutputDebugEnabled(): boolean {
  return false
}

function formatShellOutputChunk(chunk: string): string {
  return chunk
    .replace(/\u001b/g, '\\x1b')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
}

function logLocalShellOutput(sessionId: string, chunk: string): void {
  if (!chunk || !isShellOutputDebugEnabled()) {
    return
  }

  const timestamp = new Date().toISOString()
  console.log(`[shell-output][${timestamp}]`, {
    sessionId,
    size: chunk.length,
    data: formatShellOutputChunk(chunk),
  })
}

function isRedrawDebugEnabled(): boolean {
  return false
}

function logRedrawDebug(event: string, detail?: Record<string, unknown>): void {
  if (!isRedrawDebugEnabled()) {
    return
  }

  const timestamp = new Date().toISOString()
  if (detail) {
    console.log(`[redraw-debug][${timestamp}] ${event}`, detail)
    return
  }
  console.log(`[redraw-debug][${timestamp}] ${event}`)
}

function isTriggerDebugEnabled(): boolean {
  return false
}

function isAutoSshDebugEnabled(): boolean {
  return true
}

function logAutoSshDebug(event: string, detail?: Record<string, unknown>): void {
  if (!isAutoSshDebugEnabled()) {
    return
  }

  const timestamp = new Date().toISOString()
  if (detail) {
    console.log(`[auto-ssh-debug][${timestamp}] ${event}`, detail)
    return
  }

  console.log(`[auto-ssh-debug][${timestamp}] ${event}`)
}

function isFileOpenDebugEnabled(): boolean {
  return true
}

function logFileOpenDebug(event: string, detail?: Record<string, unknown>): void {
  if (!isFileOpenDebugEnabled()) {
    return
  }

  const timestamp = new Date().toISOString()
  if (detail) {
    console.log(`[file-open-debug][${timestamp}] ${event}`, detail)
    return
  }

  console.log(`[file-open-debug][${timestamp}] ${event}`)
}

function clearAutoSshPromptSettleTimer(sessionId?: string): void {
  if (sessionId) {
    const timer = autoSshPromptSettleTimerBySession.get(sessionId)
    if (!timer) {
      return
    }

    clearTimeout(timer)
    autoSshPromptSettleTimerBySession.delete(sessionId)
    return
  }

  for (const timer of autoSshPromptSettleTimerBySession.values()) {
    clearTimeout(timer)
  }
  autoSshPromptSettleTimerBySession.clear()
}

function clearAutoSshRuntimeState(sessionId: string, reason: string): void {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) {
    return
  }

  clearAutoSshPromptSettleTimer(normalizedSessionId)
  const hadIssued = sshAutoConnectCommandIssuedBySession.has(normalizedSessionId)
  const previousAttempt = sshAutoConnectAttemptBySession.get(normalizedSessionId) ?? 0
  sshAutoConnectCommandIssuedBySession.delete(normalizedSessionId)
  sshAutoConnectAttemptBySession.delete(normalizedSessionId)

  if (!hadIssued && previousAttempt <= 0) {
    return
  }

  logAutoSshDebug('state cleared', {
    sessionId: normalizedSessionId,
    reason,
    hadIssued,
    previousAttempt,
  })
}

function scheduleAutoSshConnectAfterPromptSettled(sessionId: string, source: string): void {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) {
    return
  }

  if (sshAutoConnectCommandIssuedBySession.has(normalizedSessionId)) {
    return
  }

  clearAutoSshPromptSettleTimer(normalizedSessionId)
  const timer = setTimeout(() => {
    autoSshPromptSettleTimerBySession.delete(normalizedSessionId)
    void maybeAutoRunSshConnectCommand(normalizedSessionId, `${source}-settled`)
  }, TERMINAL_COMMAND_SETTLE_DELAY_MS)
  autoSshPromptSettleTimerBySession.set(normalizedSessionId, timer)
  logAutoSshDebug('schedule auto-connect after prompt settle', {
    sessionId: normalizedSessionId,
    source,
    delayMs: TERMINAL_COMMAND_SETTLE_DELAY_MS,
  })
}

function logTriggerDebug(event: string, detail?: Record<string, unknown>): void {
  if (!isTriggerDebugEnabled()) {
    return
  }

  const timestamp = new Date().toISOString()
  if (detail) {
    console.log(`[trigger-debug][${timestamp}] ${event}`, detail)
    return
  }

  console.log(`[trigger-debug][${timestamp}] ${event}`)
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getElapsedSinceBindStart(sessionId: string): number | null {
  const startedAt = sessionBindStartedAtBySession.get(sessionId)
  if (!Number.isFinite(startedAt)) {
    return null
  }

  return Math.max(0, Math.round(nowMs() - (startedAt as number)))
}

interface TerminalBridgeFailure {
  ok: false
  error?: {
    code?: string
    message?: string
    detail?: string
  }
}

interface FileWithPath extends File {
  path?: string
}

interface SSHBridgeFailure {
  ok: false
  error?: {
    code?: string
    message?: string
    detail?: string
  }
}

interface TerminalAppearanceOptions {
  fontSize: number
  lineHeight: number
  cursorStyle: 'block' | 'bar' | 'underline'
  fontFamily: string
  theme: Record<string, string>
}

const TERMINAL_MONOSPACE_FALLBACK =
  '"JetBrains Mono","SF Mono",Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace'

function getTerminalBridge(): TerminalBridgeApi | null {
  const target = window as Window & {
    electronAPI?: Partial<ElectronApi>
    __electronAPIBridge?: ElectronApi
  }

  const primary = target.electronAPI?.terminal
  if (primary) {
    return primary as unknown as TerminalBridgeApi
  }

  const fallbackBridge = target.__electronAPIBridge
  const fallback = fallbackBridge?.terminal
  if (fallback && fallbackBridge) {
    target.electronAPI = fallbackBridge
    return fallback as unknown as TerminalBridgeApi
  }

  return null
}

function normalizeCleanup(cleanup: TerminalListenerCleanup): (() => void) | null {
  if (typeof cleanup === 'function') {
    return cleanup
  }

  if (cleanup && typeof cleanup === 'object' && 'dispose' in cleanup) {
    return () => (cleanup as { dispose: () => void }).dispose()
  }

  return null
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function formatBridgeFailure(error: TerminalBridgeFailure['error']): string {
  if (!error) {
    return 'unknown terminal bridge error'
  }

  const code = typeof error.code === 'string' && error.code.trim() ? `[${error.code}] ` : ''
  const message = typeof error.message === 'string' && error.message.trim() ? error.message : 'unknown error'
  const detail = typeof error.detail === 'string' && error.detail.trim() ? ` (${error.detail})` : ''
  return `${code}${message}${detail}`
}

function isBridgeFailure(result: unknown): result is TerminalBridgeFailure {
  if (!result || typeof result !== 'object') {
    return false
  }

  const payload = result as Partial<TerminalBridgeFailure>
  return payload.ok === false
}

function isSSHBridgeFailure(result: unknown): result is SSHBridgeFailure {
  if (!result || typeof result !== 'object') {
    return false
  }

  const payload = result as Partial<SSHBridgeFailure>
  return payload.ok === false
}

interface TerminalPersistedStatePayload {
  transcript?: unknown
  history?: unknown
  cwd?: unknown
}

function normalizePersistedTerminalStatePayload(payload: unknown): { transcript: string; history: string[]; cwd: string | null } {
  if (!payload || typeof payload !== 'object') {
    return { transcript: '', history: [], cwd: null }
  }

  const candidate = payload as TerminalPersistedStatePayload
  const transcript = typeof candidate.transcript === 'string' ? candidate.transcript : ''
  const history = Array.isArray(candidate.history)
    ? candidate.history.filter((item): item is string => typeof item === 'string')
    : []
  const cwd = normalizeSessionCwdValue(typeof candidate.cwd === 'string' ? candidate.cwd : null)

  return {
    transcript,
    history,
    cwd,
  }
}

function normalizeFontSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 14
  }

  return Math.round(Math.min(20, Math.max(11, value)))
}

function normalizeLineHeight(value: number): number {
  if (!Number.isFinite(value)) {
    return 1.5
  }

  return Math.min(2, Math.max(1.1, value))
}

function readCssVarColor(name: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return fallback
  }

  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function resolveTerminalThemeOptions(): Record<string, string> {
  return {
    background: readCssVarColor('--term-bg', '#0b1220'),
    foreground: readCssVarColor('--term-fg', '#d6deeb'),
    cursor: readCssVarColor('--term-cursor', '#8fb9ff'),
    cursorAccent: readCssVarColor('--term-cursor-accent', '#0b1220'),
    selectionBackground: readCssVarColor('--term-selection-bg', '#3b82f655'),
    black: readCssVarColor('--term-black', '#3b4252'),
    red: readCssVarColor('--term-red', '#e06c75'),
    green: readCssVarColor('--term-green', '#98c379'),
    yellow: readCssVarColor('--term-yellow', '#e5c07b'),
    blue: readCssVarColor('--term-blue', '#61afef'),
    magenta: readCssVarColor('--term-magenta', '#c678dd'),
    cyan: readCssVarColor('--term-cyan', '#56b6c2'),
    white: readCssVarColor('--term-white', '#d6deeb'),
    brightBlack: readCssVarColor('--term-bright-black', '#4b5563'),
    brightRed: readCssVarColor('--term-bright-red', '#f87171'),
    brightGreen: readCssVarColor('--term-bright-green', '#86efac'),
    brightYellow: readCssVarColor('--term-bright-yellow', '#fde68a'),
    brightBlue: readCssVarColor('--term-bright-blue', '#93c5fd'),
    brightMagenta: readCssVarColor('--term-bright-magenta', '#e9d5ff'),
    brightCyan: readCssVarColor('--term-bright-cyan', '#99f6e4'),
    brightWhite: readCssVarColor('--term-bright-white', '#f8fafc'),
  }
}

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

function resolveTerminalAppearanceOptions(): TerminalAppearanceOptions {
  const fontFamily = resolveTerminalFontFamily(runtimeSettings.fontFamily.value)

  return {
    fontSize: normalizeFontSize(uiSettings.fontSize.value),
    lineHeight: normalizeLineHeight(uiSettings.lineHeight.value),
    cursorStyle: uiSettings.cursorStyle.value,
    fontFamily,
    theme: resolveTerminalThemeOptions(),
  }
}

function applyTerminalAppearanceOptions(): void {
  if (!terminal) {
    return
  }

  const options = resolveTerminalAppearanceOptions()
  setTerminalOption('fontSize', options.fontSize)
  setTerminalOption('lineHeight', options.lineHeight)
  setTerminalOption('cursorStyle', options.cursorStyle)
  setTerminalOption('fontFamily', options.fontFamily)
  setTerminalOption('theme', options.theme)
  terminal.refresh?.(0, Math.max(0, terminal.rows - 1))
  // 字号/行高/字体变化后需重新 fit 并同步 resize，否则视口与滚动条会错位
  scheduleResizeSyncToBridge({ immediate: true })
}

function setTerminalOption(key: string, value: unknown): void {
  if (!terminal) {
    return
  }

  if (typeof terminal.setOption === 'function') {
    terminal.setOption(key, value)
    return
  }

  const optionsTarget = terminal as unknown as { options?: Record<string, unknown> }
  if (optionsTarget.options && typeof optionsTarget.options === 'object') {
    optionsTarget.options[key] = value
  }
}

function clearFontZoomHintTimer(): void {
  if (fontZoomHintTimer) {
    clearTimeout(fontZoomHintTimer)
    fontZoomHintTimer = null
  }
}

function showFontZoomHint(fontSize: number): void {
  fontZoomHint.value = `Font ${fontSize}px`
  clearFontZoomHintTimer()
  fontZoomHintTimer = setTimeout(() => {
    fontZoomHintTimer = null
    fontZoomHint.value = ''
  }, 650)
}

function isTerminalZoomModifierActive(event: WheelEvent): boolean {
  const byFlag = event.metaKey || event.ctrlKey
  const byState =
    typeof event.getModifierState === 'function'
      ? event.getModifierState('Meta') || event.getModifierState('Control')
      : false
  return byFlag || byState || zoomModifierPressed
}

function adjustTerminalFontSizeByWheel(event: WheelEvent): void {
  // macOS: Command + wheel; Windows/Linux: Ctrl + wheel.
  if (!isTerminalZoomModifierActive(event)) {
    return
  }

  if (event.deltaY === 0) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  const step = event.deltaY < 0 ? 1 : -1
  const nextFontSize = normalizeFontSize(uiSettings.fontSize.value + step)
  if (nextFontSize === uiSettings.fontSize.value) {
    return
  }

  uiSettings.fontSize.value = nextFontSize
  showFontZoomHint(nextFontSize)
}

function hideContextMenu(): void {
  contextMenuState.visible = false
  clearContextSubmenuHideTimer()
  contextServerSubmenu.value = null
}

type AICommandBarSettingsApi = {
  get: (key: string) => Promise<{ ok: boolean; data?: { setting?: { value?: string } } }>
  set: (key: string, value: string) => Promise<{ ok: boolean }>
}

function isAICommandBarSettingsApi(api: unknown): api is AICommandBarSettingsApi {
  if (api == null || typeof api !== 'object') {
    return false
  }
  return (
    typeof (api as { get?: unknown }).get === 'function' &&
    typeof (api as { set?: unknown }).set === 'function'
  )
}

function getAICommandBarSettingsApi(): AICommandBarSettingsApi | null {
  const api = (window as Window & { electronAPI?: { settings?: unknown } }).electronAPI?.settings
  return isAICommandBarSettingsApi(api) ? api : null
}

function sanitizeAIUserPlatforms(raw: unknown): AIUserPlatformConfig[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter(
    (item): item is AIUserPlatformConfig =>
      item != null &&
      typeof item === 'object' &&
      typeof (item as AIUserPlatformConfig).id === 'number' &&
      typeof (item as AIUserPlatformConfig).platformName === 'string' &&
      typeof (item as AIUserPlatformConfig).apiUrl === 'string' &&
      typeof (item as AIUserPlatformConfig).apiKey === 'string' &&
      typeof (item as AIUserPlatformConfig).model === 'string',
  )
}

async function getAISettingValue(key: string): Promise<string | null> {
  const api = getAICommandBarSettingsApi()
  if (!api) {
    return null
  }
  try {
    const res = await api.get(key)
    if (!res.ok) {
      return null
    }
    const value = res.data?.setting?.value
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

async function setAISettingValue(key: string, value: string): Promise<void> {
  const api = getAICommandBarSettingsApi()
  if (!api) {
    return
  }
  try {
    await api.set(key, value)
  } catch {
    // ignore persistence failure
  }
}

function normalizeAIResponseLanguage(raw: string | null): AIResponseLanguage | null {
  const normalized = raw?.trim() ?? ''
  if (
    normalized === 'en' ||
    normalized === 'zh-CN' ||
    normalized === 'ja' ||
    normalized === 'ko' ||
    normalized === 'ru' ||
    normalized === 'ar' ||
    normalized === 'hi'
  ) {
    return normalized
  }
  return null
}

async function getStoredAIResponseLanguage(): Promise<AIResponseLanguage | null> {
  const raw = await getAISettingValue(AI_RESPONSE_LANGUAGE_KEY)
  const normalized = normalizeAIResponseLanguage(raw)
  if (normalized === AI_RESPONSE_LANGUAGE_DEFAULT) {
    // Backward-compatibility: old builds may persist "en"; treat it as unlocked.
    return null
  }
  return normalized
}

async function resolveAIResponseLanguage(): Promise<AIResponseLanguage> {
  return (await getStoredAIResponseLanguage()) ?? AI_RESPONSE_LANGUAGE_DEFAULT
}

async function refreshAIResponseLanguageDebug(): Promise<void> {
  if (!SHOW_AI_RESPONSE_LANGUAGE_DEBUG) {
    return
  }
  aiResponseLanguage.value = await resolveAIResponseLanguage()
}

function resolveAIResponseLanguageLabel(language: AIResponseLanguage): string {
  switch (language) {
    case 'zh-CN':
      return 'Simplified Chinese'
    case 'ja':
      return 'Japanese'
    case 'ko':
      return 'Korean'
    case 'ru':
      return 'Russian'
    case 'ar':
      return 'Arabic'
    case 'hi':
      return 'Hindi'
    default:
      return 'English'
  }
}

function detectAIResponseLanguageFromUserText(text: string): AIResponseLanguage | null {
  const normalized = text.normalize('NFKC').trim()
  if (!normalized) {
    return null
  }

  const count = (pattern: RegExp): number => (normalized.match(pattern) ?? []).length

  const cjk = count(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g)
  const hiragana = count(/[\u3040-\u309F]/g)
  const katakana = count(/[\u30A0-\u30FF]/g)
  const hangul = count(/[\uAC00-\uD7AF]/g)
  const cyrillic = count(/[\u0400-\u04FF]/g)
  const arabic = count(/[\u0600-\u06FF]/g)
  const devanagari = count(/[\u0900-\u097F]/g)
  const latin = count(/[A-Za-z]/g)

  if (hiragana + katakana >= 2) {
    return 'ja'
  }
  if (hangul >= 2) {
    return 'ko'
  }
  if (cyrillic >= 2) {
    return 'ru'
  }
  if (arabic >= 2) {
    return 'ar'
  }
  if (devanagari >= 2) {
    return 'hi'
  }
  if (cjk >= 2) {
    return 'zh-CN'
  }

  const nonLatin = cjk + hiragana + katakana + hangul + cyrillic + arabic + devanagari
  if (latin > 0 && latin >= nonLatin) {
    return 'en'
  }

  if (nonLatin > latin && nonLatin >= 2) {
    // Unknown non-Latin script: keep default behavior for now.
    return null
  }

  return null
}

async function maybeLockAIResponseLanguageFromUserInput(text: string): Promise<void> {
  const existing = await getStoredAIResponseLanguage()
  if (existing) {
    return
  }
  const detected = detectAIResponseLanguageFromUserText(text)
  if (!detected || detected === AI_RESPONSE_LANGUAGE_DEFAULT) {
    return
  }
  await setAISettingValue(AI_RESPONSE_LANGUAGE_KEY, detected)
}

function normalizeProxyBaseUrl(input: string | null): string {
  if (!input || !input.trim()) {
    return AI_PROXY_BASE_URL_DEFAULT
  }
  return input.trim().replace(/\/$/, '')
}

async function resolveAIProxyBaseUrl(): Promise<string> {
  const configured = await getAISettingValue(AI_PROXY_BASE_URL_KEY)
  return normalizeProxyBaseUrl(configured)
}

function getBuiltInModelTarget(): AIModelTarget {
  return {
    id: AI_BUILT_IN_MODEL_TARGET_ID,
    kind: 'built_in',
    label: t('terminal.aiBar.modelDefault'),
    model: AI_BUILT_IN_MODEL_NAME,
  }
}

function getCurrentAIModelTarget(): AIModelTarget {
  return (
    aiModelTargets.value.find((item) => item.id === aiSelectedModelTargetId.value) ??
    aiModelTargets.value[0] ??
    getBuiltInModelTarget()
  )
}

async function loadAIModelTargets(): Promise<void> {
  const builtIn = getBuiltInModelTarget()
  const raw = await getAISettingValue(AI_PLATFORMS_KEY)
  let userTargets: AIModelTarget[] = []
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown
      userTargets = sanitizeAIUserPlatforms(parsed)
        .filter((item) => item.apiUrl.trim() && item.apiKey.trim())
        .map((item) => {
          const modelName = item.model.trim() || 'unknown-model'
          const platformLabel = item.platformName.trim() || t('terminal.aiBar.platformFallback')
          return {
            id: `user:${item.id}`,
            kind: 'user_custom' as const,
            label: `${platformLabel} · ${modelName}`,
            model: modelName,
            apiUrl: item.apiUrl.trim(),
            apiKey: item.apiKey.trim(),
          }
        })
    } catch {
      userTargets = []
    }
  }
  aiModelTargets.value = [builtIn, ...userTargets]

  const persistedSelected = (await getAISettingValue(AI_SELECTED_MODEL_KEY))?.trim()
  const fallbackId = aiModelTargets.value[0]?.id ?? AI_BUILT_IN_MODEL_TARGET_ID
  const selectedId =
    persistedSelected && aiModelTargets.value.some((item) => item.id === persistedSelected)
      ? persistedSelected
      : fallbackId
  aiSelectedModelTargetId.value = selectedId
}

async function onAIModelTargetChange(): Promise<void> {
  const selectedId = aiSelectedModelTargetId.value
  await setAISettingValue(AI_SELECTED_MODEL_KEY, selectedId)
  await refreshAIResponseLanguageDebug()
}

function generateInstallationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `inst-${Date.now()}-${Math.random().toString(16).slice(2, 12)}`
}

async function requestProxyClientToken(baseUrl: string, installationId: string): Promise<string> {
  const response = await fetch(`${baseUrl}/v1/device/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ installation_id: installationId }),
  })
  const rawText = await response.text()
  type RegisterPayload = {
    ok?: boolean
    data?: {
      client_token?: string
      retry_after_seconds?: number
    }
    error?: {
      code?: string
      message?: string
    }
  }
  let payload: RegisterPayload | null = null
  try {
    payload = JSON.parse(rawText) as RegisterPayload
  } catch {
    payload = null
  }

  if (!response.ok || !payload?.ok || !payload.data?.client_token) {
    const errorCode = typeof payload?.error?.code === 'string' ? payload.error.code : undefined
    const retryAfterSeconds =
      typeof payload?.data?.retry_after_seconds === 'number' &&
      Number.isFinite(payload.data.retry_after_seconds) &&
      payload.data.retry_after_seconds > 0
        ? Math.ceil(payload.data.retry_after_seconds)
        : undefined
    if (errorCode === 'rate_limited') {
      if (typeof retryAfterSeconds === 'number') {
        throw new AIRequestError(
          t('terminal.aiBar.error.rateLimitedWithRetry', { seconds: retryAfterSeconds }),
          errorCode,
        )
      }
      throw new AIRequestError(t('terminal.aiBar.error.rateLimited'), errorCode)
    }

    const reason = payload?.error?.message || rawText || `HTTP ${response.status}`
    throw new AIRequestError(
      t('terminal.aiBar.error.proxyAuthFailed', {
        status: response.status,
        detail: reason,
      }),
      errorCode ?? 'proxy_auth_failed',
    )
  }
  return payload.data.client_token
}

async function ensureProxyClientToken(baseUrl: string): Promise<string> {
  let installationId = (await getAISettingValue(AI_PROXY_INSTALLATION_ID_KEY))?.trim() || ''
  if (!installationId) {
    installationId = generateInstallationId()
  }

  const cachedToken = (await getAISettingValue(AI_PROXY_CLIENT_TOKEN_KEY))?.trim() || ''
  if (cachedToken) {
    return cachedToken
  }

  const token = await requestProxyClientToken(baseUrl, installationId)
  await Promise.all([
    setAISettingValue(AI_PROXY_INSTALLATION_ID_KEY, installationId),
    setAISettingValue(AI_PROXY_CLIENT_TOKEN_KEY, token),
  ])
  return token
}

function getAICommandBarHistoryKey(sessionId: string): string {
  return `${AI_COMMAND_BAR_HISTORY_KEY_PREFIX}${sessionId}`
}

function toAIUserDisplayCard(raw: unknown): AIUserDisplayCard | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const candidate = raw as { title?: unknown; sections?: unknown }
  if (typeof candidate.title !== 'string' || !Array.isArray(candidate.sections)) {
    return undefined
  }
  const sections = candidate.sections.filter(
    (item): item is AIUserDisplayCardSection =>
      item != null &&
      typeof item === 'object' &&
      typeof (item as { label?: unknown }).label === 'string' &&
      typeof (item as { value?: unknown }).value === 'string',
  )
  if (!sections.length) {
    return undefined
  }
  return {
    title: candidate.title,
    sections,
  }
}

async function loadAICommandBarHistory(sessionId: string): Promise<void> {
  const api = getAICommandBarSettingsApi()
  if (!api) {
    aiCommandBarMessages.value = []
    nextTick(() => {
      scrollAICommandBarContentToBottom()
      aiCommandBarInputEl.value?.focus()
    })
    return
  }
  try {
    const res = await api.get(getAICommandBarHistoryKey(sessionId))
    const raw = res.ok && res.data?.setting?.value
    if (!raw) {
      aiCommandBarMessages.value = []
    } else {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        aiCommandBarMessages.value = parsed.filter(
          (m): m is { role: 'user' | 'assistant'; content: string; isCommand?: boolean; commandText?: string } =>
            m != null &&
            typeof m === 'object' &&
            ((m as { role?: string }).role === 'user' || (m as { role?: string }).role === 'assistant') &&
            typeof (m as { content?: unknown }).content === 'string',
        ).map((m) => {
          if (m.role === 'assistant') {
            return {
              role: 'assistant' as const,
              content: m.content,
              ...(m.isCommand && typeof m.commandText === 'string' ? { isCommand: true, commandText: m.commandText } : {}),
            } as AIChatMessage
          }
          const userCard = toAIUserDisplayCard((m as { displayCard?: unknown }).displayCard)
          return {
            role: 'user' as const,
            content: m.content,
            ...(userCard ? { displayCard: userCard } : {}),
          } as AIChatMessage
        })
      } else {
        aiCommandBarMessages.value = []
      }
    }
  } catch {
    aiCommandBarMessages.value = []
  }
  nextTick(() => {
    scrollAICommandBarContentToBottom()
    aiCommandBarInputEl.value?.focus()
  })
}

function persistAICommandBarHistory(): void {
  const api = getAICommandBarSettingsApi()
  if (!api) {
    return
  }
  const sessionId = props.sessionId
  if (!sessionId) {
    return
  }
  const payload = aiCommandBarMessages.value.slice(-AI_COMMAND_BAR_HISTORY_MAX_MESSAGES)
  void api.set(getAICommandBarHistoryKey(sessionId), JSON.stringify(payload))
}

function clearAICommandBarHistoryForSession(sessionId: string): void {
  const api = getAICommandBarSettingsApi()
  if (!api) {
    return
  }
  void api.set(getAICommandBarHistoryKey(sessionId), '[]').catch(() => {})
}

function closeAICommandBar(): void {
  aiCommandBarVisible.value = false
  aiCommandBarInput.value = ''
  aiCommandBarMessages.value = []
  aiCommandBarStreamingReply.value = ''
  aiCommandBarLastErrorCode.value = null
  nextTick(() => {
    terminal?.focus?.()
    terminal?.scrollToBottom?.()
    setTimeout(() => {
      terminal?.scrollToBottom?.()
    }, 50)
  })
}

function openAIModelSettings(): void {
  window.dispatchEvent(
    new CustomEvent<{ tab: 'ai' }>(OPEN_SETTINGS_EVENT, {
      detail: { tab: 'ai' },
    }),
  )
}

function onAICommandBarKeydown(event: KeyboardEvent): void {
  if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    event.stopPropagation()
    closeAICommandBar()
  }
}

const AI_COMMAND_BAR_RESIZE_MIN_PX = 100

function startAICommandBarResize(event: MouseEvent): void {
  event.preventDefault()
  const startY = event.clientY
  const startHeight =
    aiCommandBarHeightPx.value ??
    aiCommandBarEl.value?.offsetHeight ??
    Math.max(AI_COMMAND_BAR_RESIZE_MIN_PX, (xtermShellEl.value?.clientHeight ?? 400) * 0.5)
  const maxHeight = Math.max(AI_COMMAND_BAR_RESIZE_MIN_PX, (xtermShellEl.value?.clientHeight ?? 400) * 0.8)

  function onMove(e: MouseEvent): void {
    const deltaY = startY - e.clientY
    const newHeight = Math.min(maxHeight, Math.max(AI_COMMAND_BAR_RESIZE_MIN_PX, startHeight + deltaY))
    aiCommandBarHeightPx.value = newHeight
  }

  function onUp(): void {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    aiCommandBarResizeCleanup = null
  }

  aiCommandBarResizeCleanup = onUp
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

const aiCommandBarHeightStyle = computed(() =>
  aiCommandBarHeightPx.value != null
    ? {
        height: `${aiCommandBarHeightPx.value}px`,
        maxHeight: 'none',
        flex: '0 0 auto',
      }
    : {},
)

function scrollAICommandBarContentToBottom(): void {
  nextTick(() => {
    const el = aiCommandBarContentEl.value
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  })
}

watch(
  [aiCommandBarStreamingReply, () => aiCommandBarMessages.value.length],
  () => {
    if (aiCommandBarVisible.value) {
      scrollAICommandBarContentToBottom()
    }
  },
  { flush: 'post' },
)

function parseAssistantReply(content: string): AIChatMessage {
  const trimmed = content.trimStart()
  const marker = AI_COMMAND_MARKER + '\n'
  if (trimmed.startsWith(marker)) {
    const commandText = trimmed.slice(marker.length).trim().split(/\r?\n/)[0]?.trim() ?? ''
    return {
      role: 'assistant',
      content: commandText,
      isCommand: true,
      commandText: commandText || undefined,
    }
  }
  const markerCrlf = AI_COMMAND_MARKER + '\r\n'
  if (trimmed.startsWith(markerCrlf)) {
    const commandText = trimmed.slice(markerCrlf.length).trim().split(/\r?\n/)[0]?.trim() ?? ''
    return {
      role: 'assistant',
      content: commandText,
      isCommand: true,
      commandText: commandText || undefined,
    }
  }
  return { role: 'assistant', content }
}

function summarizeAIMessagePayloadForLog(
  messages: Array<{ role: string; content: string }>,
): {
  messageCount: number
  roleCounts: Record<string, number>
  totalContentChars: number
} {
  const roleCounts: Record<string, number> = {}
  let totalContentChars = 0
  for (const message of messages) {
    roleCounts[message.role] = (roleCounts[message.role] ?? 0) + 1
    totalContentChars += message.content.length
  }
  return {
    messageCount: messages.length,
    roleCounts,
    totalContentChars,
  }
}

function logAICommandBarDebug(event: string, detail?: Record<string, unknown>): void {
  if (!AI_COMMAND_BAR_DEBUG_LOG_ENABLED) {
    return
  }
  const timestamp = new Date().toISOString()
  if (detail) {
    console.log(`[ai-command-bar][${timestamp}] ${event}`, detail)
    return
  }
  console.log(`[ai-command-bar][${timestamp}] ${event}`)
}

class AIRequestError extends Error {
  code: string | null

  constructor(message: string, code?: string | null) {
    super(message)
    this.name = 'AIRequestError'
    this.code = code ?? null
  }
}

async function sendAIMessagesAndStream(messagesForApi?: AIChatMessage[]): Promise<void> {
  const toSend = messagesForApi ?? aiCommandBarMessages.value
  const requestId = ++aiCommandBarRequestSequence
  const payloadSummary = summarizeAIMessagePayloadForLog(
    toSend.map((item) => ({
      role: item.role,
      content: item.content,
    })),
  )
  logAICommandBarDebug('request-start', {
    requestId,
    ...payloadSummary,
  })
  aiCommandBarLastErrorCode.value = null
  aiCommandBarStreamingReply.value = ''
  aiCommandBarLoading.value = true
  try {
    await askAIAndStreamResponseWithMessages(toSend, (chunk) => {
      aiCommandBarStreamingReply.value += chunk
    }, requestId)
    const assistantMsg = parseAssistantReply(aiCommandBarStreamingReply.value)
    aiCommandBarMessages.value = [...aiCommandBarMessages.value, assistantMsg]
    aiCommandBarStreamingReply.value = ''
    persistAICommandBarHistory()
    logAICommandBarDebug('request-success', {
      requestId,
      responseChars: assistantMsg.content.length,
      isCommand: assistantMsg.role === 'assistant' && Boolean(assistantMsg.isCommand),
    })
  } catch (err) {
    aiCommandBarStreamingReply.value =
      err instanceof Error ? err.message : t('terminal.aiBar.error.default')
    aiCommandBarLastErrorCode.value = err instanceof AIRequestError ? err.code : null
    logAICommandBarDebug('request-failed', {
      requestId,
      errorCode: err instanceof AIRequestError ? err.code : null,
      errorType: err instanceof Error ? err.name : typeof err,
    })
  } finally {
    aiCommandBarLoading.value = false
  }
}

function onAICommandBarEnter(event: KeyboardEvent): void {
  if (event.isComposing) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  void submitAICommandBar()
}

async function submitAICommandBar(): Promise<void> {
  const query = aiCommandBarInput.value.trim()
  if (!query) {
    return
  }
  if (aiCommandBarLoading.value) {
    globalMessage.info(t('terminal.aiBar.busy'), { replace: true })
    logAICommandBarDebug('submit-blocked-loading', { inputChars: query.length })
    return
  }
  if (aiModelTargets.value.length === 0) {
    await loadAIModelTargets()
  }
  const selectedTarget = getCurrentAIModelTarget()
  if (selectedTarget.kind === 'built_in') {
    await maybeLockAIResponseLanguageFromUserInput(query)
    await refreshAIResponseLanguageDebug()
  }
  const userMessage: AIChatMessage = { role: 'user', content: query }
  const recentContext = aiCommandBarMessages.value.slice(-AI_COMMAND_BAR_CONTEXT_RECENT_MESSAGES)
  aiCommandBarMessages.value = [...aiCommandBarMessages.value, userMessage]
  aiCommandBarInput.value = ''
  await sendAIMessagesAndStream([...recentContext, userMessage])
}

function getAICurrentSessionId(): string | null {
  return activeBridgeSessionId ?? props.sessionId
}

async function onAICmdRun(command: string): Promise<void> {
  const sessionId = getAICurrentSessionId()
  if (!sessionId) {
    return
  }
  await writeInputToSession(sessionId, command + '\n')
  closeAICommandBar()
}

async function onAICmdInsert(command: string): Promise<void> {
  const sessionId = getAICurrentSessionId()
  if (!sessionId) {
    return
  }
  await writeInputToSession(sessionId, command)
  closeAICommandBar()
}

function onAICmdExpand(command: string): void {
  if (aiCommandBarLoading.value) {
    globalMessage.info(t('terminal.aiBar.busy'), { replace: true })
    logAICommandBarDebug('expand-blocked-loading', { commandChars: command.length })
    return
  }
  const displayMessage: AIChatMessage = {
    role: 'user',
    content: command,
  }
  const explainApiMessage: AIChatMessage = {
    role: 'user',
    content: `Explain this shell command:
${command}

Output requirements:
1) Explain what the command does, what each key part/argument means, potential risks, and provide one safer example if applicable.`,
  }
  const recentContext = aiCommandBarMessages.value.slice(-AI_COMMAND_BAR_CONTEXT_RECENT_MESSAGES)
  aiCommandBarMessages.value = [...aiCommandBarMessages.value, displayMessage]
  void sendAIMessagesAndStream([...recentContext, explainApiMessage])
}

async function streamSSEContent(
  response: Response,
  onChunk: (chunk: string) => void,
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error(t('terminal.aiBar.error.streamUnavailable'))
  }

  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) {
        continue
      }
      const data = trimmed.slice(6)
      if (data === '[DONE]') {
        continue
      }
      try {
        const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }
        const content = json?.choices?.[0]?.delta?.content
        if (typeof content === 'string') {
          onChunk(content)
        }
      } catch {
        // ignore malformed chunk
      }
    }
  }
  if (buffer.trim()) {
    const trimmed = buffer.trim()
    if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
      try {
        const json = JSON.parse(trimmed.slice(6)) as { choices?: Array<{ delta?: { content?: string } }> }
        const content = json?.choices?.[0]?.delta?.content
        if (typeof content === 'string') {
          onChunk(content)
        }
      } catch {
        // ignore
      }
    }
  }
}

type AIErrorResponsePayload = {
  error?: {
    code?: string
    message?: string
  }
  data?: {
    quota?: {
      limit?: number
    }
    retry_after_seconds?: number
  }
}

async function parseAIErrorResponse(response: Response): Promise<{
  code?: string
  detail: string
  quotaLimit?: number
  retryAfterSeconds?: number
}> {
  const text = await response.text()
  let detail = text || `HTTP ${response.status}`
  let code: string | undefined
  let quotaLimit: number | undefined
  let retryAfterSeconds: number | undefined
  try {
    const payload = JSON.parse(text) as AIErrorResponsePayload
    if (typeof payload?.error?.code === 'string') {
      code = payload.error.code
    }
    if (typeof payload?.error?.message === 'string' && payload.error.message.trim()) {
      detail = payload.error.message.trim()
    }
    const limit = payload?.data?.quota?.limit
    if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
      quotaLimit = limit
    }
    const retryAfter = payload?.data?.retry_after_seconds
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0) {
      retryAfterSeconds = Math.ceil(retryAfter)
    }
  } catch {
    // keep raw text as detail
  }
  if (typeof retryAfterSeconds !== 'number') {
    const retryAfterHeader = response.headers.get('retry-after')
    if (retryAfterHeader) {
      const parsed = Number.parseInt(retryAfterHeader, 10)
      if (Number.isFinite(parsed) && parsed > 0) {
        retryAfterSeconds = parsed
      }
    }
  }
  return { code, detail, quotaLimit, retryAfterSeconds }
}

function buildAIRequestErrorMessage(
  status: number,
  detail: string,
  code?: string,
  quotaLimit?: number,
  retryAfterSeconds?: number,
): string {
  if (code === 'quota_exceeded') {
    if (typeof quotaLimit === 'number') {
      return t('terminal.aiBar.error.quotaExceededWithLimit', { limit: quotaLimit })
    }
    return t('terminal.aiBar.error.quotaExceeded')
  }
  if (code === 'rate_limited') {
    if (typeof retryAfterSeconds === 'number') {
      return t('terminal.aiBar.error.rateLimitedWithRetry', { seconds: retryAfterSeconds })
    }
    return t('terminal.aiBar.error.rateLimited')
  }
  return t('terminal.aiBar.error.requestFailed', {
    status,
    detail,
  })
}

async function requestBuiltInAIStream(
  messages: Array<{ role: string; content: string }>,
  onChunk: (chunk: string) => void,
): Promise<void> {
  const baseUrl = await resolveAIProxyBaseUrl()
  let clientToken = await ensureProxyClientToken(baseUrl)

  async function postOnce(token: string): Promise<Response> {
    return fetch(`${baseUrl}/v1/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model_source: 'built_in',
        messages,
        stream: true,
      }),
    })
  }

  let response = await postOnce(clientToken)
  if (response.status === 401) {
    await setAISettingValue(AI_PROXY_CLIENT_TOKEN_KEY, '')
    clientToken = await ensureProxyClientToken(baseUrl)
    response = await postOnce(clientToken)
  }

  if (!response.ok) {
    const { code, detail, quotaLimit, retryAfterSeconds } = await parseAIErrorResponse(response)
    throw new AIRequestError(
      buildAIRequestErrorMessage(response.status, detail, code, quotaLimit, retryAfterSeconds),
      code,
    )
  }

  await streamSSEContent(response, onChunk)
}

async function requestUserCustomAIStream(
  target: Extract<AIModelTarget, { kind: 'user_custom' }>,
  messages: Array<{ role: string; content: string }>,
  onChunk: (chunk: string) => void,
): Promise<void> {
  const baseUrl = target.apiUrl.trim().replace(/\/$/, '')
  const url = /\/chat\/completions$/i.test(baseUrl)
    ? baseUrl
    : `${baseUrl}/chat/completions`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${target.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: target.model.trim(),
      messages,
      stream: true,
    }),
  })

  if (!response.ok) {
    const { code, detail, quotaLimit, retryAfterSeconds } = await parseAIErrorResponse(response)
    throw new AIRequestError(
      buildAIRequestErrorMessage(response.status, detail, code, quotaLimit, retryAfterSeconds),
      code,
    )
  }

  await streamSSEContent(response, onChunk)
}

async function askAIAndStreamResponseWithMessages(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onChunk: (chunk: string) => void,
  requestId?: number,
): Promise<void> {
  const responseLanguage = await resolveAIResponseLanguage()
  const responseLanguageLabel = resolveAIResponseLanguageLabel(responseLanguage)
  const systemPrompt = `You are a helpful assistant for a terminal user. When the user clearly only needs a single shell command (e.g. "how to list files", "command to do X", "给我一个命令做Y"), reply with exactly two lines:
Line 1: ${AI_COMMAND_MARKER}
Line 2: the command only (no explanation, no markdown, no code block).
Otherwise reply with a full, helpful answer. Do not use ${AI_COMMAND_MARKER} when giving explanations or multi-step instructions.

Rules:
- Always respond in ${responseLanguageLabel}
- Commands and code must remain unchanged
- Keep explanations concise
- Prefer practical solutions`

  const apiMessages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ]
  if (aiModelTargets.value.length === 0) {
    await loadAIModelTargets()
  }
  const selectedTarget = getCurrentAIModelTarget()
  logAICommandBarDebug('api-messages', {
    requestId: requestId ?? null,
    targetId: selectedTarget.id,
    targetKind: selectedTarget.kind,
    targetModel: selectedTarget.model,
    ...summarizeAIMessagePayloadForLog(apiMessages),
  })

  if (selectedTarget.kind === 'built_in') {
    await requestBuiltInAIStream(apiMessages, onChunk)
    return
  }
  await requestUserCustomAIStream(selectedTarget, apiMessages, onChunk)
}

function clearContextSubmenuHideTimer(): void {
  if (!contextSubmenuHideTimer) {
    return
  }
  clearTimeout(contextSubmenuHideTimer)
  contextSubmenuHideTimer = null
}

function clearDelayedCwdRefreshTimer(): void {
  if (delayedCwdRefreshTimer) {
    clearTimeout(delayedCwdRefreshTimer)
    delayedCwdRefreshTimer = null
  }
}

function clearSnapshotPersistTimer(sessionId?: string): void {
  if (sessionId) {
    const timer = snapshotPersistTimerBySession.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      snapshotPersistTimerBySession.delete(sessionId)
    }
    return
  }

  for (const timer of snapshotPersistTimerBySession.values()) {
    clearTimeout(timer)
  }
  snapshotPersistTimerBySession.clear()
}

function clearHistoryPersistTimer(sessionId?: string): void {
  if (sessionId) {
    const timer = historyPersistTimerBySession.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      historyPersistTimerBySession.delete(sessionId)
    }
    return
  }

  for (const timer of historyPersistTimerBySession.values()) {
    clearTimeout(timer)
  }
  historyPersistTimerBySession.clear()
}

function clearDeferredResizeSync(sessionId?: string): void {
  if (sessionId) {
    const timer = deferredResizeSyncTimerBySession.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      deferredResizeSyncTimerBySession.delete(sessionId)
    }
    return
  }

  for (const timer of deferredResizeSyncTimerBySession.values()) {
    clearTimeout(timer)
  }
  deferredResizeSyncTimerBySession.clear()
}

function scheduleDeferredResizeSync(sessionId: string, delayMs: number): void {
  clearDeferredResizeSync(sessionId)
  const timer = setTimeout(() => {
    deferredResizeSyncTimerBySession.delete(sessionId)
    if (lifecycleDisposed || activeBridgeSessionId !== sessionId) {
      return
    }

    logSplitDebug('deferred resize sync', {
      sessionId,
      delayMs,
    })
    scheduleResizeSyncToBridge({ immediate: true })
  }, delayMs)
  deferredResizeSyncTimerBySession.set(sessionId, timer)
}

let resizeSyncTimer: ReturnType<typeof setTimeout> | null = null

function clearResizeSyncScheduler(): void {
  if (resizeSyncTimer) {
    clearTimeout(resizeSyncTimer)
    resizeSyncTimer = null
  }
}

function scheduleResizeSyncToBridge(options?: { immediate?: boolean }): void {
  if (options?.immediate) {
    clearResizeSyncScheduler()
    void syncResizeToBridge()
    return
  }

  if (resizeSyncTimer) {
    clearTimeout(resizeSyncTimer)
    resizeSyncTimer = null
  }

  resizeSyncTimer = setTimeout(() => {
    resizeSyncTimer = null
    void syncResizeToBridge()
  }, RESIZE_SYNC_INTERVAL_MS)
}

function isTerminalHostVisible(): boolean {
  const host = mountEl.value
  if (!host) {
    return false
  }

  if (host.clientWidth <= 0 || host.clientHeight <= 0) {
    return false
  }

  return host.getClientRects().length > 0
}

function scheduleDelayedCwdRefresh(delayMs = 220): void {
  const sessionId = activeBridgeSessionId
  if (!sessionId) {
    return
  }

  if (isSessionInSshShell(sessionId)) {
    logSplitDebug('cwd refresh skipped for ssh shell session', { sessionId, delayMs })
    return
  }

  clearDelayedCwdRefreshTimer()
  delayedCwdRefreshTimer = setTimeout(() => {
    delayedCwdRefreshTimer = null
    void sessionPathSync.refreshCwd(sessionId)
  }, delayMs)
}

function isLikelyLocalOnlyPathForRemote(path: string | null | undefined): boolean {
  const normalized = normalizeSessionCwdValue(path)
  if (!normalized) {
    return false
  }

  if (normalized.startsWith('//')) {
    return true
  }

  if (/^[A-Za-z]:[\\/]/.test(normalized)) {
    return true
  }

  return (
    normalized.startsWith('/Users/') ||
    normalized.startsWith('/Volumes/') ||
    normalized.startsWith('/private/var/')
  )
}

function stripAnsiEscapeSequences(data: string): string {
  return data
    .replace(/\x1b\][^\u0007]*(?:\u0007|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
}

function toTerminalDebugPlainText(data: string): string {
  return stripAnsiEscapeSequences(data).replace(/\r/g, '\n')
}

function shouldShowTerminalDebugHintForChunk(chunk: string): boolean {
  const plain = toTerminalDebugPlainText(chunk)
  if (!plain.trim()) {
    return false
  }
  return TERMINAL_DEBUG_HINT_PATTERNS.some((pattern) => pattern.test(plain))
}

function pickTerminalDebugOutputLine(context: string): string {
  const lines = context
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (!lines.length) {
    return ''
  }
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (TERMINAL_DEBUG_HINT_PATTERNS.some((pattern) => pattern.test(line))) {
      return line
    }
  }
  return lines[lines.length - 1]
}

function resolveLatestSessionCommand(sessionId: string): string {
  const history = sessionCommandHistory.get(sessionId) ?? []
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const command = history[index]?.trim()
    if (command) {
      return command
    }
  }
  return ''
}

function buildTerminalDebugContext(sessionId: string, fallbackChunk: string): string {
  const transcript = sessionCache.getTranscript(sessionId)
  const source = transcript
    ? transcript.slice(-TERMINAL_DEBUG_CONTEXT_MAX_CHARS)
    : fallbackChunk
  const lines = toTerminalDebugPlainText(source)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
  if (!lines.length) {
    return ''
  }
  return lines.slice(-TERMINAL_DEBUG_CONTEXT_MAX_LINES).join('\n')
}

function dismissTerminalDebugHint(): void {
  terminalDebugHintVisible.value = false
}

function maybeShowTerminalDebugHint(sessionId: string, chunk: string): void {
  if (!shouldShowTerminalDebugHintForChunk(chunk)) {
    return
  }
  if (aiCommandBarVisible.value) {
    return
  }

  const now = Date.now()
  const lastAt = lastTerminalDebugHintAtBySession.get(sessionId) ?? 0
  if (now - lastAt < TERMINAL_DEBUG_HINT_COOLDOWN_MS) {
    return
  }

  const context = buildTerminalDebugContext(sessionId, chunk)
  if (!context) {
    return
  }
  lastTerminalDebugHintAtBySession.set(sessionId, now)
  terminalDebugHintSessionId.value = sessionId
  terminalDebugHintContext.value = context
  terminalDebugHintVisible.value = true
}

async function onDebugWithNovar(): Promise<void> {
  const sessionId = terminalDebugHintSessionId.value.trim()
  const context = terminalDebugHintContext.value.trim()
  if (!sessionId || !context) {
    dismissTerminalDebugHint()
    return
  }
  if (aiCommandBarLoading.value) {
    globalMessage.info(t('terminal.aiBar.busy'), { replace: true })
    return
  }

  await ensureAICommandBarReady()
  const latestCommand = resolveLatestSessionCommand(sessionId)
  const outputLine = pickTerminalDebugOutputLine(context)
  const displayMessage: AIChatMessage = {
    role: 'user',
    content: t('terminal.debugHint.userMessage'),
    displayCard: {
      title: t('terminal.debugHint.userMessage'),
      sections: [
        {
          label: t('terminal.debugHint.terminalOutput'),
          value: outputLine || t('terminal.debugHint.noOutput'),
        },
        {
          label: t('terminal.debugHint.command'),
          value: latestCommand || t('terminal.debugHint.noCommand'),
        },
      ],
    },
  }
  const debugApiMessage: AIChatMessage = {
    role: 'user',
    content: `Debug this terminal output:
${context}

Last executed command (if available):
${latestCommand || '(unknown)'}

Output requirements:
1) Identify the most likely root causes (ranked by likelihood).
2) Provide concrete troubleshooting steps and executable commands.
3) Mark risky commands and give safer alternatives when possible.
4) If information is insufficient, list exactly which command/output is needed next.`,
  }
  const recentContext = aiCommandBarMessages.value.slice(-AI_COMMAND_BAR_CONTEXT_RECENT_MESSAGES)
  aiCommandBarMessages.value = [...aiCommandBarMessages.value, displayMessage]
  dismissTerminalDebugHint()
  await sendAIMessagesAndStream([...recentContext, debugApiMessage])
}

function sanitizeTerminalChunkForPromptAnalysis(chunk: string): string {
  const withoutOsc = chunk.replace(/\x1b\][^\u0007]*(?:\u0007|\x1b\\)/g, '')
  return stripAnsiEscapeSequences(withoutOsc).replace(/\r/g, '')
}

function isLikelyLocalPromptLine(line: string): boolean {
  const value = line.trim()
  if (!value) {
    return true
  }

  if (/^[▶$#%>]+$/.test(value)) {
    return true
  }

  if (/^(~|\/)[\w\-./~:@[\]]*$/.test(value)) {
    return true
  }

  if (/^[\w.-]+@[\w.-]+:((~|\/)[^\s]*)?\s*[#$%>]?$/.test(value)) {
    return true
  }

  if (/^\[[^\]\r\n]*@[^\]\s\r\n]+(?::|\s+)((~|\/)[^\]\r\n]*)\]\s*[#$%>]$/.test(value)) {
    return true
  }

  return false
}

function extractLocalPromptLikeLines(chunk: string): string[] | null {
  const sanitized = sanitizeTerminalChunkForPromptAnalysis(chunk).trim()
  if (!sanitized) {
    return []
  }

  if (sanitized.length > 240) {
    return null
  }

  const lines = sanitized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (!lines.length || lines.length > 4) {
    return null
  }

  const tail = lines[lines.length - 1]
  if (!/[▶$#%>]$/.test(tail)) {
    return null
  }

  if (!lines.every((line) => isLikelyLocalPromptLine(line))) {
    return null
  }

  return lines
}

function hasVisibleTextAfterAnsiStripped(chunk: string): boolean {
  const visible = stripAnsiEscapeSequences(chunk).replace(/[\r\n\t ]+/g, '')
  return visible.length > 0
}

function looksLikeResizeRedrawControlChunk(chunk: string): boolean {
  if (!chunk) {
    return false
  }

  if (!/[\x1b\r]/.test(chunk)) {
    return false
  }

  // Resize-induced prompt redraws usually contain cursor movement/erase controls.
  return /\x1b\[[0-?]*[ -/]*[@-~]/.test(chunk)
}

function shouldSkipResizePromptRedraw(sessionId: string, chunk: string): boolean {
  if (!chunk || serverState.getSessionBoundServer(sessionId)) {
    return false
  }

  const now = Date.now()
  const lastResizeAt = lastResizeSyncAtBySession.get(sessionId) ?? 0
  const elapsedSinceResizeMs = lastResizeAt ? now - lastResizeAt : null
  if (!lastResizeAt || (elapsedSinceResizeMs ?? RESIZE_PROMPT_REDRAW_WINDOW_MS + 1) > RESIZE_PROMPT_REDRAW_WINDOW_MS) {
    return false
  }

  const chunkLines = extractLocalPromptLikeLines(chunk)
  if (chunkLines && !chunkLines.length) {
    logRedrawDebug('skip resize redraw', {
      sessionId,
      reason: 'empty-prompt-like-chunk',
      elapsedSinceResizeMs,
      chunkSize: chunk.length,
      chunkPreview: formatShellOutputChunk(chunk).slice(0, 220),
    })
    return true
  }

  if (!chunkLines || !chunkLines.length) {
    if (looksLikeResizeRedrawControlChunk(chunk) && !hasVisibleTextAfterAnsiStripped(chunk)) {
      logRedrawDebug('skip resize redraw', {
        sessionId,
        reason: 'control-only-without-visible-text',
        elapsedSinceResizeMs,
        chunkSize: chunk.length,
        chunkPreview: formatShellOutputChunk(chunk).slice(0, 220),
      })
      return true
    }
    logRedrawDebug('keep chunk', {
      sessionId,
      reason: 'not-prompt-like',
      elapsedSinceResizeMs,
      chunkSize: chunk.length,
      chunkPreview: formatShellOutputChunk(chunk).slice(0, 220),
    })
    return false
  }

  const transcriptTailLines = sanitizeTerminalChunkForPromptAnalysis(sessionCache.getTranscript(sessionId).slice(-2048))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (transcriptTailLines.length < chunkLines.length) {
    return false
  }

  const recentLines = transcriptTailLines.slice(-chunkLines.length)
  if (recentLines.every((line, index) => line === chunkLines[index])) {
    logRedrawDebug('skip resize redraw', {
      sessionId,
      reason: 'prompt-lines-exactly-match-tail',
      elapsedSinceResizeMs,
      chunkLines,
    })
    return true
  }

  // Some shells redraw prompt lines with tiny formatting differences after resize.
  // If this block is entirely prompt-like and arrives right after resize, ignore it.
  const isPromptLikeRedraw = chunkLines.length <= 4 && chunkLines.every((line) => isLikelyLocalPromptLine(line))
  logRedrawDebug(isPromptLikeRedraw ? 'skip resize redraw' : 'keep chunk', {
    sessionId,
    reason: isPromptLikeRedraw ? 'prompt-like-in-resize-window' : 'prompt-like-but-not-redraw',
    elapsedSinceResizeMs,
    chunkLines,
    transcriptTailLines: transcriptTailLines.slice(-8),
  })
  return isPromptLikeRedraw
}

function parseLatestOsc7Path(data: string): string | null {
  if (!data) {
    return null
  }

  const osc7Pattern = /\x1b\]7;([^\u0007\x1b]*)(?:\u0007|\x1b\\)/g
  let lastPayload: string | null = null
  let match = osc7Pattern.exec(data)
  while (match) {
    if (typeof match[1] === 'string' && match[1].trim()) {
      lastPayload = match[1].trim()
    }
    match = osc7Pattern.exec(data)
  }

  if (!lastPayload) {
    return null
  }

  try {
    const url = new URL(lastPayload)
    if (url.protocol !== 'file:') {
      return null
    }

    let pathname = decodeURIComponent(url.pathname || '')
    if (!pathname) {
      return null
    }

    if (/^\/[A-Za-z]:\//.test(pathname)) {
      pathname = pathname.slice(1)
    }

    if (url.host && url.host !== 'localhost' && url.host !== '127.0.0.1') {
      pathname = `//${url.host}${pathname}`
    }

    return pathname.trim() || null
  } catch {
    return null
  }
}

function normalizePromptCwd(path: string): string | null {
  const normalized = path.trim()
  if (!normalized) {
    return null
  }

  if (normalized === '~' || normalized.startsWith('~/') || normalized.startsWith('/')) {
    return normalized
  }

  return null
}

function normalizeLocalHostPrefixedPath(path: string | null | undefined): string | null {
  const normalized = normalizeSessionCwdValue(path)
  if (!normalized) {
    return null
  }

  if (!normalized.startsWith('//')) {
    return normalized
  }

  const match = normalized.match(/^\/\/[^/]+(\/.*)$/)
  if (!match?.[1]) {
    return normalized
  }

  const stripped = match[1].trim()
  if (!stripped.startsWith('/')) {
    return normalized
  }

  return stripped
}

function parseStandalonePromptPathLine(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('/')) {
    return normalizePromptCwd(trimmed)
  }

  if (!trimmed.includes('/')) {
    return null
  }

  if (/\s/.test(trimmed)) {
    return null
  }

  if (!/^[\w./~-]+$/.test(trimmed)) {
    return null
  }

  return normalizePromptCwd(`~/${trimmed.replace(/^\/+/, '')}`)
}

function looksLikeShellPrompt(line: string): boolean {
  const trimmed = line.trimEnd()
  return /[#$%>]$/.test(trimmed)
}

function parseCwdFromPromptLine(line: string): string | null {
  const trimmedLine = line.trimEnd()
  if (!trimmedLine || !looksLikeShellPrompt(trimmedLine)) {
    return null
  }

  const userHostPromptMatch = trimmedLine.match(
    /(?:^|\s)[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:((?:~|\/)[^\s]*)\s*[#$%>]$/
  )
  if (userHostPromptMatch?.[1]) {
    return normalizePromptCwd(userHostPromptMatch[1])
  }

  const bracketPromptMatch = trimmedLine.match(
    /\[[^\]\r\n]*@[^\]\s\r\n]+\s+((?:~|\/)[^\]\r\n]+)\]\s*[#$%>]$/
  )
  if (bracketPromptMatch?.[1]) {
    return normalizePromptCwd(bracketPromptMatch[1])
  }

  const bracketColonPromptMatch = trimmedLine.match(
    /\[[^\]\r\n]*@[^\]:\s\r\n]+:((?:~|\/)[^\]\r\n]+)\]\s*[#$%>]$/
  )
  if (bracketColonPromptMatch?.[1]) {
    return normalizePromptCwd(bracketColonPromptMatch[1])
  }

  // Fallback: pick the last path-like token before prompt marker.
  const fallbackCandidates = trimmedLine.match(/(?:~|\/)[^\s#$%>]+/g)
  if (fallbackCandidates?.length) {
    const fallback = fallbackCandidates[fallbackCandidates.length - 1]
    return normalizePromptCwd(fallback)
  }

  return null
}

function resolvePromptContextCwd(lines: string[]): string | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const currentLine = lines[index] ?? ''
    const inlineParsed = parseCwdFromPromptLine(currentLine)
    if (inlineParsed) {
      return inlineParsed
    }

    if (!looksLikeShellPrompt(currentLine.trimEnd())) {
      continue
    }

    for (let probe = index - 1; probe >= Math.max(0, index - 3); probe -= 1) {
      const candidate = lines[probe]?.trim()
      if (!candidate) {
        continue
      }

      const standaloneParsed = parseStandalonePromptPathLine(candidate)
      if (standaloneParsed) {
        return standaloneParsed
      }

      break
    }
  }

  return null
}

function updateCwdHintFromTerminalData(sessionId: string, data: string): { hinted: boolean; promptDetected: boolean } {
  const osc7Path = parseLatestOsc7Path(data)
  if (osc7Path) {
    sessionPathSync.hintCwd(sessionId, osc7Path)
    return { hinted: true, promptDetected: true }
  }

  const sanitized = stripAnsiEscapeSequences(data).replace(/\r/g, '\n')
  if (!sanitized) {
    return { hinted: false, promptDetected: false }
  }

  const previousBuffer = sessionPromptBuffer.get(sessionId) ?? ''
  const mergedBuffer = `${previousBuffer}${sanitized}`.slice(-PROMPT_BUFFER_LIMIT * 2)
  const lines = mergedBuffer.split('\n')
  const trailingLine = lines.pop() ?? ''
  const candidates = [...lines, trailingLine]
  const promptDetected = candidates.some((line) => looksLikeShellPrompt(line))

  const hintedCwd = resolvePromptContextCwd(candidates)

  sessionPromptBuffer.set(sessionId, trailingLine.slice(-PROMPT_BUFFER_LIMIT))
  if (!hintedCwd) {
    return { hinted: false, promptDetected }
  }

  sessionPathSync.hintCwd(sessionId, hintedCwd)
  return { hinted: true, promptDetected: true }
}

function resolvePromptCwdHintFromTranscript(sessionId: string): string | null {
  const transcript = sessionCache.getTranscript(sessionId)
  if (!transcript) {
    return null
  }

  const sanitized = stripAnsiEscapeSequences(transcript.slice(-PROMPT_BUFFER_LIMIT * 16)).replace(/\r/g, '\n')
  if (!sanitized.trim()) {
    return null
  }

  const lines = sanitized.split('\n')
  return resolvePromptContextCwd(lines)
}

function clearSplitInheritedCwdSettleTimer(sessionId?: string): void {
  if (sessionId) {
    const timer = splitInheritedCwdSettleTimerBySession.get(sessionId)
    if (!timer) {
      return
    }
    clearTimeout(timer)
    splitInheritedCwdSettleTimerBySession.delete(sessionId)
    return
  }

  for (const timer of splitInheritedCwdSettleTimerBySession.values()) {
    clearTimeout(timer)
  }
  splitInheritedCwdSettleTimerBySession.clear()
}

function clearSplitInheritedCwd(sessionId?: string): void {
  if (sessionId) {
    clearSplitInheritedCwdSettleTimer(sessionId)
    splitInheritedCwdApplyingBySession.delete(sessionId)
    splitCwdInheritState.clearPending(sessionId)
    return
  }

  clearSplitInheritedCwdSettleTimer()
  splitInheritedCwdApplyingBySession.clear()
  splitCwdInheritState.clearAllPending()
}

function buildTriggerSessionRuleKey(sessionId: string, ruleId: string): string {
  return `${sessionId}::${ruleId}`
}

function clearTerminalTriggerRuntimeState(sessionId?: string): void {
  if (sessionId) {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) {
      return
    }

    triggerMatchTailBySession.delete(normalizedSessionId)
    for (const key of Array.from(triggerRuleArmedBySession.keys())) {
      if (key.startsWith(`${normalizedSessionId}::`)) {
        triggerRuleArmedBySession.delete(key)
      }
    }
    for (const key of Array.from(triggerLastFiredAtBySessionRule.keys())) {
      if (key.startsWith(`${normalizedSessionId}::`)) {
        triggerLastFiredAtBySessionRule.delete(key)
      }
    }
    return
  }

  triggerMatchTailBySession.clear()
  triggerRuleArmedBySession.clear()
  triggerLastFiredAtBySessionRule.clear()
}

function resolveTriggerTailLength(): number {
  let maxPatternLength = 0
  for (const rule of triggerState.rules.value) {
    if (!rule.enabled) {
      continue
    }
    const pattern = rule.pattern
    if (!pattern) {
      continue
    }
    if (pattern.length > maxPatternLength) {
      maxPatternLength = pattern.length
    }
  }

  const target = Math.max(TRIGGER_MATCH_MIN_TAIL, maxPatternLength * 2)
  return Math.min(TRIGGER_MATCH_TAIL_MAX, target)
}

function normalizeTriggerMatchText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeTriggerComparableText(value: string): string {
  return normalizeTriggerMatchText(value)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
}

function stripSimpleQuotes(value: string): string {
  return value.replace(/['"]/g, '')
}

function decodeTriggerSendText(value: string): string {
  return value
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
}

function resolveTriggerSendPayload(pattern: string, sendText: string): string {
  const decoded = decodeTriggerSendText(sendText)
  if (!decoded) {
    return ''
  }

  if (/[\r\n]$/.test(decoded)) {
    return decoded
  }

  // Prompt-like patterns (ending with ":") usually require Enter to submit.
  if (/:\s*$/.test(pattern)) {
    return `${decoded}\n`
  }

  return decoded
}

type AutomatedInputSource = 'user-trigger'

async function sendAutomatedInput(
  sessionId: string,
  payload: string,
  meta: {
    source: AutomatedInputSource
    ruleId?: string
    pattern?: string
    label?: string
  },
): Promise<boolean> {
  logTriggerDebug('auto-input sending', {
    sessionId,
    source: meta.source,
    ruleId: meta.ruleId ?? null,
    pattern: meta.pattern ?? null,
    label: meta.label ?? null,
    payloadLength: payload.length,
    payloadPreview: formatShellOutputChunk(payload).slice(0, 80),
  })

  const written = await writeInputToSession(sessionId, payload, {
    trackHistory: false,
    reportUnavailable: false,
  })
  if (!written) {
    logTriggerDebug('auto-input send failed', {
      sessionId,
      source: meta.source,
      ruleId: meta.ruleId ?? null,
      label: meta.label ?? null,
    })
    return false
  }

  logTriggerDebug('auto-input sent', {
    sessionId,
    source: meta.source,
    ruleId: meta.ruleId ?? null,
    label: meta.label ?? null,
  })
  return true
}

async function maybeRunTerminalTriggers(sessionId: string, chunk: string): Promise<void> {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId || !chunk) {
    return
  }

  const strippedChunk = stripAnsiEscapeSequences(chunk).replace(/\r/g, '\n')
  if (!strippedChunk) {
    return
  }

  const previousTail = triggerMatchTailBySession.get(normalizedSessionId) ?? ''
  const matchWindow = `${previousTail}${strippedChunk}`
  const normalizedMatchWindow = normalizeTriggerMatchText(matchWindow)
  const comparableMatchWindow = normalizeTriggerComparableText(matchWindow)
  const comparableMatchWindowNoQuotes = stripSimpleQuotes(comparableMatchWindow)

  const enabledRules = triggerState.rules.value.filter(
    (rule) =>
      rule.enabled &&
      rule.autoSend &&
      normalizeTriggerMatchText(rule.pattern).length > 0 &&
      rule.sendText.length > 0,
  )
  if (!enabledRules.length) {
    const ruleDebug = triggerState.rules.value.map((rule) => ({
      id: rule.id,
      enabled: rule.enabled,
      autoSend: rule.autoSend,
      patternLength: normalizeTriggerMatchText(rule.pattern).length,
      sendLength: rule.sendText.length,
      patternPreview: normalizeTriggerMatchText(rule.pattern).slice(0, 60),
      sendPreview: formatShellOutputChunk(rule.sendText).slice(0, 30),
    }))
    logTriggerDebug('no enabled rules', {
      sessionId: normalizedSessionId,
      totalRules: triggerState.rules.value.length,
      rules: ruleDebug,
    })
    return
  }

  logTriggerDebug('chunk received', {
    sessionId: normalizedSessionId,
    chunkSize: chunk.length,
    strippedSize: strippedChunk.length,
    enabledRuleCount: enabledRules.length,
    preview: formatShellOutputChunk(strippedChunk).slice(0, 180),
  })

  const tailLength = resolveTriggerTailLength()
  triggerMatchTailBySession.set(normalizedSessionId, matchWindow.slice(-tailLength))

  let matchedRuleCount = 0
  for (const rule of triggerState.rules.value) {
    const key = buildTriggerSessionRuleKey(normalizedSessionId, rule.id)
    const rawPattern = rule.pattern
    const normalizedPattern = normalizeTriggerMatchText(rawPattern)
    const comparablePattern = normalizeTriggerComparableText(rawPattern)
    const comparablePatternNoQuotes = stripSimpleQuotes(comparablePattern)
    if (!rule.enabled || !rule.autoSend || !normalizedPattern || !rule.sendText) {
      triggerRuleArmedBySession.set(key, true)
      continue
    }

    const matchRaw = matchWindow.includes(rawPattern)
    const matchTrimmed = matchWindow.includes(rawPattern.trim())
    const matchNormalized = normalizedMatchWindow.includes(normalizedPattern)
    const matchComparable = comparableMatchWindow.includes(comparablePattern)
    const matchNoQuotes = comparableMatchWindowNoQuotes.includes(comparablePatternNoQuotes)
    const hasMatch = matchRaw || matchTrimmed || matchNormalized || matchComparable || matchNoQuotes

    logTriggerDebug('rule inspect', {
      sessionId: normalizedSessionId,
      ruleId: rule.id,
      enabled: rule.enabled,
      autoSend: rule.autoSend,
      pattern: rawPattern,
      normalizedPattern,
      sendLength: rule.sendText.length,
      windowPreview: formatShellOutputChunk(matchWindow.slice(-220)),
      normalizedWindowPreview: normalizedMatchWindow.slice(-220),
      comparableWindowPreview: comparableMatchWindow.slice(-220),
      matchRaw,
      matchTrimmed,
      matchNormalized,
      matchComparable,
      matchNoQuotes,
      hasMatch,
    })

    if (!hasMatch) {
      triggerRuleArmedBySession.set(key, true)
      continue
    }
    matchedRuleCount += 1
    logTriggerDebug('rule matched', {
      sessionId: normalizedSessionId,
      ruleId: rule.id,
      pattern: rawPattern,
      sendLength: rule.sendText.length,
    })

    if (triggerRuleArmedBySession.get(key) === false) {
      const lastFiredAt = triggerLastFiredAtBySessionRule.get(key) ?? 0
      const elapsedMs = lastFiredAt > 0 ? Date.now() - lastFiredAt : null
      logTriggerDebug('rule skipped (already armed=false)', {
        sessionId: normalizedSessionId,
        ruleId: rule.id,
        lastFiredAt: lastFiredAt || null,
        elapsedMs,
      })
      continue
    }

    const now = Date.now()
    const lastFiredAt = triggerLastFiredAtBySessionRule.get(key) ?? 0
    if (now - lastFiredAt < TRIGGER_FIRE_COOLDOWN_MS) {
      logTriggerDebug('rule skipped (cooldown)', {
        sessionId: normalizedSessionId,
        ruleId: rule.id,
        elapsedMs: now - lastFiredAt,
        cooldownMs: TRIGGER_FIRE_COOLDOWN_MS,
      })
      continue
    }

    const payload = resolveTriggerSendPayload(normalizedPattern, rule.sendText)
    if (!payload) {
      logTriggerDebug('rule skipped (empty payload)', {
        sessionId: normalizedSessionId,
        ruleId: rule.id,
      })
      continue
    }

    const written = await sendAutomatedInput(normalizedSessionId, payload, {
      source: 'user-trigger',
      ruleId: rule.id,
      pattern: rawPattern,
      label: 'user-rule',
    })
    if (!written) {
      continue
    }

    triggerLastFiredAtBySessionRule.set(key, now)
    triggerRuleArmedBySession.set(key, false)
    logTriggerDebug('rule sent successfully', {
      sessionId: normalizedSessionId,
      ruleId: rule.id,
      at: now,
    })
  }

  if (matchedRuleCount === 0) {
    logTriggerDebug('chunk no rule matched', {
      sessionId: normalizedSessionId,
      enabledRuleCount: enabledRules.length,
    })
  }
}

function looksLikeSshCommand(command: string): boolean {
  const tokens = tokenizeShellCommand(command.trim())
  if (!tokens.length) {
    return false
  }

  return resolveSshExecutableTokenIndex(tokens) >= 0
}

const SSH_OPTIONS_REQUIRE_VALUE = new Set<string>([
  '-b',
  '-c',
  '-D',
  '-E',
  '-e',
  '-F',
  '-I',
  '-i',
  '-J',
  '-L',
  '-l',
  '-m',
  '-O',
  '-o',
  '-p',
  '-Q',
  '-R',
  '-S',
  '-W',
  '-w',
])

const SSH_COMMAND_WRAPPER_TOKENS = new Set<string>([
  'command',
  'doas',
  'env',
  'exec',
  'nohup',
  'proxychains',
  'proxychains4',
  'sshpass',
  'stdbuf',
  'sudo',
  'time',
])

const SSH_WRAPPER_OPTIONS_REQUIRE_VALUE_BY_COMMAND: Record<string, Set<string>> = {
  doas: new Set(['-u', '-C']),
  env: new Set(['-u']),
  sshpass: new Set(['-p', '-P', '-f', '-d']),
  stdbuf: new Set(['-i', '-o', '-e']),
  sudo: new Set(['-u', '-g', '-h', '-p', '-r', '-t']),
}

function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const char of command) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === '\\') {
      escaping = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}

function isShellCommandSeparatorToken(token: string): boolean {
  return token === '|' || token === '||' || token === ';' || token === '&&'
}

function isEnvironmentAssignmentToken(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)
}

function normalizeExecutableToken(token: string): string {
  const normalized = token.trim()
  if (!normalized) {
    return ''
  }

  const slashIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  const executable = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized
  return executable.toLowerCase()
}

function resolveWrapperOptionValueMode(
  wrapperCommand: string | null,
  optionToken: string,
): { needsValue: boolean; hasInlineValue: boolean } {
  const normalizedOption = optionToken.toLowerCase()
  if (!normalizedOption.startsWith('-')) {
    return {
      needsValue: false,
      hasInlineValue: false,
    }
  }

  const wrapperOptions = wrapperCommand ? SSH_WRAPPER_OPTIONS_REQUIRE_VALUE_BY_COMMAND[wrapperCommand] : undefined
  if (!wrapperOptions || wrapperOptions.size === 0) {
    return {
      needsValue: false,
      hasInlineValue: false,
    }
  }

  if (wrapperOptions.has(normalizedOption)) {
    return {
      needsValue: true,
      hasInlineValue: normalizedOption.startsWith('--') ? normalizedOption.includes('=') : false,
    }
  }

  for (const expectedOption of wrapperOptions) {
    if (expectedOption.startsWith('--')) {
      continue
    }
    if (normalizedOption.startsWith(expectedOption) && normalizedOption.length > expectedOption.length) {
      return {
        needsValue: true,
        hasInlineValue: true,
      }
    }
  }

  return {
    needsValue: false,
    hasInlineValue: false,
  }
}

function resolveSshExecutableTokenIndex(tokens: string[]): number {
  let index = 0
  let activeWrapper: string | null = null

  while (index < tokens.length) {
    const token = tokens[index]
    if (!token) {
      index += 1
      continue
    }

    if (isShellCommandSeparatorToken(token)) {
      return -1
    }

    if (token === '--') {
      activeWrapper = null
      index += 1
      continue
    }

    if (isEnvironmentAssignmentToken(token)) {
      index += 1
      continue
    }

    const executable = normalizeExecutableToken(token)
    if (executable === 'ssh') {
      return index
    }

    if (SSH_COMMAND_WRAPPER_TOKENS.has(executable)) {
      activeWrapper = executable
      index += 1
      continue
    }

    if (token.startsWith('-')) {
      const optionMode = resolveWrapperOptionValueMode(activeWrapper, token)
      index += 1
      if (optionMode.needsValue && !optionMode.hasInlineValue && index < tokens.length) {
        const nextToken = tokens[index]
        if (nextToken !== '--' && !nextToken.startsWith('-') && !isShellCommandSeparatorToken(nextToken)) {
          index += 1
        }
      }
      continue
    }

    return -1
  }

  return -1
}

function parseSshHostFromCommand(command: string): string | null {
  const tokens = tokenizeShellCommand(command.trim())
  if (!tokens.length) {
    return null
  }

  const sshTokenIndex = resolveSshExecutableTokenIndex(tokens)
  if (sshTokenIndex < 0) {
    return null
  }

  let index = sshTokenIndex + 1

  let expectOptionValue = false
  let destination: string | null = null

  for (; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (expectOptionValue) {
      expectOptionValue = false
      continue
    }

    if (token === '--') {
      if (index + 1 < tokens.length) {
        destination = tokens[index + 1]
      }
      break
    }

    if (token.startsWith('-') && token.length > 1) {
      if (SSH_OPTIONS_REQUIRE_VALUE.has(token)) {
        expectOptionValue = true
      }
      continue
    }

    destination = token
    break
  }

  if (!destination) {
    return null
  }

  const atIndex = destination.lastIndexOf('@')
  let host = atIndex >= 0 ? destination.slice(atIndex + 1) : destination
  host = host.trim()
  if (!host) {
    return null
  }

  if (host.startsWith('[') && host.endsWith(']') && host.length > 2) {
    host = host.slice(1, -1)
  }

  host = host.replace(/[.,;:]+$/, '')
  return host || null
}

function normalizeHostToken(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, '')
}

function getRemoteHostStack(sessionId: string): string[] {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) {
    return []
  }

  const existing = remoteHostStackBySession.get(normalizedSessionId)
  if (existing) {
    return existing
  }

  const seeded: string[] = []
  const session = workspace.sessions.value.find((item) => item.id === normalizedSessionId)
  const seededHost = session?.sshHost?.trim() ?? ''
  if (seededHost) {
    seeded.push(seededHost)
  }
  remoteHostStackBySession.set(normalizedSessionId, seeded)
  return seeded
}

function syncSessionSshHostLabel(sessionId: string): void {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId || !isTerminalSession(normalizedSessionId)) {
    return
  }

  const stack = getRemoteHostStack(normalizedSessionId)
  const nextHost = stack.length ? stack[stack.length - 1] : null
  const session = workspace.sessions.value.find((item) => item.id === normalizedSessionId)
  if (!session) {
    return
  }

  const currentHost = session.sshHost?.trim() ?? null
  if ((currentHost ?? null) === (nextHost ?? null)) {
    return
  }

  workspace.updateSession(normalizedSessionId, {
    sshHost: nextHost,
  })
}

function pushRemoteHost(sessionId: string, host: string): boolean {
  const normalizedSessionId = sessionId.trim()
  const normalizedHost = host.trim()
  if (!normalizedSessionId || !normalizedHost || !isTerminalSession(normalizedSessionId)) {
    return false
  }

  const stack = getRemoteHostStack(normalizedSessionId)
  const topHost = stack.length ? stack[stack.length - 1] : null
  if (topHost && normalizeHostToken(topHost) === normalizeHostToken(normalizedHost)) {
    syncSessionSshHostLabel(normalizedSessionId)
    return false
  }

  stack.push(normalizedHost)
  syncSessionSshHostLabel(normalizedSessionId)
  return true
}

function popRemoteHost(sessionId: string, expectedHost?: string): void {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId || !isTerminalSession(normalizedSessionId)) {
    return
  }

  const stack = getRemoteHostStack(normalizedSessionId)
  if (!stack.length) {
    syncSessionSshHostLabel(normalizedSessionId)
    return
  }

  const expected = expectedHost?.trim() ?? ''
  if (!expected) {
    stack.pop()
    syncSessionSshHostLabel(normalizedSessionId)
    return
  }

  const normalizedExpected = normalizeHostToken(expected)
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (normalizeHostToken(stack[index]) === normalizedExpected) {
      stack.splice(index, 1)
      break
    }
  }
  syncSessionSshHostLabel(normalizedSessionId)
}

function clearRemoteHostState(sessionId: string): void {
  remoteHostStackBySession.delete(sessionId)
  if (!isTerminalSession(sessionId)) {
    return
  }

  workspace.updateSession(sessionId, {
    sshHost: null,
  })
}

function detectSshDisconnectHostFromOutput(chunk: string): string | null {
  const plain = stripAnsiEscapeSequences(chunk).replace(/\r/g, '\n')
  if (!plain) {
    return null
  }

  const connectionClosedMatch = plain.match(/connection to ([^\s]+) closed\./i)
  if (connectionClosedMatch?.[1]) {
    return connectionClosedMatch[1].trim()
  }

  const connectionClosedByMatch = plain.match(/connection closed by ([^\s]+)/i)
  if (connectionClosedByMatch?.[1]) {
    return connectionClosedByMatch[1].trim()
  }

  const connectionResetByMatch = plain.match(/connection reset by ([^\s]+)/i)
  if (connectionResetByMatch?.[1]) {
    return connectionResetByMatch[1].trim()
  }

  return null
}

function inferSshHostFromTranscript(sessionId: string): string | null {
  const transcript = sessionCache.getTranscript(sessionId)
  if (!transcript) {
    return null
  }

  const sanitized = stripAnsiEscapeSequences(transcript.slice(-PROMPT_BUFFER_LIMIT * 16)).replace(/\r/g, '\n')
  if (!sanitized.trim()) {
    return null
  }

  const lines = sanitized.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trimEnd() ?? ''
    if (!line) {
      continue
    }

    const userHostPromptMatch = line.match(
      /(?:^|\s)[a-zA-Z0-9._-]+@([a-zA-Z0-9._:-]+):(?:~|\/)[^\s]*\s*[#$%>]$/
    )
    const bracketPromptMatch = line.match(
      /\[[^\]\r\n]*@([^\]\s\r\n:]+)(?::|\s+)(?:~|\/)[^\]\r\n]*\]\s*[#$%>]$/
    )

    const candidateHost = (userHostPromptMatch?.[1] ?? bracketPromptMatch?.[1] ?? '').trim()
    if (!candidateHost) {
      continue
    }

    const normalizedCandidate = normalizeHostToken(candidateHost)
    if (!normalizedCandidate) {
      continue
    }

    const matchedServer = findServerByHost(normalizedCandidate)
    if (matchedServer?.host?.trim()) {
      return matchedServer.host.trim()
    }
  }

  return null
}

function restoreSshHostFromCommandHistory(sessionId: string): string | null {
  const history = getSessionHistoryList(sessionId)
  if (!history.length) {
    return null
  }

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const command = history[index]?.trim() ?? ''
    if (!command) {
      continue
    }

    if (/^(?:exit|logout)\s*$/i.test(command)) {
      return null
    }

    const host = parseSshHostFromCommand(command)
    if (!host) {
      continue
    }

    pushRemoteHost(sessionId, host)
    logFileOpenDebug('session sshHost restored from command history', {
      sessionId,
      host,
    })
    return host
  }

  return null
}

function resolveSessionDefaultDirectory(sessionId: string): string | null {
  const boundServer = serverState.getSessionBoundServer(sessionId)
  const value = boundServer?.defaultDirectory?.trim() ?? ''
  return value || null
}

async function applyDefaultDirectoryForSession(sessionId: string): Promise<void> {
  if (!isRemoteManagedSession(sessionId)) {
    return
  }

  let defaultDirectory = resolveSessionDefaultDirectory(sessionId)
  if (!defaultDirectory) {
    try {
      await serverState.ensureLoaded()
    } catch {
      return
    }
    defaultDirectory = resolveSessionDefaultDirectory(sessionId)
  }

  if (!defaultDirectory) {
    return
  }

  const bridge = getTerminalBridge()
  if (!bridge) {
    return
  }

  try {
    const result = await bridge.write({
      sessionId,
      data: `cd ${escapeShellPath(defaultDirectory)}\n`,
    })
    if (isBridgeFailure(result)) {
      writeTerminalError(`apply default directory failed: ${formatBridgeFailure(result.error)}`)
      return
    }
  } catch (error) {
    writeTerminalError(`apply default directory failed: ${formatError(error)}`)
    return
  }

  sessionPathSync.hintCwd(sessionId, defaultDirectory)
  scheduleDelayedCwdRefresh(260)
}

function getFallbackSelectedText(): string {
  const selection = window.getSelection()
  return selection?.toString() ?? ''
}

function countTextLines(text: string): number {
  return text.split(/\r\n|\r|\n/).length
}

function stripWrappingQuotes(value: string): string {
  if (value.length < 2) {
    return value
  }

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }

  return value
}

function isLikelyFilePathStyleContent(value: string): boolean {
  const candidate = stripWrappingQuotes(value.trim())
  if (!candidate || /[\r\n]/.test(candidate) || candidate.startsWith('-')) {
    return false
  }

  if (/^(~\/|\.{1,2}[\\/]|\/|[A-Za-z]:[\\/])/.test(candidate)) {
    return true
  }

  return candidate.includes('/') || candidate.includes('\\')
}

function hasShellSensitiveCharacters(value: string): boolean {
  return /[\s"'`$&|;<>(){}[\]*?!]/.test(value)
}

function toCdCommandArgument(pathValue: string): string {
  const normalized = stripWrappingQuotes(pathValue.trim())
  if (!normalized) {
    return "''"
  }

  if (!hasShellSensitiveCharacters(normalized)) {
    return normalized
  }

  return escapeShellPath(normalized)
}

function maybeEscapePathLikePaste(text: string): string {
  const trimmed = text.trim()
  if (!trimmed || /[\r\n]/.test(trimmed)) {
    return text
  }

  if (!isLikelyFilePathStyleContent(trimmed) || !hasShellSensitiveCharacters(trimmed)) {
    return text
  }

  const shouldEscape = window.confirm(
    t('terminal.paste.confirm.escapePathLike')
  )

  if (!shouldEscape) {
    return text
  }

  return escapeShellPath(stripWrappingQuotes(trimmed))
}

function preparePastedText(text: string): string | null {
  if (!text) {
    return null
  }

  if (/[\r\n]/.test(text)) {
    const lineCount = countTextLines(text)
    const confirmed = window.confirm(t('terminal.paste.confirm.multiline', { count: lineCount }))
    if (!confirmed) {
      return null
    }
  }

  return maybeEscapePathLikePaste(text)
}

function getSessionHistoryList(sessionId: string): string[] {
  const history = sessionCommandHistory.get(sessionId)
  if (history) {
    return history
  }

  const next: string[] = []
  sessionCommandHistory.set(sessionId, next)
  return next
}

function shouldUseLocalPersistence(sessionId: string): boolean {
  return isLocalSession(sessionId) && !isRemoteManagedSession(sessionId)
}

function isLikelyPersistableLocalCwd(value: string | null | undefined): value is string {
  const normalized = normalizeSessionCwdValue(value)
  if (!normalized) {
    return false
  }

  if (normalized === '~' || normalized.startsWith('~/')) {
    return true
  }

  if (normalized.startsWith('/')) {
    return true
  }

  if (/^[A-Za-z]:[\\/]/.test(normalized) || normalized.startsWith('\\\\')) {
    return true
  }

  return false
}

async function persistLocalSessionHistoryNow(sessionId: string): Promise<void> {
  if (!shouldUseLocalPersistence(sessionId)) {
    return
  }

  const bridge = getTerminalBridge()
  const saveHistory = bridge?.saveHistory
  if (!saveHistory) {
    return
  }

  const history = (sessionCommandHistory.get(sessionId) ?? []).slice(-SESSION_HISTORY_LIMIT)
  await invokeBridge('saveHistory', () =>
    saveHistory({
      sessionId,
      history,
    })
  )
}

function schedulePersistLocalSessionHistory(sessionId: string): void {
  if (!shouldUseLocalPersistence(sessionId)) {
    return
  }

  clearHistoryPersistTimer(sessionId)
  const timer = setTimeout(() => {
    historyPersistTimerBySession.delete(sessionId)
    void persistLocalSessionHistoryNow(sessionId)
  }, LOCAL_HISTORY_PERSIST_DELAY_MS)
  historyPersistTimerBySession.set(sessionId, timer)
}

async function persistLocalSessionSnapshotNow(sessionId: string): Promise<void> {
  if (!shouldUseLocalPersistence(sessionId)) {
    return
  }

  const bridge = getTerminalBridge()
  const saveSnapshot = bridge?.saveSnapshot
  if (!saveSnapshot) {
    return
  }

  const snapshot = sessionCache.getTranscript(sessionId)
  const payload: {
    sessionId: string
    snapshot: string
    cols?: number
    rows?: number
    cwd?: string
  } = {
    sessionId,
    snapshot,
  }

  const hintedCwd = sessionPathSync.cwdBySession[sessionId] ?? null
  if (isLikelyPersistableLocalCwd(hintedCwd)) {
    payload.cwd = hintedCwd
  }

  if (terminal && activeBridgeSessionId === sessionId) {
    payload.cols = terminal.cols
    payload.rows = terminal.rows
  }

  await invokeBridge('saveSnapshot', () => saveSnapshot(payload))
}

interface PersistLocalSessionStateNowOptions {
  refreshCwdFallback?: boolean
}

async function persistLocalSessionStateNow(
  sessionId: string,
  options: PersistLocalSessionStateNowOptions = {},
): Promise<void> {
  if (!shouldUseLocalPersistence(sessionId)) {
    return
  }

  const bridge = getTerminalBridge()
  if (!bridge) {
    return
  }

  const refreshCwdFallback = options.refreshCwdFallback !== false
  const snapshot = sessionCache.getTranscript(sessionId)
  const history = (sessionCommandHistory.get(sessionId) ?? []).slice(-SESSION_HISTORY_LIMIT)
  const hintedCwd = sessionPathSync.cwdBySession[sessionId] ?? null
  let persistedCwd = isLikelyPersistableLocalCwd(hintedCwd) ? hintedCwd : null

  if (!persistedCwd && refreshCwdFallback) {
    const refreshedCwd = await sessionPathSync.refreshCwd(sessionId)
    if (isLikelyPersistableLocalCwd(refreshedCwd)) {
      persistedCwd = refreshedCwd
    }
  }

  const saveSnapshot = bridge.saveSnapshot
  const saveHistory = bridge.saveHistory
  const persistTasks: Promise<boolean>[] = []

  if (saveSnapshot) {
    persistTasks.push(
      invokeBridge('saveSnapshot', () =>
        saveSnapshot({
          sessionId,
          snapshot,
          ...(terminal && activeBridgeSessionId === sessionId
            ? {
                cols: terminal.cols,
                rows: terminal.rows,
              }
            : {}),
          ...(persistedCwd
            ? {
                cwd: persistedCwd,
              }
            : {}),
        })
      )
    )
  }

  if (saveHistory) {
    persistTasks.push(
      invokeBridge('saveHistory', () =>
        saveHistory({
          sessionId,
          history,
        })
      )
    )
  }

  if (persistTasks.length === 0) {
    return
  }

  await Promise.allSettled(persistTasks)
}

function schedulePersistLocalSessionSnapshot(sessionId: string): void {
  if (!shouldUseLocalPersistence(sessionId)) {
    return
  }

  clearSnapshotPersistTimer(sessionId)
  const timer = setTimeout(() => {
    snapshotPersistTimerBySession.delete(sessionId)
    void persistLocalSessionSnapshotNow(sessionId)
  }, LOCAL_SNAPSHOT_PERSIST_DELAY_MS)
  snapshotPersistTimerBySession.set(sessionId, timer)
}

async function hydrateLocalSessionFromPersistence(sessionId: string): Promise<void> {
  if (!shouldUseLocalPersistence(sessionId)) {
    return
  }

  if (sessionCache.hasHydratedPersistedState(sessionId)) {
    return
  }

  const bridge = getTerminalBridge()
  if (!bridge?.loadPersisted) {
    sessionCache.markHydratedPersistedState(sessionId)
    return
  }

  try {
    const result = await bridge.loadPersisted({
      sessionId,
      maxBytes: PERSISTED_TRANSCRIPT_LOAD_MAX_BYTES,
    })
    if (isBridgeFailure(result)) {
      writeTerminalError(`loadPersisted failed: ${formatBridgeFailure(result.error)}`)
      return
    }

    const payload = normalizePersistedTerminalStatePayload((result as { data?: unknown }).data)
    if (payload.transcript && !sessionCache.getTranscript(sessionId)) {
      sessionCache.setTranscript(sessionId, payload.transcript)
    }
    if (payload.history.length) {
      sessionCommandHistory.set(sessionId, payload.history.slice(-SESSION_HISTORY_LIMIT))
    }
    if (isLikelyPersistableLocalCwd(payload.cwd)) {
      sessionPathSync.hintCwd(sessionId, payload.cwd)
    }
    sessionCache.markHydratedPersistedState(sessionId)
  } catch (error) {
    writeTerminalError(`loadPersisted failed: ${formatError(error)}`)
  }
}

function getSessionPendingLine(sessionId: string): string {
  return sessionPendingInput.get(sessionId) ?? ''
}

function setSessionPendingLine(sessionId: string, value: string): void {
  sessionPendingInput.set(sessionId, value)
}

function getLocalEchoLine(sessionId: string): string {
  return localEchoLineBySession.get(sessionId) ?? ''
}

function setLocalEchoLine(sessionId: string, value: string): void {
  localEchoLineBySession.set(sessionId, value)
}

function resetLocalEchoLine(sessionId: string): void {
  localEchoLineBySession.delete(sessionId)
}

function shouldUseLocalInputEcho(sessionId: string): boolean {
  const boundServer = serverState.getSessionBoundServer(sessionId)
  const snapshot = serverState.getSessionSnapshot(sessionId)
  if (!boundServer) {
    return true
  }

  return snapshot.state === 'disconnected' || snapshot.state === 'failed'
}

function applyLocalInputEcho(sessionId: string, input: string): void {
  if (!terminal || !input) {
    return
  }

  if (!shouldUseLocalInputEcho(sessionId)) {
    resetLocalEchoLine(sessionId)
    return
  }

  let currentLine = getLocalEchoLine(sessionId)
  for (const char of input) {
    if (char === '\r' || char === '\n') {
      terminal.write('\r\n')
      currentLine = ''
      continue
    }

    if (char === '\u0003') {
      terminal.write('^C\r\n')
      currentLine = ''
      continue
    }

    if (char === '\u0008' || char === '\u007f') {
      if (currentLine.length > 0) {
        currentLine = currentLine.slice(0, -1)
        terminal.write('\b \b')
      }
      continue
    }

    if (char === '\u001b') {
      continue
    }

    const code = char.charCodeAt(0)
    if (char === '\t' || code >= 0x20) {
      terminal.write(char)
      if (char !== '\t') {
        currentLine += char
      }
    }
  }

  setLocalEchoLine(sessionId, currentLine)
}

function commitSessionCommand(sessionId: string, rawCommand: string): void {
  const command = rawCommand.trim()
  if (!command) {
    return
  }

  const history = getSessionHistoryList(sessionId).filter((item) => item !== command)
  history.push(command)

  if (history.length > SESSION_HISTORY_LIMIT) {
    history.splice(0, history.length - SESSION_HISTORY_LIMIT)
  }

  sessionCommandHistory.set(sessionId, history)
  schedulePersistLocalSessionHistory(sessionId)
  if (looksLikeSshCommand(command)) {
    const host = parseSshHostFromCommand(command)
    if (host) {
      pushRemoteHost(sessionId, host)
    }
  } else if (/^(?:exit|logout)\s*$/i.test(command)) {
    popRemoteHost(sessionId)
  }

  if (!isSessionInSshShell(sessionId)) {
    return
  }

  const cwdHint = resolveSessionCwdHintFromCommand(command, sessionPathSync.cwdBySession[sessionId] ?? null)
  if (!cwdHint) {
    return
  }

  sessionPathSync.hintCwd(sessionId, cwdHint)
  logSplitDebug('cwd hinted from command', {
    sessionId,
    command,
    cwdHint,
  })
}

function stripInputControlSequences(data: string): string {
  return data
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1bO./g, '')
    .replace(/\x1b./g, '')
}

function collectSessionCommandHistory(sessionId: string, input: string): void {
  const normalized = stripInputControlSequences(input)
  if (!normalized) {
    return
  }

  let pendingLine = getSessionPendingLine(sessionId)
  for (const char of normalized) {
    if (char === '\r' || char === '\n') {
      commitSessionCommand(sessionId, pendingLine)
      pendingLine = ''
      continue
    }

    if (char === '\u0003' || char === '\u0015') {
      pendingLine = ''
      continue
    }

    if (char === '\u0004') {
      popRemoteHost(sessionId)
      continue
    }

    if (char === '\u0008' || char === '\u007f') {
      pendingLine = pendingLine.slice(0, -1)
      continue
    }

    const code = char.charCodeAt(0)
    if (char === '\t' || code >= 0x20) {
      pendingLine += char
    }
  }

  setSessionPendingLine(sessionId, pendingLine)
}

function isHistorySearchShortcut(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase()
  if (key !== 'r') {
    return false
  }

  if (event.altKey || event.shiftKey) {
    return false
  }

  return event.ctrlKey || event.metaKey
}

function findHistoryMatch(sessionId: string, keyword: string): string | null {
  const history = sessionCommandHistory.get(sessionId) ?? []
  if (!history.length) {
    return null
  }

  const normalizedKeyword = keyword.trim().toLowerCase()
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const command = history[index]
    if (!normalizedKeyword || command.toLowerCase().includes(normalizedKeyword)) {
      return command
    }
  }

  return null
}

async function copySelectedText(): Promise<void> {
  const selectedText = getCurrentTerminalSelectionText()
  if (!selectedText) {
    return
  }

  try {
    await navigator.clipboard.writeText(selectedText)
  } catch (error) {
    writeTerminalError(`copy failed: ${formatError(error)}`)
  }
}

function getCurrentTerminalSelectionText(): string {
  return terminal?.getSelection?.() || getFallbackSelectedText()
}

async function ensureAICommandBarReady(): Promise<void> {
  if (!aiCommandBarVisible.value) {
    aiCommandBarVisible.value = true
    aiCommandBarInput.value = ''
    aiCommandBarStreamingReply.value = ''
    await Promise.all([
      loadAIModelTargets(),
      loadAICommandBarHistory(props.sessionId),
    ])
    await refreshAIResponseLanguageDebug()
    return
  }
  await loadAIModelTargets()
  await refreshAIResponseLanguageDebug()
  nextTick(() => {
    aiCommandBarInputEl.value?.focus()
  })
}

async function explainSelectedTerminalText(selectedText: string): Promise<void> {
  const selection = selectedText.trim()
  if (!selection) {
    return
  }
  if (aiCommandBarLoading.value) {
    globalMessage.info(t('terminal.aiBar.busy'), { replace: true })
    logAICommandBarDebug('selection-explain-blocked-loading', {
      selectedLength: selection.length,
    })
    return
  }

  await ensureAICommandBarReady()
  const displayMessage: AIChatMessage = {
    role: 'user',
    content: selection,
  }
  const explainApiMessage: AIChatMessage = {
    role: 'user',
    content: `Explain this selected terminal text:
${selection}

Output requirements:
1) If the text is a shell command: explain purpose, key arguments, risks, and provide one safer example if applicable.
2) If the text looks like logs/errors/output: summarize meaning, likely causes, and suggest next troubleshooting steps.`,
  }
  const recentContext = aiCommandBarMessages.value.slice(-AI_COMMAND_BAR_CONTEXT_RECENT_MESSAGES)
  aiCommandBarMessages.value = [...aiCommandBarMessages.value, displayMessage]
  await sendAIMessagesAndStream([...recentContext, explainApiMessage])
}

async function pasteTextWithGuards(text: string): Promise<void> {
  const prepared = preparePastedText(text)
  if (!prepared) {
    return
  }

  await pasteIntoTerminal(prepared)
}

async function pasteIntoTerminal(text: string): Promise<void> {
  if (!text) {
    return
  }

  const terminalWithPaste = terminal as typeof terminal & { paste?: (data: string) => void }
  if (terminalWithPaste?.paste) {
    terminalWithPaste.paste(text)
    return
  }

  await sendInputToBridge(text)
}

async function pasteImagePathsForCli(paths: string[]): Promise<void> {
  const normalized = paths
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

  if (!normalized.length) {
    return
  }

  // Keep a trailing space to match CLI attachment parsers (e.g. codex image chips).
  const insertion = `${normalized.join(' ')} `
  terminal?.focus?.()
  await pasteIntoTerminal(insertion)
}

async function pasteFromClipboard(): Promise<void> {
  try {
    const imagePaths = await resolveImagePathsFromClipboard()
    if (imagePaths.length) {
      await handleResolvedLocalPaths(imagePaths, 'paste ignored: no absolute file paths found', {
        asImagePaste: true,
      })
      return
    }

    const text = await navigator.clipboard.readText()
    if (!text) {
      return
    }
    await pasteTextWithGuards(text)
  } catch (error) {
    writeTerminalError(`paste failed: ${formatError(error)}`)
  }
}

function extractClipboardFiles(dataTransfer: DataTransfer | null | undefined): FileWithPath[] {
  if (!dataTransfer) {
    return []
  }

  const result: FileWithPath[] = []
  const keySet = new Set<string>()

  const addFile = (file: File | null): void => {
    if (!file) {
      return
    }
    const candidate = file as FileWithPath
    const identityKey = `${candidate.name}:${candidate.size}:${candidate.type}:${candidate.lastModified}`
    if (keySet.has(identityKey)) {
      return
    }
    keySet.add(identityKey)
    result.push(candidate)
  }

  for (const file of Array.from(dataTransfer.files ?? [])) {
    addFile(file)
  }

  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== 'file') {
      continue
    }
    addFile(item.getAsFile())
  }

  return result
}

async function resolveImagePathsFromClipboard(): Promise<string[]> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return []
  }

  if (typeof navigator.clipboard.read !== 'function') {
    return []
  }

  try {
    const items = await navigator.clipboard.read()
    if (!items.length) {
      return []
    }

    const pathSet = new Set<string>()
    const timestamp = Date.now()
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      const preferredImageMimeType = item.types.find((type) => type.startsWith('image/'))
      if (!preferredImageMimeType) {
        continue
      }

      const blob = await item.getType(preferredImageMimeType)
      const normalized = await writeTempFileFromBlob(blob, {
        fileName: `clipboard-image-${timestamp}-${index + 1}`,
        mimeType: preferredImageMimeType,
      })
      if (normalized) {
        pathSet.add(normalized)
      }
    }

    return Array.from(pathSet)
  } catch {
    return []
  }
}

async function promptCommandHistorySearch(): Promise<void> {
  const sessionId = resolveActiveSessionId()
  if (!sessionId) {
    return
  }

  let keywordInput: string | null = ''
  try {
    if (typeof window.prompt !== 'function') {
      throw new Error('prompt() is not supported')
    }
    keywordInput = window.prompt(t('terminal.history.searchPrompt'), '')
  } catch {
    writeTerminalHistory(t('terminal.history.promptUnsupported'))
    return
  }
  if (keywordInput === null) {
    return
  }

  const match = findHistoryMatch(sessionId, keywordInput)
  if (!match) {
    const keyword = keywordInput.trim()
    const label = keyword
      ? t('terminal.history.searchKeyword', { keyword })
      : t('terminal.history.searchRecent')
    writeTerminalHistory(t('terminal.history.searchNotFound', { label }))
    return
  }

  terminal?.focus?.()
  await sendInputToBridge(`\u0015${match}`)
}

async function openCurrentDirectoryInFileBrowser(): Promise<void> {
  const sourceSessionId = props.sessionId.trim()
  if (!sourceSessionId) {
    writeTerminalError(t('terminal.fileBrowser.error.sourceSessionUnavailable'))
    logFileOpenDebug('abort: source session is unavailable')
    return
  }

  const sourceSession = workspace.sessions.value.find((item) => item.id === sourceSessionId)
  const sourceSnapshot = serverState.getSessionSnapshot(sourceSessionId)
  const sourceBoundServer = serverState.getSessionBoundServer(sourceSessionId)
  const sourceInSshShell = isSessionInSshShell(sourceSessionId)
  logFileOpenDebug('start openCurrentDirectoryInFileBrowser', {
    sourceSessionId,
    sourceKind: sourceSession?.kind ?? null,
    sourceSessionSshHost: sourceSession?.sshHost ?? null,
    sourceSnapshotState: sourceSnapshot.state,
    sourceBoundServerHost: sourceBoundServer?.host ?? null,
    sourceInSshShell,
    hintedCwd: sessionPathSync.cwdBySession[sourceSessionId] ?? null,
  })
  if (sourceInSshShell) {
    const matchedServer = resolveServerForSession(sourceSessionId)
    if (!matchedServer) {
      writeTerminalError(t('terminal.fileBrowser.error.unsavedSshTarget'))
      logFileOpenDebug('abort: ssh target is not in saved servers', {
        sourceSessionId,
        sshHost: resolveSessionSshHost(sourceSessionId),
      })
      return
    }
  }
  // Keep the active terminal session untouched. For ssh-in-shell workflows,
  // remote file browser must use an isolated helper session for SFTP calls.
  const fileBrowserSourceSessionId = sourceInSshShell
    ? await resolveRemoteSftpSessionId(sourceSessionId, { usage: 'file-browser' })
    : sourceSessionId
  logFileOpenDebug('resolved fileBrowserSourceSessionId', {
    sourceSessionId,
    sourceInSshShell,
    fileBrowserSourceSessionId: fileBrowserSourceSessionId ?? null,
  })
  if (!fileBrowserSourceSessionId) {
    logFileOpenDebug('abort: fileBrowserSourceSessionId unavailable', {
      sourceSessionId,
      sourceInSshShell,
    })
    return
  }

  let cwd = await resolvePreferredCwdForSession(sourceSessionId, {
    forceRemote: sourceInSshShell,
  })
  if (
    sourceInSshShell &&
    cwd &&
    cwd.startsWith('~') &&
    fileBrowserSourceSessionId !== sourceSessionId
  ) {
    const helperResolvedCwd = await resolvePreferredCwdForSession(fileBrowserSourceSessionId, {
      forceRemote: true,
    })
    if (helperResolvedCwd && helperResolvedCwd.startsWith('/')) {
      logFileOpenDebug('replace remote cwd alias by helper absolute cwd', {
        sourceSessionId,
        fileBrowserSourceSessionId,
        previousCwd: cwd,
        helperResolvedCwd,
      })
      cwd = helperResolvedCwd
    } else {
      logFileOpenDebug('helper absolute cwd unavailable, keep source cwd', {
        sourceSessionId,
        fileBrowserSourceSessionId,
        previousCwd: cwd,
        helperResolvedCwd: helperResolvedCwd ?? null,
      })
    }
  }
  logFileOpenDebug('resolved preferred cwd', {
    sourceSessionId,
    sourceInSshShell,
    cwd: cwd ?? null,
  })
  logSplitDebug('open file browser from terminal', {
    sessionId: sourceSessionId,
    cwd,
    sourceInSshShell,
    hintedCwd: sessionPathSync.cwdBySession[sourceSessionId] ?? null,
  })
  if (!cwd) {
    writeTerminalError(t('terminal.fileBrowser.error.cwdUnavailable'))
    logFileOpenDebug('abort: cwd unavailable', {
      sourceSessionId,
      sourceInSshShell,
    })
    return
  }

  workspace.switchSession(sourceSessionId)
  if (!workspace.splitFocusedPane('horizontal', { kind: 'file' })) {
    writeTerminalError(t('terminal.layout.error.splitLimitReached', { max: 6 }))
    logFileOpenDebug('abort: splitFocusedPane denied', {
      sourceSessionId,
    })
    return
  }

  const filePaneSessionId = workspace.activeSessionId.value
  if (!filePaneSessionId) {
    writeTerminalError(t('terminal.fileBrowser.error.createPaneFailed'))
    logFileOpenDebug('abort: filePaneSessionId unavailable', {
      sourceSessionId,
    })
    return
  }

  workspace.updateSession(filePaneSessionId, {
    title: t('terminal.fileBrowser.title'),
    filePanePath: cwd,
    filePaneSourceKind: sourceInSshShell ? 'ssh' : 'local',
    filePaneSourceSessionId: fileBrowserSourceSessionId,
  })
  logFileOpenDebug('file pane created', {
    sourceSessionId,
    filePaneSessionId,
    filePanePath: cwd,
    filePaneSourceKind: sourceInSshShell ? 'ssh' : 'local',
    filePaneSourceSessionId: fileBrowserSourceSessionId,
  })
}

function scheduleSplitInheritedCwdApply(sessionId: string, source: string): void {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) {
    logSplitCwdDebug('schedule skipped: empty sessionId', { source })
    return
  }

  if (!splitCwdInheritState.hasPending(normalizedSessionId)) {
    logSplitCwdDebug('schedule skipped: no pending inherited cwd', {
      sessionId: normalizedSessionId,
      source,
    })
    return
  }

  clearSplitInheritedCwdSettleTimer(normalizedSessionId)
  const timer = setTimeout(() => {
    splitInheritedCwdSettleTimerBySession.delete(normalizedSessionId)
    void applySplitInheritedCwd(normalizedSessionId)
  }, TERMINAL_COMMAND_SETTLE_DELAY_MS)
  splitInheritedCwdSettleTimerBySession.set(normalizedSessionId, timer)
  logSplitCwdDebug('schedule apply', {
    sessionId: normalizedSessionId,
    source,
    targetCwd: splitCwdInheritState.getPending(normalizedSessionId),
    delayMs: TERMINAL_COMMAND_SETTLE_DELAY_MS,
  })
  logSplitDebug('schedule split cwd inherit', {
    sessionId: normalizedSessionId,
    source,
    delayMs: TERMINAL_COMMAND_SETTLE_DELAY_MS,
  })
}

async function applySplitInheritedCwd(sessionId: string): Promise<void> {
  const targetSessionId = sessionId.trim()
  if (!targetSessionId) {
    logSplitCwdDebug('apply skipped: empty sessionId')
    return
  }

  if (splitInheritedCwdApplyingBySession.has(targetSessionId)) {
    logSplitCwdDebug('apply skipped: already applying', {
      sessionId: targetSessionId,
      targetCwd: splitCwdInheritState.getPending(targetSessionId),
    })
    return
  }

  const targetCwd = splitCwdInheritState.getPending(targetSessionId)?.trim() ?? ''
  if (!targetCwd) {
    logSplitCwdDebug('apply skipped: empty target cwd', {
      sessionId: targetSessionId,
    })
    clearSplitInheritedCwd(targetSessionId)
    return
  }

  if (!isSessionInSshShell(targetSessionId) && !localPromptReadyBySession.has(targetSessionId)) {
    logSplitCwdDebug('apply skipped: local prompt not ready', {
      sessionId: targetSessionId,
      targetCwd,
    })
    return
  }

  logSplitCwdDebug('apply start', {
    sessionId: targetSessionId,
    targetCwd,
    hintedCwd: sessionPathSync.cwdBySession[targetSessionId] ?? null,
    inSshShell: isSessionInSshShell(targetSessionId),
  })
  splitInheritedCwdApplyingBySession.add(targetSessionId)
  try {
    const hintedCwd = normalizeSessionCwdValue(sessionPathSync.cwdBySession[targetSessionId] ?? null)
    if (hintedCwd && hintedCwd === targetCwd) {
      logSplitCwdDebug('apply skipped: already at target cwd', {
        sessionId: targetSessionId,
        targetCwd,
      })
      clearSplitInheritedCwd(targetSessionId)
      return
    }

    const cdPathArg = toCdCommandArgument(targetCwd)
    const cdCommand = `cd ${cdPathArg}\r`
    logSplitCwdDebug('apply write cd', {
      sessionId: targetSessionId,
      command: cdCommand.replace(/\r/g, '\\r'),
    })
    const written = await writeInputToSession(targetSessionId, cdCommand, {
      trackHistory: false,
      reportUnavailable: false,
    })
    if (!written) {
      logSplitCwdDebug('apply failed: write returned false', {
        sessionId: targetSessionId,
        targetCwd,
      })
      return
    }

    logSplitCwdDebug('apply success', {
      sessionId: targetSessionId,
      targetCwd,
    })
    sessionPathSync.hintCwd(targetSessionId, targetCwd)
    clearSplitInheritedCwd(targetSessionId)
  } finally {
    splitInheritedCwdApplyingBySession.delete(targetSessionId)
  }
}

async function splitFocusedPaneAndInheritLocation(direction: 'horizontal' | 'vertical'): Promise<boolean> {
  const sourceSessionId = props.sessionId.trim()
  if (!sourceSessionId) {
    logSplitCwdDebug('split skipped: empty source session')
    return false
  }

  workspace.switchSession(sourceSessionId)

  const sourceInSshShell = isSessionInSshShell(sourceSessionId)
  const sourceServer = resolveServerForSession(sourceSessionId)
  const sourceCwd = await resolvePreferredCwdForSession(sourceSessionId, {
    forceRemote: sourceInSshShell,
  })
  logSplitCwdDebug('split source resolved', {
    sourceSessionId,
    direction,
    sourceInSshShell,
    sourceCwd: sourceCwd ?? null,
    hintedCwd: sessionPathSync.cwdBySession[sourceSessionId] ?? null,
    sourceServerHost: sourceServer?.host ?? null,
  })

  if (!workspace.splitFocusedPane(direction)) {
    logSplitCwdDebug('split failed: workspace split denied', {
      sourceSessionId,
      direction,
    })
    return false
  }

  const targetSessionId = workspace.activeSessionId.value
  if (!targetSessionId || targetSessionId === sourceSessionId) {
    logSplitCwdDebug('split failed: invalid target session', {
      sourceSessionId,
      targetSessionId: targetSessionId ?? null,
    })
    return false
  }

  let normalizedSourceCwd = normalizeSessionCwdValue(sourceCwd)
  if (sourceInSshShell) {
    if (!sourceServer) {
      logSplitCwdDebug('split remote failed: source server unavailable', {
        sourceSessionId,
        targetSessionId,
      })
      clearSplitInheritedCwd(targetSessionId)
      writeTerminalError(t('terminal.split.error.inheritRemoteServerUnavailable'))
      return true
    }

    logSplitCwdDebug('split remote connect start', {
      sourceSessionId,
      targetSessionId,
      sourceServerHost: sourceServer.host,
    })
    const connected = await connectServerToSession(targetSessionId, sourceServer)
    if (!connected) {
      logSplitCwdDebug('split remote connect failed', {
        sourceSessionId,
        targetSessionId,
        sourceServerHost: sourceServer.host,
      })
      clearSplitInheritedCwd(targetSessionId)
      return true
    }
    logSplitCwdDebug('split remote connect success', {
      sourceSessionId,
      targetSessionId,
      sourceServerHost: sourceServer.host,
    })
    return true
  }

  // Local split inheritance prefers an absolute path so that `cd` is robust
  // even when hinted cwd is in `~` form.
  if (normalizedSourceCwd?.startsWith('~')) {
    const refreshedLocalCwd = normalizeSessionCwdValue(
      await sessionPathSync.refreshCwd(sourceSessionId, {
        preferRemote: false,
      })
    )
    const expandedFromHomeBase = refreshedLocalCwd
      ? expandHomePathWithKnownBase(normalizedSourceCwd, refreshedLocalCwd)
      : null
    if (expandedFromHomeBase?.startsWith('/')) {
      normalizedSourceCwd = expandedFromHomeBase
    } else if (refreshedLocalCwd?.startsWith('/')) {
      normalizedSourceCwd = refreshedLocalCwd
    }
  }

  if (normalizedSourceCwd) {
    splitCwdInheritState.setPending(targetSessionId, normalizedSourceCwd)
    logSplitCwdDebug('split local inherit set', {
      sourceSessionId,
      targetSessionId,
      normalizedSourceCwd,
    })
  } else {
    logSplitCwdDebug('split local inherit skipped: empty normalized cwd', {
      sourceSessionId,
      targetSessionId,
      sourceCwd: sourceCwd ?? null,
      hintedCwd: sessionPathSync.cwdBySession[sourceSessionId] ?? null,
    })
    clearSplitInheritedCwd(targetSessionId)
  }

  return true
}

function canShowConnectServerSubmenu(): boolean {
  const sessionId = props.sessionId.trim()
  if (!sessionId) {
    return false
  }

  return isLocalSession(sessionId)
}

function showContextMenu(event: MouseEvent, selectedText?: string): void {
  event.preventDefault()
  clearContextSubmenuHideTimer()
  contextMenuSelectedText.value = selectedText ?? getCurrentTerminalSelectionText()
  const maxX = Math.max(8, window.innerWidth - CONTEXT_MENU_MAIN_WIDTH - 8)
  const maxY = Math.max(8, window.innerHeight - CONTEXT_MENU_MAIN_HEIGHT - 8)
  const canOpenSubmenuToRight =
    event.clientX + CONTEXT_MENU_MAIN_WIDTH + CONTEXT_MENU_SUBMENU_WIDTH + 16 <= window.innerWidth

  contextMenuState.x = Math.min(event.clientX, maxX)
  contextMenuState.y = Math.min(event.clientY, maxY)
  contextMenuState.visible = true
  contextServerSubmenu.value = null
  contextServerSubmenuDirection.value = canOpenSubmenuToRight ? 'right' : 'left'
  void preloadContextMenuServers()
}

async function handleContextMenuAction(
  action: 'ai-explain' | 'copy' | 'paste' | 'clear' | 'open-dir' | 'split-vertical' | 'split-horizontal'
): Promise<void> {
  const selectedTextForAction = contextMenuSelectedText.value
  hideContextMenu()

  if (action === 'ai-explain') {
    await explainSelectedTerminalText(selectedTextForAction)
    return
  }

  if (action === 'copy') {
    await copySelectedText()
    return
  }

  if (action === 'paste') {
    await pasteFromClipboard()
    return
  }

  if (action === 'clear') {
    terminal?.clear?.()
    return
  }

  if (action === 'split-vertical') {
    const splitOk = await splitFocusedPaneAndInheritLocation('vertical')
    if (!splitOk) {
      writeTerminalError(t('terminal.layout.error.splitLimitReached', { max: 6 }))
    }
    return
  }

  if (action === 'split-horizontal') {
    const splitOk = await splitFocusedPaneAndInheritLocation('horizontal')
    if (!splitOk) {
      writeTerminalError(t('terminal.layout.error.splitLimitReached', { max: 6 }))
    }
    return
  }

  await openCurrentDirectoryInFileBrowser()
}

function showServerSubmenu(kind: 'new-tab' | 'new-pane' | 'connect-shell'): void {
  clearContextSubmenuHideTimer()
  contextServerSubmenu.value = kind
}

function hideServerSubmenu(): void {
  clearContextSubmenuHideTimer()
  contextSubmenuHideTimer = setTimeout(() => {
    contextSubmenuHideTimer = null
    contextServerSubmenu.value = null
  }, CONTEXT_SUBMENU_HIDE_DELAY_MS)
}

function formatConnectError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  if (typeof error === 'string' && error.trim()) {
    return error
  }
  return fallback
}

function formatServerMenuMeta(server: ServerRecord): string {
  return `${server.name} (${server.username}@${server.host})`
}

async function preloadContextMenuServers(): Promise<void> {
  if (serverState.initialized.value || serverState.loading.value) {
    return
  }

  try {
    await serverState.ensureLoaded()
  } catch (error) {
    writeTerminalError(t('terminal.server.error.loadServersFailed', { detail: formatError(error) }))
  }
}

async function connectServerToSession(
  sessionId: string,
  server: ServerRecord,
  options?: { renameOnSuccess?: string; renameOnFailure?: string },
): Promise<boolean> {
  clearAutoSshRuntimeState(sessionId, 'connectServerToSession')
  serverState.selectServer(server.id)
  workspace.updateSession(sessionId, {
    sshHost: server.host,
  })
  try {
    await serverState.connectSession(sessionId, server.id)
    serverState.startActiveSessionStatusPolling(sessionId)
    if (options?.renameOnSuccess) {
      workspace.renameSession(sessionId, options.renameOnSuccess)
    }
    return true
  } catch (error) {
    if (options?.renameOnFailure) {
      workspace.renameSession(sessionId, options.renameOnFailure)
    }
    globalMessage.error(formatConnectError(error, t('terminal.server.error.connectFailed')), {
      replace: true,
    })
    return false
  }
}

async function handleServerSubmenuAction(
  mode: 'new-tab' | 'new-pane' | 'connect-shell',
  serverId: number | 'localhost',
): Promise<void> {
  hideContextMenu()

  if (mode === 'new-pane' && serverId === NEW_PANE_LOCALHOST_ITEM_ID) {
    workspace.switchSession(props.sessionId)
    if (!workspace.splitFocusedPane('horizontal')) {
      writeTerminalError(t('terminal.layout.error.splitLimitReached', { max: 6 }))
      return
    }

    const targetSessionId = workspace.activeSessionId.value
    if (!targetSessionId) {
      writeTerminalError(t('terminal.layout.error.createPaneSessionFailed'))
      return
    }

    scheduleTerminalFocus(targetSessionId)
    return
  }

  if (!serverState.initialized.value) {
    await preloadContextMenuServers()
  }

  if (typeof serverId !== 'number') {
    writeTerminalError(t('terminal.server.error.invalidServerId'))
    return
  }

  const server = serverState.servers.value.find((item) => item.id === serverId)
  if (!server) {
    writeTerminalError(t('terminal.server.error.serverNotFound', { id: serverId }))
    return
  }

  if (mode === 'connect-shell') {
    const targetSessionId = props.sessionId.trim()
    if (!targetSessionId || !isLocalSession(targetSessionId)) {
      writeTerminalError(t('terminal.server.error.notLocalShell'))
      logFileOpenDebug('connect-shell abort: target is not local session', {
        targetSessionId,
        mode,
      })
      scheduleTerminalFocus(targetSessionId)
      return
    }

    const command = buildSshCommandForServer(server)
    const hostPushed = pushRemoteHost(targetSessionId, server.host)
    logFileOpenDebug('connect-shell prepared', {
      targetSessionId,
      serverId: server.id,
      serverHost: server.host,
      command,
      hostPushed,
      sessionSshHost: workspace.sessions.value.find((item) => item.id === targetSessionId)?.sshHost ?? null,
    })
    const written = await writeInputToSession(targetSessionId, `${command}\r`, {
      trackHistory: true,
      reportUnavailable: true,
    })
    logFileOpenDebug('connect-shell write result', {
      targetSessionId,
      serverHost: server.host,
      written,
      sessionSshHost: workspace.sessions.value.find((item) => item.id === targetSessionId)?.sshHost ?? null,
    })
    if (!written) {
      if (hostPushed) {
        popRemoteHost(targetSessionId, server.host)
        logFileOpenDebug('connect-shell rollback host state after write failure', {
          targetSessionId,
          serverHost: server.host,
          sessionSshHost: workspace.sessions.value.find((item) => item.id === targetSessionId)?.sshHost ?? null,
        })
      }
      writeTerminalError(t('terminal.server.error.sendSshCommandFailed'))
      scheduleTerminalFocus(targetSessionId)
      return
    }

    writeTerminalAuth(`connect remote service ${server.host}`)
    scheduleTerminalFocus(targetSessionId)
    return
  }

  const baseTitle = `SSH ${server.name}`

  if (mode === 'new-tab') {
    const session = workspace.createSession({
      title: `${baseTitle} ...`,
      activate: true,
      kind: 'local',
    })
    if (!session) {
      writeTerminalError(t('terminal.layout.error.tabLimitReached', { max: workspace.maxTabs }))
      return
    }

    await connectServerToSession(session.id, server, {
      renameOnSuccess: baseTitle,
      renameOnFailure: `${baseTitle} (failed)`,
    })
    scheduleTerminalFocus(session.id)
    return
  }

  workspace.switchSession(props.sessionId)
  if (!workspace.splitFocusedPane('horizontal')) {
    writeTerminalError(t('terminal.layout.error.splitLimitReached', { max: 6 }))
    return
  }

  const targetSessionId = workspace.activeSessionId.value
  if (!targetSessionId) {
    writeTerminalError(t('terminal.layout.error.createPaneSessionFailed'))
    return
  }

  await connectServerToSession(targetSessionId, server)
  scheduleTerminalFocus(targetSessionId)
}

function writeTerminalError(message: string): void {
  const errorText = `\r\n\x1b[1;31m[terminal error]\x1b[0m ${message}\r\n`
  if (terminal) {
    terminal.write(errorText)
    return
  }
  fallbackMode.value = true
  fallbackReason.value = message
}

function writeUploadNotice(level: 'info' | 'success' | 'error', message: string): void {
  const content = message.trim()
  if (!content) {
    return
  }

  const options = {
    replace: true,
    durationMs: level === 'error' ? 3000 : 2200,
  }

  if (level === 'success') {
    globalMessage.success(content, options)
    return
  }

  if (level === 'error') {
    globalMessage.error(content, options)
    return
  }

  globalMessage.info(content, options)
}

function writeTerminalInfo(message: string): void {
  writeUploadNotice('info', message)
}

function writeTerminalAuth(message: string): void {
  logAutoSshDebug('auth notice', {
    message,
  })
}

function writeTerminalSuccess(message: string): void {
  writeUploadNotice('success', message)
}

function writeTerminalUploadError(message: string): void {
  writeUploadNotice('error', message)
}

function writeTerminalHistory(message: string): void {
  if (terminal) {
    terminal.write(`\r\n\x1b[35m[history]\x1b[0m ${message}\r\n`)
  }
}

function reportMissingBridge(): void {
  if (bridgeMissingReported) {
    return
  }
  bridgeMissingReported = true
  writeTerminalError(t('terminal.bridge.error.unavailable'))
}

function isFileDropEvent(event: DragEvent): boolean {
  const types = event.dataTransfer?.types
  if (!types) {
    return false
  }

  const typeList = Array.from(types)
  return typeList.includes('Files') || typeList.includes('text/uri-list')
}

function isAbsoluteLocalPath(value: string): boolean {
  if (!value) {
    return false
  }

  if (value.startsWith('/')) {
    return true
  }

  if (/^[A-Za-z]:[\\/]/.test(value)) {
    return true
  }

  return value.startsWith('\\\\')
}

function normalizeAbsolutePathCandidate(raw: string): string | null {
  const value = raw.trim()
  if (!value || !isAbsoluteLocalPath(value)) {
    return null
  }
  return value
}

function toAbsolutePathFromFileUrl(rawUrl: string): string | null {
  const candidate = rawUrl.trim()
  if (!candidate) {
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }

  if (parsed.protocol !== 'file:') {
    return null
  }

  let pathname = decodeURIComponent(parsed.pathname || '')
  if (!pathname) {
    return null
  }

  // file:///C:/Users/... -> C:/Users/...
  if (/^\/[A-Za-z]:\//.test(pathname)) {
    pathname = pathname.slice(1)
  }

  // file://server/share/path -> //server/share/path
  if (parsed.host) {
    pathname = `//${parsed.host}${pathname}`
  }

  return normalizeAbsolutePathCandidate(pathname)
}

function extractAbsolutePathsFromUriList(raw: string): string[] {
  if (!raw.trim()) {
    return []
  }

  return raw
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => toAbsolutePathFromFileUrl(line))
    .filter((value): value is string => typeof value === 'string')
}

function extractAbsolutePathsFromPlainText(raw: string): string[] {
  if (!raw.trim()) {
    return []
  }

  const lines = raw
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const result: string[] = []
  for (const line of lines) {
    if (line.startsWith('file://')) {
      const fromUrl = toAbsolutePathFromFileUrl(line)
      if (fromUrl) {
        result.push(fromUrl)
      }
      continue
    }

    const normalized = normalizeAbsolutePathCandidate(line)
    if (normalized) {
      result.push(normalized)
    }
  }

  return result
}

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => {
      reject(new Error('failed to read file content'))
    }
    reader.onload = () => {
      const payload = typeof reader.result === 'string' ? reader.result : ''
      const commaIndex = payload.indexOf(',')
      if (commaIndex < 0 || commaIndex >= payload.length - 1) {
        reject(new Error('failed to encode file content'))
        return
      }
      resolve(payload.slice(commaIndex + 1))
    }
    reader.readAsDataURL(file)
  })
}

async function writeTempFileFromBlob(
  file: Blob,
  options: {
    fileName?: string
    mimeType?: string
  } = {},
): Promise<string | null> {
  const bridge = getTerminalBridge()
  if (!bridge?.writeTempFile) {
    return null
  }

  try {
    const dataBase64 = await fileToBase64(file)
    const result = await bridge.writeTempFile({
      fileName: options.fileName,
      mimeType: options.mimeType || file.type || undefined,
      dataBase64,
    })

    if (isBridgeFailure(result)) {
      writeTerminalError(`temp file write failed: ${formatBridgeFailure(result.error)}`)
      return null
    }

    const tempPath = (result as { data?: { path?: unknown } }).data?.path
    if (typeof tempPath !== 'string') {
      writeTerminalError(t('terminal.tempFile.error.pathUnavailable'))
      return null
    }

    return normalizeAbsolutePathCandidate(tempPath)
  } catch (error) {
    writeTerminalError(`temp file write failed: ${formatError(error)}`)
    return null
  }
}

async function resolveAbsolutePathFromDroppedFile(file: FileWithPath): Promise<string | null> {
  const directPath = normalizeAbsolutePathCandidate(file.path ?? '')
  if (directPath) {
    return directPath
  }

  const resolver = getTerminalBridge()?.resolveFilePath
  if (typeof resolver !== 'function') {
    return null
  }

  try {
    const resolvedPath = resolver(file)
    const normalized = typeof resolvedPath === 'string' ? normalizeAbsolutePathCandidate(resolvedPath) : null
    if (normalized) {
      return normalized
    }
  } catch {
    // Ignore and fallback to temp-file materialization.
  }

  return await writeTempFileFromBlob(file, {
    fileName: file.name,
    mimeType: file.type || undefined,
  })
}

async function resolveAbsolutePathsFromFiles(files: readonly FileWithPath[]): Promise<string[]> {
  const pathSet = new Set<string>()
  for (const file of files) {
    const normalized = await resolveAbsolutePathFromDroppedFile(file)
    if (normalized) {
      pathSet.add(normalized)
    }
  }
  return Array.from(pathSet)
}

async function resolveImagePathsFromClipboardData(
  dataTransfer: DataTransfer | null | undefined,
): Promise<string[]> {
  if (!dataTransfer?.items?.length) {
    return []
  }

  const pathSet = new Set<string>()
  const timestamp = Date.now()
  let imageIndex = 0
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) {
      continue
    }

    const file = item.getAsFile()
    if (!file) {
      continue
    }

    imageIndex += 1
    const normalized = await writeTempFileFromBlob(file, {
      fileName: `clipboard-image-${timestamp}-${imageIndex}`,
      mimeType: item.type || file.type || undefined,
    })
    if (normalized) {
      pathSet.add(normalized)
    }
  }

  return Array.from(pathSet)
}

async function toDroppedAbsolutePaths(event: DragEvent): Promise<string[]> {
  const pathSet = new Set<string>()

  const fileList = event.dataTransfer?.files
  if (fileList?.length) {
    const paths = await resolveAbsolutePathsFromFiles(Array.from(fileList) as FileWithPath[])
    for (const path of paths) {
      pathSet.add(path)
    }
  }

  const uriList = event.dataTransfer?.getData('text/uri-list') ?? ''
  for (const path of extractAbsolutePathsFromUriList(uriList)) {
    pathSet.add(path)
  }

  const plainText = event.dataTransfer?.getData('text/plain') ?? ''
  for (const path of extractAbsolutePathsFromPlainText(plainText)) {
    pathSet.add(path)
  }

  return Array.from(pathSet)
}

function formatDroppedPathsForShell(paths: string[]): string {
  return paths
    .map((item) => (hasShellSensitiveCharacters(item) ? escapeShellPath(item) : item))
    .join(' ')
}

function resolveActiveSessionId(): string | null {
  const candidate = activeBridgeSessionId ?? props.sessionId
  if (typeof candidate !== 'string') {
    return null
  }

  const sessionId = candidate.trim()
  return sessionId || null
}

function hasSessionInWorkspace(sessionId: string): boolean {
  return workspace.sessions.value.some((session) => session.id === sessionId)
}

function isSessionActive(sessionId: string): boolean {
  return workspace.activeSessionId.value === sessionId
}

function focusTerminalIfActive(sessionId: string): void {
  if (!terminal) {
    return
  }

  if (!isSessionActive(sessionId) || !isTerminalHostVisible()) {
    return
  }

  terminal.focus?.()
}

function scheduleTerminalFocus(sessionId: string): void {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) {
    return
  }

  const tryFocus = () => {
    focusTerminalIfActive(normalizedSessionId)
  }

  tryFocus()

  if (typeof window === 'undefined') {
    return
  }

  window.requestAnimationFrame(() => {
    tryFocus()
  })
  window.setTimeout(() => {
    tryFocus()
  }, 0)
  window.setTimeout(() => {
    tryFocus()
  }, 90)
}

function shouldBindSessionNow(sessionId: string): boolean {
  return isSessionActive(sessionId) || sessionCache.hasOpenedSession(sessionId)
}

function clearBackgroundBindTimer(): void {
  if (!backgroundBindTimer) {
    return
  }

  clearTimeout(backgroundBindTimer)
  backgroundBindTimer = null
}

function isLocalSession(sessionId: string): boolean {
  const session = workspace.sessions.value.find((item) => item.id === sessionId)
  return session?.kind === 'local'
}

function isTerminalSession(sessionId: string): boolean {
  const session = workspace.sessions.value.find((item) => item.id === sessionId)
  return Boolean(session && session.kind !== 'file')
}

function isRemoteManagedSession(sessionId: string): boolean {
  return Boolean(serverState.getSessionBoundServer(sessionId))
}

function resolveSessionSshHost(sessionId: string): string | null {
  const session = workspace.sessions.value.find((item) => item.id === sessionId)
  const host = session?.sshHost?.trim() ?? ''
  if (host) {
    return host
  }

  const inferredHost = inferSshHostFromTranscript(sessionId)
  if (inferredHost) {
    pushRemoteHost(sessionId, inferredHost)
    logFileOpenDebug('session sshHost inferred from transcript', {
      sessionId,
      inferredHost,
    })
    return inferredHost
  }

  const historyHost = restoreSshHostFromCommandHistory(sessionId)
  if (!historyHost) {
    return null
  }

  return historyHost
}

function isSessionInSshShell(sessionId: string): boolean {
  if (serverState.getSessionBoundServer(sessionId)) {
    return true
  }

  return Boolean(resolveSessionSshHost(sessionId))
}

function resolveServerForSession(sessionId: string): ServerRecord | null {
  const bound = serverState.getSessionBoundServer(sessionId)
  if (bound) {
    return bound
  }

  const sshHost = resolveSessionSshHost(sessionId)
  if (!sshHost) {
    return null
  }

  return findServerByHost(sshHost)
}

function findServerByHost(host: string): ServerRecord | null {
  const normalizedHost = normalizeHostToken(host)
  if (!normalizedHost) {
    return null
  }

  for (const server of serverState.servers.value) {
    if (normalizeHostToken(server.host) === normalizedHost) {
      return server
    }
  }

  return null
}

function toRemoteUploadHelperSessionId(sessionId: string, serverId: number): string {
  return `${sessionId}::sftp::${serverId}`
}

function trackRemoteUploadHelperSessionId(sourceSessionId: string, helperSessionId: string): void {
  const normalizedSource = sourceSessionId.trim()
  const normalizedHelper = helperSessionId.trim()
  if (!normalizedSource || !normalizedHelper) {
    return
  }

  const existing = remoteUploadHelperSessionIdsBySession.get(normalizedSource)
  if (existing) {
    existing.add(normalizedHelper)
    return
  }

  remoteUploadHelperSessionIdsBySession.set(normalizedSource, new Set([normalizedHelper]))
}

async function disposeRemoteUploadHelperSessions(sourceSessionId: string): Promise<void> {
  const normalizedSource = sourceSessionId.trim()
  if (!normalizedSource) {
    return
  }

  const helperSessionIds = remoteUploadHelperSessionIdsBySession.get(normalizedSource)
  if (!helperSessionIds || helperSessionIds.size === 0) {
    remoteUploadHelperSessionIdsBySession.delete(normalizedSource)
    return
  }

  remoteUploadHelperSessionIdsBySession.delete(normalizedSource)
  for (const helperSessionId of Array.from(helperSessionIds)) {
    try {
      if (serverState.getSessionBoundServer(helperSessionId)) {
        await serverState.disconnectSession(helperSessionId)
      }
    } catch {
      // Ignore helper cleanup errors; helper sessions are best-effort.
    }
  }
}

async function resolveRemoteSftpSessionId(
  sessionId: string,
  options: { usage: 'upload' | 'file-browser' } = { usage: 'upload' },
): Promise<string | null> {
  // IMPORTANT:
  // Never bind remote server connection to the active terminal session id.
  // Main-process connect() closes the terminal for that session id first,
  // which would kill the current pane shell/ssh process (SIGHUP).
  // Always allocate/reuse a dedicated helper session id for SFTP usage.
  const normalizedSessionId = sessionId.trim()
  logFileOpenDebug('resolveRemoteSftpSessionId:start', {
    sessionId,
    normalizedSessionId,
    usage: options.usage,
  })
  if (!normalizedSessionId) {
    logFileOpenDebug('resolveRemoteSftpSessionId:abort empty session id', {
      sessionId,
      usage: options.usage,
    })
    return null
  }

  if (isRemoteConnectedSession(normalizedSessionId)) {
    logFileOpenDebug('resolveRemoteSftpSessionId:reuse connected session', {
      sessionId: normalizedSessionId,
      usage: options.usage,
    })
    return normalizedSessionId
  }

  if (!isSessionInSshShell(normalizedSessionId)) {
    logFileOpenDebug('resolveRemoteSftpSessionId:abort not in ssh shell', {
      sessionId: normalizedSessionId,
      usage: options.usage,
      sshHost: resolveSessionSshHost(normalizedSessionId),
      snapshotState: serverState.getSessionSnapshot(normalizedSessionId).state,
    })
    return null
  }

  if (!serverState.initialized.value) {
    await preloadContextMenuServers()
  }

  const server = resolveServerForSession(normalizedSessionId)
  if (!server) {
    logFileOpenDebug('resolveRemoteSftpSessionId:abort no matched server', {
      sessionId: normalizedSessionId,
      usage: options.usage,
      sshHost: resolveSessionSshHost(normalizedSessionId),
    })
    if (options.usage === 'file-browser') {
      writeTerminalError(t('terminal.fileBrowser.error.unsavedSshTarget'))
    } else {
      writeTerminalUploadError(t('terminal.upload.error.unsavedSshTarget'))
    }
    return null
  }

  const helperSessionId = toRemoteUploadHelperSessionId(normalizedSessionId, server.id)
  trackRemoteUploadHelperSessionId(normalizedSessionId, helperSessionId)

  const helperBoundServer = serverState.getSessionBoundServer(helperSessionId)
  const helperSnapshot = serverState.getSessionSnapshot(helperSessionId)
  if (
    helperBoundServer?.id === server.id &&
    (helperSnapshot.state === 'connected' || helperSnapshot.state === 'reconnecting')
  ) {
    logFileOpenDebug('resolveRemoteSftpSessionId:reuse helper', {
      sessionId: normalizedSessionId,
      usage: options.usage,
      helperSessionId,
      helperState: helperSnapshot.state,
      serverHost: server.host,
    })
    return helperSessionId
  }

  try {
    await serverState.connectSession(helperSessionId, server.id)
  } catch (error) {
    logFileOpenDebug('resolveRemoteSftpSessionId:connect helper failed', {
      sessionId: normalizedSessionId,
      usage: options.usage,
      helperSessionId,
      serverId: server.id,
      serverHost: server.host,
      error: formatError(error),
    })
    const message =
      options.usage === 'file-browser'
        ? `open file browser failed: unable to establish SFTP helper connection (${formatError(error)})`
        : `upload failed: unable to establish SFTP helper connection (${formatError(error)})`
    if (options.usage === 'file-browser') {
      writeTerminalError(message)
    } else {
      writeTerminalUploadError(message)
    }
    return null
  }

  const connectedServer = serverState.getSessionBoundServer(helperSessionId)
  const connectedSnapshot = serverState.getSessionSnapshot(helperSessionId)
  if (
    connectedServer?.id === server.id &&
    (connectedSnapshot.state === 'connected' || connectedSnapshot.state === 'reconnecting')
  ) {
    logFileOpenDebug('resolveRemoteSftpSessionId:helper connected', {
      sessionId: normalizedSessionId,
      usage: options.usage,
      helperSessionId,
      helperState: connectedSnapshot.state,
      serverHost: server.host,
    })
    return helperSessionId
  }

  logFileOpenDebug('resolveRemoteSftpSessionId:helper not ready', {
    sessionId: normalizedSessionId,
    usage: options.usage,
    helperSessionId,
    helperState: connectedSnapshot.state,
    connectedServerHost: connectedServer?.host ?? null,
    expectedServerHost: server.host,
  })
  if (options.usage === 'file-browser') {
    writeTerminalError(t('terminal.fileBrowser.error.sftpHelperNotReady'))
  } else {
    writeTerminalUploadError(t('terminal.upload.error.sftpHelperNotReady'))
  }
  return null
}

function shouldForceLocalTerminalForSession(sessionId: string): boolean {
  return isRemoteManagedSession(sessionId)
}

function shouldScheduleBackgroundBind(sessionId: string): boolean {
  if (!sessionId || lifecycleDisposed) {
    return false
  }

  if (!terminal) {
    return false
  }

  if (!hasSessionInWorkspace(sessionId)) {
    return false
  }

  if (!isLocalSession(sessionId) || isRemoteManagedSession(sessionId)) {
    return false
  }

  return !shouldBindSessionNow(sessionId)
}

function resolveBackgroundBindDelay(sessionId: string): number {
  const localSessionIds = workspace.sessions.value
    .filter((session) => session.kind === 'local')
    .map((session) => session.id)
  const index = localSessionIds.indexOf(sessionId)
  const rank = index >= 0 ? index : localSessionIds.length
  const delay = BACKGROUND_BIND_BASE_DELAY_MS + rank * BACKGROUND_BIND_STEP_DELAY_MS
  return Math.min(BACKGROUND_BIND_MAX_DELAY_MS, delay)
}

function scheduleBackgroundBind(sessionId: string, reason: string): void {
  if (!shouldScheduleBackgroundBind(sessionId)) {
    return
  }

  clearBackgroundBindTimer()
  const delayMs = resolveBackgroundBindDelay(sessionId)
  backgroundBindTimer = setTimeout(() => {
    backgroundBindTimer = null
    if (!shouldScheduleBackgroundBind(sessionId)) {
      return
    }

    logSplitDebug('background bind trigger', {
      sessionId,
      reason,
      delayMs,
    })
    void bindSession(sessionId)
  }, delayMs)
}

function isRemoteSessionReady(sessionId: string): boolean {
  if (!isRemoteManagedSession(sessionId)) {
    return true
  }

  const snapshot = serverState.getSessionSnapshot(sessionId)
  return snapshot.state === 'connected' || snapshot.state === 'reconnecting'
}

function resolveTerminalShellPathForSession(sessionId: string): string | undefined {
  const boundServer = serverState.getSessionBoundServer(sessionId)
  if (boundServer && !shouldForceLocalTerminalForSession(sessionId)) {
    return undefined
  }

  const configuredShell = runtimeSettings.defaultShell.value.trim()
  return configuredShell || undefined
}

function resolveLocalStartupCwdForSession(sessionId: string): string | undefined {
  if (!shouldUseLocalPersistence(sessionId)) {
    return undefined
  }

  const hinted = sessionPathSync.cwdBySession[sessionId] ?? null
  return isLikelyPersistableLocalCwd(hinted) ? hinted : undefined
}

function toLocalShellDisplayName(raw: string | null | undefined): string | null {
  const candidate = (raw ?? '').trim().toLowerCase()
  if (!candidate) {
    return null
  }

  if (candidate.includes('zsh')) {
    return 'zsh'
  }

  if (candidate.includes('bash')) {
    return 'bash'
  }

  return null
}

function applyLocalSessionShellDisplayName(sessionId: string, localShell: string | null): void {
  const session = workspace.sessions.value.find((item) => item.id === sessionId)
  if (!session || session.kind !== 'local') {
    return
  }

  const shellName = toLocalShellDisplayName(localShell)
  workspace.updateSession(sessionId, {
    localShellName: shellName,
  })
}

function buildSshCommandForServer(server: ServerRecord): string {
  const commandParts: string[] = ['ssh']
  const privateKeyPath = server.privateKeyPath?.trim() ?? ''
  if (server.authType === 'privateKey' && privateKeyPath) {
    commandParts.push('-i', escapeShellPath(privateKeyPath))
  }

  const port = Number.isFinite(server.port) ? server.port : 22
  if (port > 0) {
    commandParts.push('-p', String(port))
  }

  commandParts.push(`${server.username}@${server.host}`)
  return commandParts.join(' ')
}

function resolveSshCommandPreview(sessionId: string): string | null {
  const boundServer = serverState.getSessionBoundServer(sessionId)
  if (!boundServer) {
    return null
  }

  return buildSshCommandForServer(boundServer)
}

async function maybeAutoRunSshConnectCommand(sessionId: string, source: string): Promise<void> {
  const forceLocal = shouldForceLocalTerminalForSession(sessionId)
  const snapshot = serverState.getSessionSnapshot(sessionId)
  const snapshotState = snapshot.state
  const boundServer = serverState.getSessionBoundServer(sessionId)
  const host = boundServer?.host?.trim() ?? ''
  const issuedAlready = sshAutoConnectCommandIssuedBySession.has(sessionId)
  const promptReady = localPromptReadyBySession.has(sessionId)

  logAutoSshDebug('auto-connect check', {
    sessionId,
    source,
    forceLocal,
    snapshotState,
    host: host || null,
    issuedAlready,
    promptReady,
  })

  if (!forceLocal) {
    logAutoSshDebug('skip: session is not force-local', {
      sessionId,
      source,
    })
    return
  }

  if (snapshotState !== 'connected' && snapshotState !== 'reconnecting') {
    logAutoSshDebug('skip: remote snapshot not ready', {
      sessionId,
      source,
      snapshotState,
    })
    return
  }

  if (!promptReady) {
    logAutoSshDebug('skip: local prompt not ready', {
      sessionId,
      source,
      snapshotState,
    })
    return
  }

  if (issuedAlready) {
    logAutoSshDebug('skip: auto-connect command already issued', {
      sessionId,
      source,
      snapshotState,
    })
    return
  }

  const command = resolveSshCommandPreview(sessionId)
  if (!command) {
    logAutoSshDebug('skip: no ssh command available', {
      sessionId,
      source,
      snapshotState,
      host: host || null,
    })
    return
  }

  const attempt = (sshAutoConnectAttemptBySession.get(sessionId) ?? 0) + 1
  sshAutoConnectAttemptBySession.set(sessionId, attempt)
  logAutoSshDebug('auto-connect write start', {
    sessionId,
    source,
    attempt,
    snapshotState,
    host: host || null,
    command,
  })

  clearAutoSshPromptSettleTimer(sessionId)
  sshAutoConnectCommandIssuedBySession.add(sessionId)

  let written = false
  try {
    written = await writeInputToSession(sessionId, `${command}\r`, {
      trackHistory: true,
      reportUnavailable: false,
    })
  } catch (error) {
    logAutoSshDebug('auto-connect write threw', {
      sessionId,
      source,
      attempt,
      error: formatError(error),
    })
  }

  if (!written) {
    sshAutoConnectCommandIssuedBySession.delete(sessionId)
    logAutoSshDebug('auto-connect write failed', {
      sessionId,
      source,
      attempt,
      snapshotState,
    })
    return
  }

  logAutoSshDebug('auto-connect write succeeded', {
    sessionId,
    source,
    attempt,
    snapshotState,
    host: host || null,
  })
  writeTerminalAuth(host ? `connect remote service ${host}` : 'connect remote service')
}

function writeSshCommandPreview(sessionId: string): void {
  if (shouldForceLocalTerminalForSession(sessionId)) {
    return
  }

  if (sessionCache.hasShownSshCommandHint(sessionId) || !terminal) {
    return
  }

  const command = resolveSshCommandPreview(sessionId)
  if (!command) {
    return
  }

  terminal.write(`\r\n\x1b[36m[connect]\x1b[0m ${command}\r\n`)
  sessionCache.markSshCommandHintShown(sessionId)
  sessionCache.appendTranscript(sessionId, `\r\n[connect] ${command}\r\n`)
}

function normalizeInitialLocalChunk(sessionId: string, chunk: string): string {
  if (!chunk) {
    return chunk
  }

  if (sessionCache.getTranscript(sessionId).length > 0) {
    return chunk
  }

  if (serverState.getSessionBoundServer(sessionId)) {
    return chunk
  }

  return chunk.replace(/^(?:\r\n|\n|\r)+/, '')
}

function renderSessionTranscript(sessionId: string): void {
  if (!terminal) {
    return
  }

  terminal.clear?.()
  const transcript = sessionCache.getTranscript(sessionId)
  if (transcript) {
    terminal.write(transcript)
    terminal.scrollToBottom?.()
  }
}

async function resolveRemoteUploadTargetCwd(sessionId: string): Promise<string | null> {
  return resolvePreferredCwdForSession(sessionId, {
    forceRemote: isSessionInSshShell(sessionId),
  })
}

interface ResolvePreferredCwdOptions {
  forceRemote?: boolean
}

async function resolvePreferredCwdForSession(
  sessionId: string,
  options: ResolvePreferredCwdOptions = {},
): Promise<string | null> {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) {
    return null
  }

  const managedRemoteSession = isRemoteManagedSession(normalizedSessionId)
  const forceRemote = options.forceRemote === true
  const isRemoteSession = forceRemote || isSessionInSshShell(normalizedSessionId)
  const storedHintedCwd = normalizeSessionCwdValue(sessionPathSync.cwdBySession[normalizedSessionId] ?? null)
  const transcriptHintedCwd = normalizeSessionCwdValue(resolvePromptCwdHintFromTranscript(normalizedSessionId))
  const hintedCwd =
    transcriptHintedCwd && (!storedHintedCwd || storedHintedCwd.startsWith('~') || isRemoteSession)
      ? transcriptHintedCwd
      : storedHintedCwd
  const hintedNeedsHomeExpansion = Boolean(isRemoteSession && hintedCwd?.startsWith('~'))
  const canRefreshRemoteByBridge = !isRemoteSession || managedRemoteSession
  const shouldRefreshCwd = canRefreshRemoteByBridge && (!isRemoteSession || !hintedCwd || hintedNeedsHomeExpansion)
  let refreshedCwd = shouldRefreshCwd
    ? normalizeSessionCwdValue(
        await sessionPathSync.refreshCwd(normalizedSessionId, {
          preferRemote: isRemoteSession && managedRemoteSession,
        })
      )
    : null

  if (hintedNeedsHomeExpansion && (!refreshedCwd || !refreshedCwd.startsWith('/'))) {
    const maxRetryAttempts = 4
    for (let attempt = 1; attempt <= maxRetryAttempts; attempt += 1) {
      await wait(120)
      refreshedCwd = normalizeSessionCwdValue(
        await sessionPathSync.refreshCwd(normalizedSessionId, {
          preferRemote: isRemoteSession && managedRemoteSession,
        })
      )
      if (refreshedCwd?.startsWith('/')) {
        break
      }
    }
  }

  const resolvedCwd = resolvePreferredSessionCwd({
    isSshSession: isRemoteSession,
    hintedCwd,
    refreshedCwd,
  })
  const remoteResolvedToHomeAlias = Boolean(isRemoteSession && resolvedCwd?.startsWith('~'))
  const absoluteFallbackCwd = [storedHintedCwd, transcriptHintedCwd, refreshedCwd].find((path) =>
    Boolean(path && path.startsWith('/'))
  )
  const finalResolvedCwd =
    remoteResolvedToHomeAlias && !managedRemoteSession
      ? null
      : remoteResolvedToHomeAlias
        ? absoluteFallbackCwd ?? null
        : resolvedCwd
  const normalizedLocalFinalCwd = !isRemoteSession
    ? normalizeLocalHostPrefixedPath(finalResolvedCwd)
    : finalResolvedCwd
  const normalizedLocalStoredHint = !isRemoteSession
    ? normalizeLocalHostPrefixedPath(storedHintedCwd)
    : storedHintedCwd
  const preferredFinalCwd =
    !isRemoteSession &&
    normalizedLocalFinalCwd?.startsWith('//') &&
    normalizedLocalStoredHint?.startsWith('/')
      ? normalizedLocalStoredHint
      : normalizedLocalFinalCwd
  const sanitizedRemoteHintCandidate =
    transcriptHintedCwd && !isLikelyLocalOnlyPathForRemote(transcriptHintedCwd) ? transcriptHintedCwd : null
  const sanitizedPreferredFinalCwd =
    isRemoteSession && !managedRemoteSession && isLikelyLocalOnlyPathForRemote(preferredFinalCwd)
      ? sanitizedRemoteHintCandidate ?? '/'
      : preferredFinalCwd
  logSplitDebug('cwd resolve preferred', {
    sessionId: normalizedSessionId,
    forceRemote,
    managedRemoteSession,
    isRemoteSession,
    storedHintedCwd,
    transcriptHintedCwd,
    hintedNeedsHomeExpansion,
    shouldRefreshCwd,
    refreshedCwd,
    resolvedCwd,
    finalResolvedCwd,
    preferredFinalCwd,
    sanitizedPreferredFinalCwd,
  })
  if (sanitizedPreferredFinalCwd !== preferredFinalCwd) {
    logFileOpenDebug('sanitize remote cwd from local-only path', {
      sessionId: normalizedSessionId,
      preferredFinalCwd: preferredFinalCwd ?? null,
      transcriptHintedCwd: transcriptHintedCwd ?? null,
      sanitizedPreferredFinalCwd,
      managedRemoteSession,
    })
  }
  return sanitizedPreferredFinalCwd
}

function toUploadPercent(completed: number, total: number): number {
  if (total <= 0) {
    return 0
  }

  return Math.min(100, Math.round((completed / total) * 100))
}

function toPathBasename(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const segments = normalized.split('/').filter((item) => item.length > 0)
  return segments.length ? segments[segments.length - 1] : ''
}

function joinRemoteFilePath(cwd: string, fileName: string): string {
  if (cwd === '/') {
    return `/${fileName}`
  }
  const normalized = cwd.replace(/\/+$/, '')
  return `${normalized}/${fileName}`
}

interface UploadTarget {
  localPath: string
  fileName: string
  displayName: string
  remotePath: string
}

function getSftpApi(): SshSftpApi | null {
  const api = (window as unknown as { electronAPI?: { ssh?: { sftp?: SshSftpApi } } }).electronAPI
  return api?.ssh?.sftp ?? null
}

function getLocalFileApi(): LocalFileApi | null {
  const target = window as Window & {
    electronAPI?: Partial<ElectronApi>
    __electronAPIBridge?: Partial<ElectronApi>
  }

  const primary = target.electronAPI?.localFile as Partial<LocalFileApi> | undefined
  const fallback = target.__electronAPIBridge?.localFile as Partial<LocalFileApi> | undefined
  const list = primary?.list ?? fallback?.list
  if (typeof list !== 'function') {
    return null
  }

  const resolved = (primary ?? fallback) as LocalFileApi
  return resolved
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

async function listLocalDirectoryEntries(absolutePath: string): Promise<LocalFileListData['entries'] | null> {
  const localFileApi = getLocalFileApi()
  if (!localFileApi?.list) {
    return null
  }

  try {
    const result = await localFileApi.list({ path: absolutePath })
    if (!result.ok) {
      return null
    }

    return result.data.entries
  } catch {
    return null
  }
}

async function collectDirectoryUploadTargets(
  directoryPath: string,
  relativePrefix: string,
  cwd: string,
  targets: UploadTarget[],
): Promise<void> {
  const entries = await listLocalDirectoryEntries(directoryPath)
  if (!entries?.length) {
    return
  }

  for (const entry of entries) {
    const entryName = entry.name.trim()
    if (!entryName) {
      continue
    }

    const entryRelativePath = joinRelativeUploadPath(relativePrefix, entryName)
    if (entry.type === 'directory') {
      await collectDirectoryUploadTargets(entry.path, entryRelativePath, cwd, targets)
      continue
    }

    if (entry.type !== 'file' && entry.type !== 'link' && entry.type !== 'unknown') {
      continue
    }

    targets.push({
      localPath: entry.path,
      fileName: toPathBasename(entry.path) || entryName,
      displayName: entryRelativePath,
      remotePath: joinRemoteFilePath(cwd, entryRelativePath),
    })
  }
}

async function insertDroppedPaths(paths: string[]): Promise<void> {
  if (!paths.length) {
    return
  }

  const insertion = formatDroppedPathsForShell(paths)
  if (!insertion) {
    return
  }

  terminal?.focus?.()
  await sendInputToBridge(insertion)
}

async function resolveUploadTargets(cwd: string, paths: string[]): Promise<UploadTarget[] | null> {
  const allTargets: UploadTarget[] = []

  for (const localPath of paths) {
    const rootName = toPathBasename(localPath)
    if (!rootName) {
      writeTerminalUploadError(`upload failed: invalid local path "${localPath}"`)
      return null
    }

    const beforeCount = allTargets.length
    const directoryEntries = await listLocalDirectoryEntries(localPath)
    if (directoryEntries !== null) {
      await collectDirectoryUploadTargets(localPath, rootName, cwd, allTargets)
      if (allTargets.length === beforeCount) {
        writeTerminalInfo(`skip empty directory: ${rootName}`)
      }
      continue
    }

    allTargets.push({
      localPath,
      fileName: rootName,
      displayName: rootName,
      remotePath: joinRemoteFilePath(cwd, rootName),
    })
  }
  return allTargets
}

async function tryUploadFile(sftp: SshSftpApi, sessionId: string, target: UploadTarget): Promise<string | null> {
  try {
    const result = await sftp.put({
      sessionId,
      localPath: target.localPath,
      remotePath: target.remotePath,
    })

    if (isSSHBridgeFailure(result)) {
      return formatBridgeFailure(result.error)
    }

    return null
  } catch (error) {
    return formatError(error)
  }
}

function confirmRetryUpload(fileName: string, reason: string): boolean {
  return window.confirm(t('terminal.upload.confirm.retryFailedFile', { fileName, reason }))
}

async function uploadDroppedPathsToRemote(
  paths: string[],
  targetCwd?: string,
  options: { sftpSessionId?: string } = {},
): Promise<boolean> {
  const activeTerminalSessionId = resolveActiveSessionId()
  if (!activeTerminalSessionId) {
    writeTerminalUploadError(t('terminal.upload.error.activeSessionUnavailable'))
    return false
  }

  const sftpSessionId = options.sftpSessionId?.trim() || activeTerminalSessionId

  const sftp = getSftpApi()
  if (!sftp?.put || !sftp?.list) {
    writeTerminalUploadError(t('terminal.upload.error.sftpApiUnavailable'))
    return false
  }

  const preferredCwd = targetCwd?.trim() ?? ''
  const cwd =
    preferredCwd ||
    (await sessionPathSync.refreshCwd(activeTerminalSessionId, {
      preferRemote: sftpSessionId !== activeTerminalSessionId || isRemoteManagedSession(activeTerminalSessionId),
    }))
  if (!cwd || !cwd.trim()) {
    writeTerminalUploadError(t('terminal.upload.error.cwdUnavailable'))
    return false
  }

  const uploadTargets = await resolveUploadTargets(cwd, paths)
  if (!uploadTargets) {
    return false
  }
  if (!uploadTargets.length) {
    return true
  }

  writeTerminalInfo(`uploading ${uploadTargets.length} file(s) to ${cwd}`)

  let processed = 0
  let succeeded = 0
  const failedFiles: string[] = []
  for (const target of uploadTargets) {
    const processingIndex = processed + 1
    const firstAttemptError = await tryUploadFile(sftp, sftpSessionId, target)
    if (!firstAttemptError) {
      succeeded += 1
      processed += 1
      const percent = toUploadPercent(processed, uploadTargets.length)
      writeTerminalInfo(`${processed}/${uploadTargets.length} (${percent}%) ${target.displayName}`)
      continue
    }

    writeTerminalUploadError(`upload failed: ${target.displayName}: ${firstAttemptError}`)
    const shouldRetry = confirmRetryUpload(target.displayName, firstAttemptError)
    if (shouldRetry) {
      writeTerminalInfo(`retry 1/1 (${processingIndex}/${uploadTargets.length}) ${target.displayName}`)
      const retryError = await tryUploadFile(sftp, sftpSessionId, target)
      if (!retryError) {
        succeeded += 1
        processed += 1
        const percent = toUploadPercent(processed, uploadTargets.length)
        writeTerminalInfo(`${processed}/${uploadTargets.length} (${percent}%) ${target.displayName} (retried)`)
        continue
      }

      writeTerminalUploadError(`retry failed: ${target.displayName}: ${retryError}`)
      failedFiles.push(target.displayName)
      processed += 1
      const percent = toUploadPercent(processed, uploadTargets.length)
      writeTerminalInfo(`${processed}/${uploadTargets.length} (${percent}%) ${target.displayName} (failed)`)
    } else {
      writeTerminalInfo(`retry skipped: ${target.displayName}`)
      failedFiles.push(target.displayName)
      processed += 1
      const percent = toUploadPercent(processed, uploadTargets.length)
      writeTerminalInfo(`${processed}/${uploadTargets.length} (${percent}%) ${target.displayName} (skipped)`)
    }
  }

  if (failedFiles.length > 0) {
    writeTerminalUploadError(`upload finished with ${failedFiles.length} failure(s): ${failedFiles.join(', ')}`)
    writeTerminalInfo(`upload summary: ${succeeded}/${uploadTargets.length} file(s) -> ${cwd}`)
    return false
  }

  writeTerminalSuccess(`upload complete: ${succeeded}/${uploadTargets.length} file(s) -> ${cwd}`)
  return true
}

function isRemoteConnectedSession(sessionId: string): boolean {
  const boundServer = serverState.getSessionBoundServer(sessionId)
  if (!boundServer) {
    return false
  }

  const snapshot = serverState.getSessionSnapshot(sessionId)
  return snapshot.state === 'connected' || snapshot.state === 'reconnecting'
}

async function handleResolvedLocalPaths(
  paths: string[],
  emptyMessage: string,
  options: { asImagePaste?: boolean } = {},
): Promise<void> {
  if (!paths.length) {
    writeTerminalError(emptyMessage)
    return
  }

  if (options.asImagePaste) {
    await pasteImagePathsForCli(paths)
    return
  }

  // Shell drag/drop always inserts paths. Remote upload is only available in file pane.
  await insertDroppedPaths(paths)
}

async function handleFileDrop(event: DragEvent): Promise<void> {
  const paths = await toDroppedAbsolutePaths(event)
  await handleResolvedLocalPaths(paths, 'drop ignored: no absolute file paths found (File.path unavailable)')
}

function normalizeDataEvent(event: unknown): { sessionId: string | null; data: string } | null {
  if (typeof event === 'string') {
    return { sessionId: null, data: event }
  }

  if (!event || typeof event !== 'object') {
    return null
  }

  const payload = event as Partial<TerminalDataEvent>
  if (typeof payload.data !== 'string') {
    return null
  }

  return { sessionId: payload.sessionId ?? null, data: payload.data }
}

function normalizeErrorEvent(event: unknown): { sessionId: string | null; error: string } | null {
  if (typeof event === 'string') {
    return { sessionId: null, error: event }
  }

  if (!event || typeof event !== 'object') {
    return null
  }

  const payload = event as Partial<TerminalErrorEvent>
  const payloadError =
    payload.error && typeof payload.error === 'object'
      ? (payload.error as { message?: unknown; detail?: unknown; code?: unknown })
      : null
  const message =
    typeof payloadError?.message === 'string'
      ? payloadError.message
      : typeof (payload as { message?: unknown }).message === 'string'
        ? ((payload as { message?: string }).message as string)
        : null

  if (!message) {
    return null
  }

  const detailSource =
    typeof payloadError?.detail === 'string'
      ? payloadError.detail
      : typeof (payload as { detail?: unknown }).detail === 'string'
        ? ((payload as { detail?: string }).detail as string)
        : ''

  const detail = detailSource && detailSource.trim() ? ` (${detailSource})` : ''
  return { sessionId: payload.sessionId ?? null, error: `${message}${detail}` }
}

function normalizeExitEvent(event: unknown): { sessionId: string | null; summary: string } | null {
  if (!event || typeof event !== 'object') {
    return null
  }

  const payload = event as Partial<{ sessionId: string; code: number | null; signal: string }>
  const summaryParts: string[] = []
  if (typeof payload.code === 'number') {
    summaryParts.push(`code=${payload.code}`)
  } else if (payload.code === null) {
    summaryParts.push('code=null')
  }

  if (typeof payload.signal === 'string' && payload.signal.trim()) {
    summaryParts.push(`signal=${payload.signal}`)
  }

  return {
    sessionId: payload.sessionId ?? null,
    summary: summaryParts.length ? summaryParts.join(', ') : 'shell closed',
  }
}

async function invokeBridge(action: string, task: () => Promise<unknown> | unknown): Promise<boolean> {
  try {
    const result = await task()
    if (isBridgeFailure(result)) {
      writeTerminalError(`${action} failed: ${formatBridgeFailure(result.error)}`)
      return false
    }
    return true
  } catch (error) {
    writeTerminalError(`${action} failed: ${formatError(error)}`)
    return false
  }
}

function attachBridgeListeners(): void {
  removeBridgeDataListener?.()
  removeBridgeDataListener = null
  removeBridgeExitListener?.()
  removeBridgeExitListener = null
  removeBridgeErrorListener?.()
  removeBridgeErrorListener = null

  const bridge = getTerminalBridge()
  if (!bridge) {
    reportMissingBridge()
    return
  }

  if (!bridge.onData) {
    writeTerminalError(t('terminal.bridge.error.onDataUnavailable'))
    return
  }

  try {
    removeBridgeDataListener = normalizeCleanup(
      bridge.onData((event) => {
        const payload = normalizeDataEvent(event)
        if (!payload || !terminal) {
          return
        }

        const payloadSessionId = payload.sessionId?.trim()
        const sessionId = payloadSessionId || activeBridgeSessionId
        if (!sessionId) {
          return
        }

        // Multiple pane components subscribe to the shared bridge stream.
        // Only the component that owns this session should handle its chunks.
        const isOwnedSessionEvent = payloadSessionId
          ? payloadSessionId === props.sessionId
          : activeBridgeSessionId === props.sessionId
        if (!isOwnedSessionEvent) {
          if (payloadSessionId && payloadSessionId === props.sessionId) {
            logSplitDebug('onData dropped by ownership guard', {
              componentSessionId: props.sessionId,
              payloadSessionId,
              activeBridgeSessionId,
            })
          }
          return
        }

        const chunk = normalizeInitialLocalChunk(sessionId, payload.data)
        if (!chunk) {
          return
        }

        if (!isRemoteManagedSession(sessionId)) {
          logLocalShellOutput(sessionId, chunk)
        }

        const skipResizePromptRedraw = shouldSkipResizePromptRedraw(sessionId, chunk)
        if (skipResizePromptRedraw) {
          logSplitDebug('skip resize prompt redraw', {
            sessionId,
            size: chunk.length,
            preview: chunk.replace(/\s+/g, ' ').slice(0, 120),
          })
          logRedrawDebug('onData dropped before write', {
            componentSessionId: props.sessionId,
            sessionId,
            payloadSessionId: payloadSessionId ?? null,
            activeBridgeSessionId,
            chunkSize: chunk.length,
            chunkPreview: formatShellOutputChunk(chunk).slice(0, 220),
          })
          return
        }

        if (
          chunk.includes('%') ||
          chunk.includes('▶') ||
          chunk.includes('~') ||
          chunk.includes('\n')
        ) {
          logSplitDebug('onData chunk', {
            componentSessionId: props.sessionId,
            sessionId,
            payloadSessionId: payloadSessionId ?? null,
            activeBridgeSessionId,
            size: chunk.length,
            preview: chunk.replace(/\s+/g, ' ').slice(0, 120),
          })
        }

        if (!firstDataLoggedBySession.has(sessionId)) {
          firstDataLoggedBySession.add(sessionId)
          logSplitDebug('term-latency first onData', {
            sessionId,
            elapsedMs: getElapsedSinceBindStart(sessionId),
            size: chunk.length,
            preview: chunk.replace(/\s+/g, ' ').slice(0, 120),
          })
        }

        sessionCache.appendTranscript(sessionId, chunk)
        maybeShowTerminalDebugHint(sessionId, chunk)
        schedulePersistLocalSessionSnapshot(sessionId)
        if (isLocalSession(sessionId)) {
          const disconnectHost = detectSshDisconnectHostFromOutput(chunk)
          if (disconnectHost) {
            popRemoteHost(sessionId, disconnectHost)
          }
        }
        if (splitCwdInheritState.hasPending(sessionId) && localPromptReadyBySession.has(sessionId)) {
          scheduleSplitInheritedCwdApply(sessionId, 'onData-streaming')
        }
        logTriggerDebug('onData trigger hook', {
          componentSessionId: props.sessionId,
          sessionId,
          payloadSessionId: payloadSessionId ?? null,
          activeBridgeSessionId,
          chunkSize: chunk.length,
        })
        void maybeRunTerminalTriggers(sessionId, chunk)

        if (sessionId !== activeBridgeSessionId) {
          return
        }

        logRedrawDebug('onData write to terminal', {
          componentSessionId: props.sessionId,
          sessionId,
          payloadSessionId: payloadSessionId ?? null,
          activeBridgeSessionId,
          chunkSize: chunk.length,
          chunkPreview: formatShellOutputChunk(chunk).slice(0, 220),
        })
        terminal.write(chunk)

        const cwdHintResult = updateCwdHintFromTerminalData(sessionId, chunk)
        if (cwdHintResult.promptDetected) {
          localPromptReadyBySession.add(sessionId)
          scheduleSplitInheritedCwdApply(sessionId, 'onData-prompt-detected')
          if (isRemoteManagedSession(sessionId)) {
            scheduleAutoSshConnectAfterPromptSettled(sessionId, 'onData-prompt-detected')
          }
        }
        if (
          isRemoteManagedSession(sessionId) &&
          localPromptReadyBySession.has(sessionId) &&
          !sshAutoConnectCommandIssuedBySession.has(sessionId)
        ) {
          scheduleAutoSshConnectAfterPromptSettled(sessionId, 'onData-streaming')
        }
        if (cwdHintResult.promptDetected && !firstPromptLoggedBySession.has(sessionId)) {
          firstPromptLoggedBySession.add(sessionId)
          logSplitDebug('term-latency first prompt-detected', {
            sessionId,
            elapsedMs: getElapsedSinceBindStart(sessionId),
          })
        }
        if (!cwdHintResult.hinted && cwdHintResult.promptDetected) {
          scheduleDelayedCwdRefresh()
        }
      })
    )
  } catch (error) {
    writeTerminalError(`onData subscribe failed: ${formatError(error)}`)
  }

  if (!bridge.onError) {
    return
  }

  if (bridge.onExit) {
    try {
      removeBridgeExitListener = normalizeCleanup(
        bridge.onExit((event) => {
          const payload = normalizeExitEvent(event)
          if (!payload) {
            return
          }

        const payloadSessionId = payload.sessionId?.trim()
        if (!payloadSessionId) {
          return
        }

        openedBridgeSessionIds.delete(payloadSessionId)
        clearDeferredResizeSync(payloadSessionId)
        lastResizeSyncAtBySession.delete(payloadSessionId)
        sessionBindStartedAtBySession.delete(payloadSessionId)
        firstDataLoggedBySession.delete(payloadSessionId)
        firstPromptLoggedBySession.delete(payloadSessionId)
        localPromptReadyBySession.delete(payloadSessionId)
        sessionPromptBuffer.delete(payloadSessionId)
        clearRemoteHostState(payloadSessionId)
        clearAutoSshRuntimeState(payloadSessionId, 'bridge-exit')
        clearSplitInheritedCwd(payloadSessionId)
        splitInheritedCwdApplyingBySession.delete(payloadSessionId)
        localEchoLineBySession.delete(payloadSessionId)
        sessionCache.clearOpenedSession(payloadSessionId)
        clearSnapshotPersistTimer(payloadSessionId)
        clearHistoryPersistTimer(payloadSessionId)
        lastTerminalDebugHintAtBySession.delete(payloadSessionId)
        if (terminalDebugHintSessionId.value === payloadSessionId) {
          dismissTerminalDebugHint()
          terminalDebugHintSessionId.value = ''
          terminalDebugHintContext.value = ''
        }
        void persistLocalSessionSnapshotNow(payloadSessionId)
        void persistLocalSessionHistoryNow(payloadSessionId)
        if (activeBridgeSessionId === payloadSessionId) {
          activeBridgeSessionId = null
          }
        })
      )
    } catch (error) {
      writeTerminalError(`onExit subscribe failed: ${formatError(error)}`)
    }
  }

  try {
    removeBridgeErrorListener = normalizeCleanup(
      bridge.onError((event) => {
        const payload = normalizeErrorEvent(event)
        if (!payload || !activeBridgeSessionId) {
          return
        }
        if (payload.sessionId && payload.sessionId !== activeBridgeSessionId) {
          return
        }
        writeTerminalError(payload.error)
      })
    )
  } catch (error) {
    writeTerminalError(`onError subscribe failed: ${formatError(error)}`)
  }
}

interface WriteInputToSessionOptions {
  trackHistory?: boolean
  reportUnavailable?: boolean
}

async function writeInputToSession(
  sessionId: string,
  data: string,
  options: WriteInputToSessionOptions = {},
): Promise<boolean> {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId || !data) {
    return false
  }

  const bridge = getTerminalBridge()
  if (!bridge) {
    if (options.reportUnavailable !== false) {
      reportMissingBridge()
    }
    return false
  }

  const writeOk = await invokeBridge('write', () => bridge.write({ sessionId: normalizedSessionId, data }))
  if (writeOk && options.trackHistory !== false) {
    collectSessionCommandHistory(normalizedSessionId, data)
  }
  return writeOk
}

async function sendInputToBridge(data: string): Promise<void> {
  const sessionId = activeBridgeSessionId
  if (!sessionId || !data) {
    if (data && !sessionId) {
      writeTerminalError(t('terminal.session.error.activeUnavailable'))
    }
    return
  }

  await writeInputToSession(sessionId, data, {
    trackHistory: true,
    reportUnavailable: true,
  })
}

async function syncResizeToBridge(): Promise<void> {
  const sessionId = activeBridgeSessionId
  if (!terminal || !sessionId) {
    return
  }

  const suppressUntil = resizeSyncSuppressedUntilBySession.get(sessionId) ?? 0
  if (suppressUntil > Date.now()) {
    logSplitDebug('resize suppressed', {
      sessionId,
      suppressUntil,
    })
    return
  }
  if (suppressUntil > 0) {
    resizeSyncSuppressedUntilBySession.delete(sessionId)
  }

  if (!isTerminalHostVisible()) {
    return
  }

  fitAddon?.fit?.()

  const bridge = getTerminalBridge()
  if (!bridge) {
    reportMissingBridge()
    return
  }

  const cols = terminal.cols
  const rows = terminal.rows
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
    return
  }

  if (lastSyncedCols === cols && lastSyncedRows === rows) {
    return
  }

  lastSyncedCols = cols
  lastSyncedRows = rows
  const resizeAt = Date.now()
  lastResizeSyncAtBySession.set(sessionId, resizeAt)
  logRedrawDebug('resize sync sent', {
    sessionId,
    cols,
    rows,
    resizeAt,
  })
  logSplitDebug('resize sync', {
    sessionId,
    cols,
    rows,
  })
  await invokeBridge('resize', () => bridge.resize({ sessionId, cols, rows }))
}

async function closeBridgeSession(sessionId: string): Promise<void> {
  await persistLocalSessionStateNow(sessionId)
  const bridge = getTerminalBridge()
  if (!bridge) {
    return
  }
  await invokeBridge('close', () => bridge.close({ sessionId }))
}

async function reopenBridgeSessionAsRemote(sessionId: string): Promise<void> {
  if (!openedBridgeSessionIds.has(sessionId)) {
    return
  }

  const bridge = getTerminalBridge()
  if (!bridge) {
    reportMissingBridge()
    return
  }

  const closed = await invokeBridge('close', () => bridge.close({ sessionId }))
  if (!closed) {
    return
  }

  openedBridgeSessionIds.delete(sessionId)
  sessionOpenedWithLocalFallback.delete(sessionId)
  if (activeBridgeSessionId === sessionId) {
    activeBridgeSessionId = null
  }

  await bindSession(sessionId)
}

async function bindSession(sessionId: string): Promise<void> {
  clearBackgroundBindTimer()
  const bridge = getTerminalBridge()
  if (!bridge) {
    reportMissingBridge()
    activeBridgeSessionId = null
    return
  }

  sessionBindStartedAtBySession.set(sessionId, nowMs())
  firstDataLoggedBySession.delete(sessionId)
  firstPromptLoggedBySession.delete(sessionId)
  localPromptReadyBySession.delete(sessionId)
  clearAutoSshPromptSettleTimer(sessionId)
  clearSplitInheritedCwdSettleTimer(sessionId)

  const bindingVersion = ++sessionBindingVersion
  const previousSessionId = activeBridgeSessionId
  logSplitDebug('bind start', {
    componentSessionId: props.sessionId,
    targetSessionId: sessionId,
    previousSessionId,
    bindingVersion,
    alreadyOpenedInComponent: openedBridgeSessionIds.has(sessionId),
    alreadyOpenedGlobal: sessionCache.hasOpenedSession(sessionId),
    isActiveSession: workspace.activeSessionId.value === sessionId,
  })
  logSplitDebug('term-latency bind start', {
    sessionId,
    bindingVersion,
  })

  if (previousSessionId === sessionId) {
    // Keep the existing xterm buffer untouched when refocusing the same session.
    // Replaying transcript here can visually alter prompt/layout after pane switches.
    logSplitDebug('bind skip same session', {
      sessionId,
    })
    scheduleResizeSyncToBridge({ immediate: true })
    if (!isRemoteManagedSession(sessionId)) {
      void sessionPathSync.refreshCwd(sessionId)
    }
    return
  }

  if (previousSessionId && previousSessionId !== sessionId) {
    activeBridgeSessionId = null
  }

  if (lifecycleDisposed || bindingVersion !== sessionBindingVersion) {
    return
  }

  await hydrateLocalSessionFromPersistence(sessionId)
  if (lifecycleDisposed || bindingVersion !== sessionBindingVersion) {
    return
  }

  let attachedToExistingSession = false
  if (!openedBridgeSessionIds.has(sessionId)) {
    if (sessionCache.hasOpenedSession(sessionId)) {
      openedBridgeSessionIds.add(sessionId)
      attachedToExistingSession = true
      resizeSyncSuppressedUntilBySession.set(sessionId, Date.now() + 180)
      scheduleDeferredResizeSync(sessionId, 240)
      logSplitDebug('bind attach existing session', {
        sessionId,
      })
    } else {
      const openedWhileRemoteNotReady = false
      const openStartedAt = nowMs()
      let opened = false
      let openedLocalShell: string | null = null
      try {
        const openResult = await bridge.open({
          sessionId,
          cols: terminal?.cols,
          rows: terminal?.rows,
          shellPath: resolveTerminalShellPathForSession(sessionId),
          cwd: resolveLocalStartupCwdForSession(sessionId),
          forceLocal: shouldForceLocalTerminalForSession(sessionId),
        })
        if (isBridgeFailure(openResult)) {
          writeTerminalError(`open failed: ${formatBridgeFailure(openResult.error)}`)
        } else {
          opened = true
          const payload = (openResult as { data?: unknown }).data
          const localShell =
            payload && typeof payload === 'object' && 'localShell' in payload
              ? (payload as { localShell?: unknown }).localShell
              : null
          openedLocalShell = typeof localShell === 'string' ? localShell : null
        }
      } catch (error) {
        writeTerminalError(`open failed: ${formatError(error)}`)
      }
      logSplitDebug('term-latency open call finished', {
        sessionId,
        opened,
        elapsedMs: Math.max(0, Math.round(nowMs() - openStartedAt)),
        openedWhileRemoteNotReady,
      })
      if (!opened) {
        logSplitDebug('bind open failed', { sessionId })
        return
      }

      openedBridgeSessionIds.add(sessionId)
      sessionCache.markOpenedSession(sessionId)
      applyLocalSessionShellDisplayName(sessionId, openedLocalShell)
      sessionOpenedWithLocalFallback.delete(sessionId)
      logSplitDebug('bind open new session', {
        sessionId,
        openedWhileRemoteNotReady,
      })

      await maybeAutoRunSshConnectCommand(sessionId, 'bind-open-new')
    }
  }

  if (lifecycleDisposed || bindingVersion !== sessionBindingVersion) {
    openedBridgeSessionIds.delete(sessionId)
    sessionPromptBuffer.delete(sessionId)
    resetLocalEchoLine(sessionId)
    return
  }

  activeBridgeSessionId = sessionId
  renderSessionTranscript(sessionId)
  logSplitDebug('term-latency render transcript', {
    sessionId,
    elapsedMs: getElapsedSinceBindStart(sessionId),
    transcriptLength: sessionCache.getTranscript(sessionId).length,
  })
  writeSshCommandPreview(sessionId)
  await maybeAutoRunSshConnectCommand(sessionId, 'bind-finished')
  scheduleSplitInheritedCwdApply(sessionId, 'bind-finished')
  if (!attachedToExistingSession) {
    scheduleResizeSyncToBridge({ immediate: true })
  }
  logSplitDebug('bind done', {
    sessionId,
    attachedToExistingSession,
    transcriptLength: sessionCache.getTranscript(sessionId).length,
  })

  void (async () => {
    await applyDefaultDirectoryForSession(sessionId)
    if (
      !isRemoteManagedSession(sessionId) &&
      !isLikelyPersistableLocalCwd(sessionPathSync.cwdBySession[sessionId] ?? null)
    ) {
      await sessionPathSync.refreshCwd(sessionId)
    }
    logSplitDebug('term-latency post-bind async finished', {
      sessionId,
      elapsedMs: getElapsedSinceBindStart(sessionId),
    })
  })()
}

async function bootTerminal(): Promise<void> {
  if (!mountEl.value) {
    return
  }

  try {
    const terminalModule = await import('xterm')
    const TerminalCtor = (terminalModule as { Terminal?: new (options?: unknown) => TerminalLike }).Terminal
    if (!TerminalCtor) {
      throw new Error('xterm module loaded without Terminal constructor')
    }

    const appearanceOptions = resolveTerminalAppearanceOptions()
    terminal = new TerminalCtor({
      cursorBlink: true,
      convertEol: false,
      fontSize: appearanceOptions.fontSize,
      lineHeight: appearanceOptions.lineHeight,
      cursorStyle: appearanceOptions.cursorStyle,
      fontFamily: appearanceOptions.fontFamily,
      theme: appearanceOptions.theme,
    })

    terminal.open(mountEl.value)
    terminal.attachCustomKeyEventHandler?.((event) => {
      if (event.type === 'keydown' && event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        event.stopPropagation()
        if (aiCommandBarVisible.value) {
          closeAICommandBar()
        } else {
          dismissTerminalDebugHint()
          void ensureAICommandBarReady()
        }
        return false
      }
      // 命令栏打开时，只有焦点在命令栏内才拦截按键；点击 shell 后焦点在终端，应允许输入
      if (aiCommandBarVisible.value && aiCommandBarEl.value?.contains(document.activeElement)) {
        return false
      }
      if (event.type !== 'keydown') {
        return true
      }
      return true
    })

    try {
      const fitModule = await import('xterm-addon-fit')
      const FitAddonCtor = (fitModule as { FitAddon?: new () => { fit?: () => void } }).FitAddon
      if (FitAddonCtor) {
        fitAddon = new FitAddonCtor()
        terminal.loadAddon?.(fitAddon)
      }
    } catch {
      // Optional addon; skip when not installed.
    }

    try {
      const webLinksModule = await import('@xterm/addon-web-links')
      const WebLinksAddonCtor = (webLinksModule as { WebLinksAddon?: new (handler?: (event: MouseEvent, uri: string) => void) => { dispose?: () => void } }).WebLinksAddon
      if (WebLinksAddonCtor) {
        const shellApi = (window as Window & { electronAPI?: { shell?: { openExternal: (url: string) => Promise<unknown> } }; __electronAPIBridge?: { shell?: { openExternal: (url: string) => Promise<unknown> } } }).electronAPI?.shell ?? (window as Window & { __electronAPIBridge?: { shell?: { openExternal: (url: string) => Promise<unknown> } } }).__electronAPIBridge?.shell
        webLinksAddon = new WebLinksAddonCtor((event: MouseEvent, uri: string) => {
          if (event.metaKey || event.ctrlKey) {
            shellApi?.openExternal(uri).catch(() => {})
          }
        })
        terminal.loadAddon?.(webLinksAddon)
      }
    } catch {
      // Optional addon; skip when not installed.
    }

    xtermInputSubscription = terminal.onData?.((data) => {
      void sendInputToBridge(data)
      if (data.includes('\r') || data.includes('\n')) {
        scheduleDelayedCwdRefresh()
      }
    }) ?? null

    attachBridgeListeners()
    if (shouldBindSessionNow(props.sessionId)) {
      await bindSession(props.sessionId)
      focusTerminalIfActive(props.sessionId)
    } else {
      renderSessionTranscript(props.sessionId)
      scheduleBackgroundBind(props.sessionId, 'boot-inactive')
    }

    resizeObserver = new ResizeObserver(() => {
      scheduleResizeSyncToBridge()
    })
    resizeObserver.observe(mountEl.value)

    const clickHandler = () => {
      terminal?.focus?.()
      hideContextMenu()
    }
    const contextMenuHandler = (event: MouseEvent) => {
      const selectedText = getCurrentTerminalSelectionText()
      terminal?.focus?.()
      showContextMenu(event, selectedText)
    }
    const dragenterHandler = (event: DragEvent) => {
      if (!isFileDropEvent(event)) {
        return
      }

      event.preventDefault()
      hideContextMenu()
    }
    const dragoverHandler = (event: DragEvent) => {
      if (!isFileDropEvent(event)) {
        return
      }

      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy'
      }
    }
    const dropHandler = (event: DragEvent) => {
      if (!isFileDropEvent(event)) {
        return
      }

      event.preventDefault()
      hideContextMenu()
      void handleFileDrop(event)
    }
    const pasteHandler = (event: ClipboardEvent) => {
      const clipboardData = event.clipboardData
      const hasImageItems = Array.from(clipboardData?.items ?? []).some(
        (item) => item.kind === 'file' && item.type.startsWith('image/'),
      )
      const clipboardFiles = extractClipboardFiles(event.clipboardData)
      if (hasImageItems) {
        event.preventDefault()
        hideContextMenu()
        void (async () => {
          const imagePaths = await resolveImagePathsFromClipboardData(clipboardData)
          if (imagePaths.length) {
            await handleResolvedLocalPaths(imagePaths, 'paste ignored: no absolute file paths found', {
              asImagePaste: true,
            })
            return
          }

          const paths = await resolveAbsolutePathsFromFiles(clipboardFiles)
          await handleResolvedLocalPaths(paths, 'paste ignored: no absolute file paths found', {
            asImagePaste: true,
          })
        })()
        return
      }

      if (clipboardFiles.length) {
        event.preventDefault()
        hideContextMenu()
        void (async () => {
          const paths = await resolveAbsolutePathsFromFiles(clipboardFiles)
          await handleResolvedLocalPaths(paths, 'paste ignored: no absolute file paths found')
        })()
        return
      }

      const text = event.clipboardData?.getData('text')
      if (typeof text !== 'string' || text.length === 0) {
        // Some clipboard sources do not expose image blobs on event.clipboardData.
        // Reuse the async clipboard path to support image paste in shell (e.g. Codex CLI input).
        event.preventDefault()
        hideContextMenu()
        void pasteFromClipboard()
        return
      }

      event.preventDefault()
      hideContextMenu()
      void pasteTextWithGuards(text)
    }
    const wheelHandler = (event: WheelEvent) => {
      adjustTerminalFontSizeByWheel(event)
    }
    const legacyWheelHandler = (event: Event) => {
      adjustTerminalFontSizeByWheel(event as WheelEvent)
    }
    const documentWheelHandler = (event: WheelEvent) => {
      const host = mountEl.value
      if (!host) {
        return
      }

      const target = event.target as Node | null
      if (target && !host.contains(target) && !pointerInsideTerminalHost) {
        return
      }

      adjustTerminalFontSizeByWheel(event)
    }
    const windowWheelHandler = (event: WheelEvent) => {
      const host = mountEl.value
      if (!host) {
        return
      }

      const target = event.target as Node | null
      if (target && !host.contains(target) && !pointerInsideTerminalHost) {
        return
      }

      adjustTerminalFontSizeByWheel(event)
    }
    const pointerEnterHandler = () => {
      pointerInsideTerminalHost = true
    }
    const pointerLeaveHandler = () => {
      pointerInsideTerminalHost = false
    }

    mountEl.value.addEventListener('click', clickHandler)
    mountEl.value.addEventListener('contextmenu', contextMenuHandler)
    mountEl.value.addEventListener('dragenter', dragenterHandler)
    mountEl.value.addEventListener('dragover', dragoverHandler)
    mountEl.value.addEventListener('drop', dropHandler)
    mountEl.value.addEventListener('paste', pasteHandler, true)
    mountEl.value.addEventListener('pointerenter', pointerEnterHandler)
    mountEl.value.addEventListener('pointerleave', pointerLeaveHandler)
    mountEl.value.addEventListener('wheel', wheelHandler, { passive: false, capture: true })
    mountEl.value.addEventListener('mousewheel', legacyWheelHandler, { passive: false, capture: true })
    hostInteractionCleanup = () => {
      mountEl.value?.removeEventListener('click', clickHandler)
      mountEl.value?.removeEventListener('contextmenu', contextMenuHandler)
      mountEl.value?.removeEventListener('dragenter', dragenterHandler)
      mountEl.value?.removeEventListener('dragover', dragoverHandler)
      mountEl.value?.removeEventListener('drop', dropHandler)
      mountEl.value?.removeEventListener('paste', pasteHandler, true)
      mountEl.value?.removeEventListener('pointerenter', pointerEnterHandler)
      mountEl.value?.removeEventListener('pointerleave', pointerLeaveHandler)
      mountEl.value?.removeEventListener('wheel', wheelHandler, true)
      mountEl.value?.removeEventListener('mousewheel', legacyWheelHandler as EventListener, true)
    }

    document.addEventListener('wheel', documentWheelHandler, {
      passive: false,
      capture: true,
    })
    document.addEventListener('mousewheel', legacyWheelHandler as EventListener, {
      passive: false,
      capture: true,
    })
    removeDocumentWheelListener = () => {
      document.removeEventListener('wheel', documentWheelHandler, true)
      document.removeEventListener('mousewheel', legacyWheelHandler as EventListener, true)
    }

    window.addEventListener('wheel', windowWheelHandler, { passive: false, capture: true })
    removeWindowWheelListener = () => {
      window.removeEventListener('wheel', windowWheelHandler, true)
    }

    const pointerDownHandler = (event: PointerEvent) => {
      if (!contextMenuState.visible) {
        return
      }
      const target = event.target as Node | null
      if (target && contextMenuEl.value?.contains(target)) {
        return
      }
      hideContextMenu()
    }

    const keydownHandler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.key === 'Meta' || event.key === 'Control') {
        zoomModifierPressed = true
      }
      if (event.key === 'Escape') {
        hideContextMenu()
      }
    }
    const keyupHandler = (event: KeyboardEvent) => {
      zoomModifierPressed = event.metaKey || event.ctrlKey
      if (event.key === 'Meta' || event.key === 'Control') {
        zoomModifierPressed = false
      }
    }
    const blurHandler = () => {
      zoomModifierPressed = false
    }

    document.addEventListener('pointerdown', pointerDownHandler)
    removeDocumentPointerDownListener = () => {
      document.removeEventListener('pointerdown', pointerDownHandler)
    }
    document.addEventListener('keydown', keydownHandler)
    removeDocumentKeydownListener = () => {
      document.removeEventListener('keydown', keydownHandler)
    }
    document.addEventListener('keyup', keyupHandler)
    removeDocumentKeyupListener = () => {
      document.removeEventListener('keyup', keyupHandler)
    }
    window.addEventListener('blur', blurHandler)
    removeWindowBlurListener = () => {
      window.removeEventListener('blur', blurHandler)
    }
  } catch (error) {
    fallbackMode.value = true
    const message = error instanceof Error ? error.message : 'Unknown initialization error'
    fallbackReason.value = `xterm renderer failed: ${message}`
  }
}

function disposeTerminal(): void {
  hideContextMenu()
  clearDelayedCwdRefreshTimer()
  clearSnapshotPersistTimer()
  clearHistoryPersistTimer()
  clearTerminalTriggerRuntimeState()
  clearBackgroundBindTimer()
  clearDeferredResizeSync()
  clearResizeSyncScheduler()
  clearFontZoomHintTimer()
  fontZoomHint.value = ''
  lastSyncedCols = null
  lastSyncedRows = null
  xtermInputSubscription?.dispose()
  xtermInputSubscription = null
  removeBridgeDataListener?.()
  removeBridgeDataListener = null
  removeBridgeExitListener?.()
  removeBridgeExitListener = null
  removeBridgeErrorListener?.()
  removeBridgeErrorListener = null
  hostInteractionCleanup?.()
  hostInteractionCleanup = null
  removeDocumentPointerDownListener?.()
  removeDocumentPointerDownListener = null
  removeDocumentKeydownListener?.()
  removeDocumentKeydownListener = null
  removeDocumentKeyupListener?.()
  removeDocumentKeyupListener = null
  removeDocumentWheelListener?.()
  removeDocumentWheelListener = null
  removeWindowWheelListener?.()
  removeWindowWheelListener = null
  removeWindowBlurListener?.()
  removeWindowBlurListener = null
  zoomModifierPressed = false
  pointerInsideTerminalHost = false
  aiCommandBarVisible.value = false
  resizeObserver?.disconnect()
  resizeObserver = null
  fitAddon = null
  webLinksAddon?.dispose?.()
  webLinksAddon = null
  terminal?.dispose()
  terminal = null
}

watch(
  () => workspace.sessions.value.map((session) => session.id),
  (sessionIds) => {
    const activeIds = new Set(sessionIds)
    for (const openedSessionId of Array.from(openedBridgeSessionIds)) {
      if (activeIds.has(openedSessionId)) {
        continue
      }

      void persistLocalSessionStateNow(openedSessionId)
      openedBridgeSessionIds.delete(openedSessionId)
      clearDeferredResizeSync(openedSessionId)
      lastResizeSyncAtBySession.delete(openedSessionId)
      sessionBindStartedAtBySession.delete(openedSessionId)
      firstDataLoggedBySession.delete(openedSessionId)
      firstPromptLoggedBySession.delete(openedSessionId)
      localPromptReadyBySession.delete(openedSessionId)
      sessionPromptBuffer.delete(openedSessionId)
      clearRemoteHostState(openedSessionId)
      void disposeRemoteUploadHelperSessions(openedSessionId)
      clearAutoSshRuntimeState(openedSessionId, 'session-removed-watch')
      clearSplitInheritedCwd(openedSessionId)
      splitInheritedCwdApplyingBySession.delete(openedSessionId)
      clearTerminalTriggerRuntimeState(openedSessionId)
      sessionOpenedWithLocalFallback.delete(openedSessionId)
      clearSnapshotPersistTimer(openedSessionId)
      clearHistoryPersistTimer(openedSessionId)
      sessionCommandHistory.delete(openedSessionId)
      sessionPendingInput.delete(openedSessionId)
      lastTerminalDebugHintAtBySession.delete(openedSessionId)
      if (terminalDebugHintSessionId.value === openedSessionId) {
        dismissTerminalDebugHint()
        terminalDebugHintSessionId.value = ''
        terminalDebugHintContext.value = ''
      }
      resetLocalEchoLine(openedSessionId)
      sessionCache.clearTranscript(openedSessionId)
      sessionCache.clearSshCommandHint(openedSessionId)
      sessionCache.clearOpenedSession(openedSessionId)
      sessionCache.clearHydratedPersistedState(openedSessionId)
      if (activeBridgeSessionId === openedSessionId) {
        activeBridgeSessionId = null
      }
      void closeBridgeSession(openedSessionId)
    }
  },
  { deep: false }
)

watch(
  () => props.sessionId,
  (sessionId) => {
    if (!terminal) {
      return
    }

    if (shouldBindSessionNow(sessionId)) {
      void bindSession(sessionId)
      return
    }

    if (terminalDebugHintSessionId.value && terminalDebugHintSessionId.value !== sessionId) {
      dismissTerminalDebugHint()
      terminalDebugHintSessionId.value = ''
      terminalDebugHintContext.value = ''
    }
    activeBridgeSessionId = null
    renderSessionTranscript(sessionId)
    scheduleBackgroundBind(sessionId, 'session-changed')
  }
)

watch(
  () => workspace.activeSessionId.value,
  (activeId) => {
    if (!activeId || activeId !== props.sessionId) {
      scheduleBackgroundBind(props.sessionId, 'active-session-changed')
      return
    }
    clearBackgroundBindTimer()
    void bindSession(activeId).then(() => {
      focusTerminalIfActive(activeId)
    })
  }
)

watch(
  () => {
    const snapshotState = serverState.getSessionSnapshot(props.sessionId).state
    return `${isRemoteManagedSession(props.sessionId) ? '1' : '0'}:${snapshotState}`
  },
  () => {
    sessionOpenedWithLocalFallback.delete(props.sessionId)
    if (!terminal || !isRemoteManagedSession(props.sessionId)) {
      return
    }
    void maybeAutoRunSshConnectCommand(props.sessionId, 'remote-state-watch')
  }
)

watch(
  [
    () => uiSettings.theme.value,
    () => uiSettings.fontSize.value,
    () => uiSettings.lineHeight.value,
    () => uiSettings.cursorStyle.value,
    () => runtimeSettings.fontFamily.value,
  ],
  () => {
    applyTerminalAppearanceOptions()
  },
  { immediate: false }
)

watch(
  () =>
    triggerState.rules.value
      .map((rule) => `${rule.id}|${rule.enabled ? '1' : '0'}|${rule.autoSend ? '1' : '0'}|${rule.pattern}|${rule.sendText}`)
      .join('\u001f'),
  () => {
    clearTerminalTriggerRuntimeState()
    logTriggerDebug('rules changed -> runtime state reset', {
      ruleCount: triggerState.rules.value.length,
    })
  },
  { immediate: true },
)

onMounted(() => {
  logTriggerDebug('mounted', {
    sessionId: props.sessionId,
    ruleCount: triggerState.rules.value.length,
  })
  void bootTerminal()
})

onBeforeUnmount(() => {
  lifecycleDisposed = true
  sessionBindingVersion += 1
  aiCommandBarResizeCleanup?.()
  aiCommandBarResizeCleanup = null
  clearContextSubmenuHideTimer()
  for (const openedSessionId of Array.from(openedBridgeSessionIds)) {
    void persistLocalSessionStateNow(openedSessionId)
    if (!hasSessionInWorkspace(openedSessionId)) {
      void closeBridgeSession(openedSessionId)
      sessionCache.clearTranscript(openedSessionId)
      sessionCache.clearSshCommandHint(openedSessionId)
      sessionCache.clearOpenedSession(openedSessionId)
      sessionCache.clearHydratedPersistedState(openedSessionId)
    }
    sessionPromptBuffer.delete(openedSessionId)
    lastResizeSyncAtBySession.delete(openedSessionId)
    sessionBindStartedAtBySession.delete(openedSessionId)
    firstDataLoggedBySession.delete(openedSessionId)
    firstPromptLoggedBySession.delete(openedSessionId)
    localPromptReadyBySession.delete(openedSessionId)
    sessionOpenedWithLocalFallback.delete(openedSessionId)
    if (!hasSessionInWorkspace(openedSessionId)) {
      clearRemoteHostState(openedSessionId)
    }
    void disposeRemoteUploadHelperSessions(openedSessionId)
    clearAutoSshRuntimeState(openedSessionId, 'component-unmount')
    clearSplitInheritedCwd(openedSessionId)
    splitInheritedCwdApplyingBySession.delete(openedSessionId)
    resizeSyncSuppressedUntilBySession.delete(openedSessionId)
    clearDeferredResizeSync(openedSessionId)
    clearSnapshotPersistTimer(openedSessionId)
    clearHistoryPersistTimer(openedSessionId)
    sessionCommandHistory.delete(openedSessionId)
    sessionPendingInput.delete(openedSessionId)
    lastTerminalDebugHintAtBySession.delete(openedSessionId)
    if (terminalDebugHintSessionId.value === openedSessionId) {
      dismissTerminalDebugHint()
      terminalDebugHintSessionId.value = ''
      terminalDebugHintContext.value = ''
    }
    resetLocalEchoLine(openedSessionId)
  }
  openedBridgeSessionIds.clear()
  activeBridgeSessionId = null
  disposeTerminal()
})
</script>

<template>
  <section ref="xtermShellEl" class="xterm-shell">
    <div ref="mountEl" class="xterm-host" />
    <div v-if="fontZoomHint" class="font-zoom-hint">{{ fontZoomHint }}</div>
    <div v-if="terminalDebugHintVisible" class="terminal-debug-hint">
      <span class="terminal-debug-hint__text">{{ t('terminal.debugHint.detected') }}</span>
      <div class="terminal-debug-hint__actions">
        <button type="button" class="terminal-debug-hint__action" @click="void onDebugWithNovar()">
          {{ t('terminal.debugHint.action') }}
        </button>
        <button
          type="button"
          class="terminal-debug-hint__dismiss"
          :aria-label="t('terminal.debugHint.dismissAria')"
          @click="dismissTerminalDebugHint"
        >
          ×
        </button>
      </div>
    </div>
    <div
      v-if="contextMenuState.visible"
      ref="contextMenuEl"
      class="terminal-context-menu"
      :style="{ left: `${contextMenuState.x}px`, top: `${contextMenuState.y}px` }"
      role="menu"
    >
      <button
        v-if="contextMenuSelectedText.trim()"
        type="button"
        role="menuitem"
        @click="void handleContextMenuAction('ai-explain')"
      >
        {{ t('terminal.menu.aiExplain') }}
      </button>
      <button type="button" role="menuitem" @click="void handleContextMenuAction('copy')">
        {{ t('terminal.menu.copy') }}
      </button>
      <button type="button" role="menuitem" @click="void handleContextMenuAction('paste')">
        {{ t('terminal.menu.paste') }}
      </button>
      <button type="button" role="menuitem" @click="void handleContextMenuAction('clear')">
        {{ t('terminal.menu.clear') }}
      </button>
      <button type="button" role="menuitem" @click="void handleContextMenuAction('split-horizontal')">
        {{ t('terminal.menu.splitHorizontal') }}
      </button>
      <button type="button" role="menuitem" @click="void handleContextMenuAction('split-vertical')">
        {{ t('terminal.menu.splitVertical') }}
      </button>
      <div
        class="terminal-context-menu__submenu"
        @mouseenter="showServerSubmenu('new-tab')"
        @mouseleave="hideServerSubmenu"
      >
        <button type="button" role="menuitem" class="terminal-context-menu__submenu-trigger">
          <span>{{ t('terminal.menu.newTab') }}</span>
          <span class="terminal-context-menu__submenu-arrow">›</span>
        </button>
        <div
          v-if="contextServerSubmenu === 'new-tab'"
          class="terminal-context-submenu"
          :class="{ left: contextServerSubmenuDirection === 'left' }"
          role="menu"
        >
          <p v-if="serverState.loading.value && contextMenuServerList.length === 0" class="terminal-context-submenu__hint">
            {{ t('terminal.menu.loadingServers') }}
          </p>
          <p v-else-if="contextMenuServerList.length === 0" class="terminal-context-submenu__hint">
            {{ t('terminal.menu.noServers') }}
          </p>
          <button
            v-for="server in contextMenuServerList"
            :key="`new-tab-${server.id}`"
            type="button"
            role="menuitem"
            class="terminal-context-submenu__item"
            @click="void handleServerSubmenuAction('new-tab', server.id)"
          >
            <span>{{ formatServerMenuMeta(server) }}</span>
          </button>
        </div>
      </div>
      <div
        class="terminal-context-menu__submenu"
        @mouseenter="showServerSubmenu('new-pane')"
        @mouseleave="hideServerSubmenu"
      >
        <button type="button" role="menuitem" class="terminal-context-menu__submenu-trigger">
          <span>{{ t('terminal.menu.newPane') }}</span>
          <span class="terminal-context-menu__submenu-arrow">›</span>
        </button>
        <div
          v-if="contextServerSubmenu === 'new-pane'"
          class="terminal-context-submenu"
          :class="{ left: contextServerSubmenuDirection === 'left' }"
          role="menu"
        >
          <p v-if="serverState.loading.value && contextMenuServerList.length === 0" class="terminal-context-submenu__hint">
            {{ t('terminal.menu.loadingServers') }}
          </p>
          <p v-else-if="newPaneContextMenuList.length === 0" class="terminal-context-submenu__hint">
            {{ t('terminal.menu.noServers') }}
          </p>
          <button
            v-for="item in newPaneContextMenuList"
            :key="`new-pane-${item.id}`"
            type="button"
            role="menuitem"
            class="terminal-context-submenu__item"
            @click="void handleServerSubmenuAction('new-pane', item.id)"
          >
            <span>{{ item.label }}</span>
          </button>
        </div>
      </div>
      <div
        v-if="canShowConnectServerSubmenu()"
        class="terminal-context-menu__submenu"
        @mouseenter="showServerSubmenu('connect-shell')"
        @mouseleave="hideServerSubmenu"
      >
        <button type="button" role="menuitem" class="terminal-context-menu__submenu-trigger">
          <span>{{ t('terminal.menu.connectServer') }}</span>
          <span class="terminal-context-menu__submenu-arrow">›</span>
        </button>
        <div
          v-if="contextServerSubmenu === 'connect-shell'"
          class="terminal-context-submenu"
          :class="{ left: contextServerSubmenuDirection === 'left' }"
          role="menu"
        >
          <p v-if="serverState.loading.value && contextMenuServerList.length === 0" class="terminal-context-submenu__hint">
            {{ t('terminal.menu.loadingServers') }}
          </p>
          <p v-else-if="contextMenuServerList.length === 0" class="terminal-context-submenu__hint">
            {{ t('terminal.menu.noServers') }}
          </p>
          <button
            v-for="server in contextMenuServerList"
            :key="`connect-shell-${server.id}`"
            type="button"
            role="menuitem"
            class="terminal-context-submenu__item"
            @click="void handleServerSubmenuAction('connect-shell', server.id)"
          >
            <span>{{ formatServerMenuMeta(server) }}</span>
          </button>
        </div>
      </div>
      <button type="button" role="menuitem" @click="void handleContextMenuAction('open-dir')">
        {{ t('terminal.menu.openInFileBrowserCurrentDir') }}
      </button>
    </div>
    <div v-if="fallbackMode" class="xterm-fallback">
      <p>{{ fallbackReason }}</p>
      <p>Terminal UI stays responsive; check renderer/main logs for details.</p>
    </div>
    <div
      v-if="aiCommandBarVisible"
      ref="aiCommandBarEl"
      class="ai-command-bar"
      :style="aiCommandBarHeightStyle"
      @keydown="onAICommandBarKeydown"
    >
      <div
        class="ai-command-bar__resize-handle"
        :title="t('terminal.aiBar.resizeHandleTitle')"
        @mousedown.prevent.stop="startAICommandBarResize($event)"
      />
      <div class="ai-command-bar__header">
        <div class="ai-command-bar__header-left">
          <span class="ai-command-bar__title">{{ t('terminal.aiBar.title') }}</span>
          <select
            v-model="aiSelectedModelTargetId"
            class="ai-command-bar__model-select"
            :aria-label="t('terminal.aiBar.modelSelectAria')"
            :disabled="aiCommandBarLoading"
            @change="void onAIModelTargetChange()"
          >
            <option v-for="target in aiModelTargets" :key="target.id" :value="target.id">
              {{ target.label }}
            </option>
          </select>
          <span
            v-if="SHOW_AI_RESPONSE_LANGUAGE_DEBUG"
            class="ai-command-bar__lang-debug"
          >
            Lang: {{ aiResponseLanguage }}
          </span>
        </div>
        <button
          type="button"
          class="ai-command-bar__close"
          :aria-label="t('terminal.aiBar.closeAria')"
          @click="closeAICommandBar"
        >
          ×
        </button>
      </div>
      <div ref="aiCommandBarContentEl" class="ai-command-bar__content">
        <div class="ai-command-bar__messages">
          <template v-for="(msg, i) in aiCommandBarMessages" :key="i">
            <div :class="['ai-command-bar__msg', `ai-command-bar__msg--${msg.role}`]">
              <div v-if="msg.role === 'user' && msg.displayCard" class="ai-command-bar__msg-content">
                <div class="ai-command-bar__user-card">
                  <p class="ai-command-bar__user-card-title">{{ msg.displayCard.title }}</p>
                  <div
                    v-for="(section, sectionIndex) in msg.displayCard.sections"
                    :key="`user-card-section-${i}-${sectionIndex}`"
                    class="ai-command-bar__user-card-section"
                  >
                    <span class="ai-command-bar__user-card-label">{{ section.label }}</span>
                    <pre class="ai-command-bar__user-card-value">{{ section.value }}</pre>
                  </div>
                </div>
              </div>
              <div v-else class="ai-command-bar__msg-content">{{ msg.content }}</div>
              <div
                v-if="msg.role === 'assistant' && msg.isCommand && msg.commandText"
                class="ai-command-bar__cmd-actions"
              >
                <button type="button" class="ai-command-bar__cmd-btn" @click="void onAICmdRun(msg.commandText!)">
                  {{ t('terminal.aiBar.action.run') }}
                </button>
                <button type="button" class="ai-command-bar__cmd-btn" @click="void onAICmdInsert(msg.commandText!)">
                  {{ t('terminal.aiBar.action.insert') }}
                </button>
                <button type="button" class="ai-command-bar__cmd-btn" @click="onAICmdExpand(msg.commandText!)">
                  {{ t('terminal.aiBar.action.expand') }}
                </button>
              </div>
            </div>
          </template>
          <div
            v-if="aiCommandBarLoading || aiCommandBarStreamingReply"
            class="ai-command-bar__msg ai-command-bar__msg--assistant"
          >
            <div class="ai-command-bar__msg-content">
              <span v-if="aiCommandBarLoading && !aiCommandBarStreamingReply" class="ai-command-bar__loading">{{ t('terminal.aiBar.loading') }}</span>
              <span v-else class="ai-command-bar__response-text">{{ aiCommandBarStreamingReply }}</span>
            </div>
            <div
              v-if="!aiCommandBarLoading && aiCommandBarLastErrorCode === 'quota_exceeded'"
              class="ai-command-bar__quota-hint"
            >
              <span class="ai-command-bar__quota-hint-text">{{ t('terminal.aiBar.error.quotaExceededActionHint') }}</span>
              <button type="button" class="ai-command-bar__quota-hint-btn" @click="openAIModelSettings">
                {{ t('terminal.aiBar.error.addModelNow') }}
              </button>
            </div>
          </div>
          <p v-if="aiCommandBarMessages.length === 0 && !aiCommandBarLoading && !aiCommandBarStreamingReply" class="ai-command-bar__placeholder">—</p>
        </div>
      </div>
      <div class="ai-command-bar__input-row">
        <textarea
          ref="aiCommandBarInputEl"
          v-model="aiCommandBarInput"
          class="ai-command-bar__input"
          :placeholder="t('terminal.aiBar.inputPlaceholder')"
          rows="2"
          @keydown.enter.exact="onAICommandBarEnter"
          @keydown.escape.prevent.stop="closeAICommandBar"
        />
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.xterm-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 4px;
  background: var(--term-bg, #0b1220);
}

.xterm-host {
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.xterm-shell :deep(.xterm) {
  width: 100%;
  height: 100%;
}

.xterm-shell :deep(.xterm .xterm-viewport) {
  background-color: var(--term-bg, #0b1220) !important;
  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-track {
    background-color: var(--term-scrollbar-bg, #0b1220);
  }

  &::-webkit-scrollbar-thumb {
    background-color: transparent;
    border-radius: 4px;

    &:hover {
      background-color: var(--term-scrollbar-thumb-hover, #475569) !important;
    }

    &:active {
      background-color: var(--term-scrollbar-thumb-active, #64748b) !important;
    }
  }
}

.xterm-shell:hover :deep(.xterm .xterm-viewport::-webkit-scrollbar-thumb) {
  background-color: var(--term-scrollbar-thumb, #334155);
}

.font-zoom-hint {
  position: absolute;
  right: 10px;
  top: 10px;
  z-index: 2900;
  pointer-events: none;
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid #334155;
  background: rgba(2, 6, 23, 0.84);
  color: #e2e8f0;
  font-size: 12px;
  line-height: 24px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    'Courier New', monospace;
}

.terminal-debug-hint {
  position: absolute;
  left: 10px;
  top: 10px;
  z-index: 2895;
  max-width: min(70%, 720px);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid rgba(251, 146, 60, 0.45);
  background: rgba(67, 20, 7, 0.92);
  color: #ffedd5;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
}

.terminal-debug-hint__text {
  font-size: 12px;
  line-height: 1.3;
  word-break: break-word;
}

.terminal-debug-hint__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.terminal-debug-hint__action {
  height: 24px;
  padding: 0 8px;
  border: 1px solid rgba(253, 186, 116, 0.55);
  border-radius: 6px;
  background: rgba(251, 146, 60, 0.2);
  color: #ffedd5;
  font-size: 12px;
  cursor: pointer;
}

.terminal-debug-hint__action:hover {
  background: rgba(251, 146, 60, 0.3);
}

.terminal-debug-hint__dismiss {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #fdba74;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.terminal-debug-hint__dismiss:hover {
  background: rgba(253, 186, 116, 0.16);
  color: #ffedd5;
}

.xterm-fallback {
  position: absolute;
  inset: 12px;
  display: grid;
  align-content: center;
  gap: 8px;
  margin: 0;
  border: 1px dashed #334155;
  color: #cbd5e1;
  background: rgba(15, 23, 42, 0.9);
  padding: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    'Courier New', monospace;
  font-size: 12px;
}

.xterm-fallback p {
  margin: 0;
}

.ai-command-bar {
  position: relative;
  flex: 0 0 50%;
  min-height: 100px;
  max-height: 50%;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.96);
  border: 1px solid #334155;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.ai-command-bar__resize-handle {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 6px;
  z-index: 2;
  cursor: ns-resize;
  background: transparent;
  user-select: none;
  -webkit-user-select: none;
  transition: background 0.15s;
}

.ai-command-bar__resize-handle:hover {
  background: rgba(148, 163, 184, 0.3);
}

.ai-command-bar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-shrink: 0;
  padding-top: 4px;
}

.ai-command-bar__header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.ai-command-bar__title {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 600;
  color: #94a3b8;
  letter-spacing: 0.02em;
}

.ai-command-bar__model-select {
  height: 26px;
  max-width: 300px;
  min-width: 180px;
  padding: 0 8px;
  border: 1px solid #475569;
  border-radius: 6px;
  background: rgba(30, 41, 59, 0.85);
  color: #e2e8f0;
  font-size: 12px;
  outline: none;
}

.ai-command-bar__model-select:disabled {
  opacity: 0.65;
}

.ai-command-bar__lang-debug {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  border: 1px solid #334155;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.75);
  color: #94a3b8;
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
}

.ai-command-bar__close {
  padding: 2px 6px;
  font-size: 18px;
  line-height: 1;
  color: #94a3b8;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}

.ai-command-bar__close:hover {
  color: #e2e8f0;
  background: rgba(255, 255, 255, 0.08);
}

.ai-command-bar__content {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
}

.ai-command-bar__messages {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 2px 0;
}

.ai-command-bar__msg {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ai-command-bar__msg-content {
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
  color: #e2e8f0;
}

.ai-command-bar__msg--user .ai-command-bar__msg-content {
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(59, 130, 246, 0.18);
  border: 1px solid rgba(96, 165, 250, 0.35);
}

.ai-command-bar__user-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-command-bar__user-card-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #dbeafe;
}

.ai-command-bar__user-card-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ai-command-bar__user-card-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #bfdbfe;
}

.ai-command-bar__user-card-value {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.45;
  color: #eff6ff;
  font-family: inherit;
}

.ai-command-bar__cmd-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.ai-command-bar__cmd-btn {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  color: #94a3b8;
  background: rgba(51, 65, 85, 0.6);
  border: 1px solid #475569;
  border-radius: 4px;
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}

.ai-command-bar__cmd-btn:hover {
  color: #e2e8f0;
  background: rgba(71, 85, 105, 0.7);
  border-color: #64748b;
}

.ai-command-bar__input-row {
  flex-shrink: 0;
}

.ai-command-bar__input {
  width: 100%;
  padding: 6px 8px;
  font-size: 13px;
  line-height: 1.45;
  color: #e2e8f0;
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid #334155;
  border-radius: 6px;
  resize: none;
  font-family: inherit;
  box-sizing: border-box;
}

.ai-command-bar__input::placeholder {
  color: #64748b;
}

.ai-command-bar__input:focus {
  outline: none;
  border-color: #475569;
}

.ai-command-bar__response-text {
  display: block;
}

.ai-command-bar__loading {
  color: #94a3b8;
}

.ai-command-bar__quota-hint {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ai-command-bar__quota-hint-text {
  font-size: 12px;
  color: #cbd5e1;
}

.ai-command-bar__quota-hint-btn {
  height: 24px;
  padding: 0 10px;
  border: 1px solid #3b82f6;
  border-radius: 6px;
  background: rgba(37, 99, 235, 0.2);
  color: #dbeafe;
  font-size: 12px;
  cursor: pointer;
}

.ai-command-bar__quota-hint-btn:hover {
  background: rgba(37, 99, 235, 0.32);
  border-color: #60a5fa;
}

.ai-command-bar__placeholder {
  margin: 0;
  font-size: 13px;
  color: #64748b;
}

.ai-command-bar__hint {
  margin: 0;
  flex-shrink: 0;
  font-size: 11px;
  color: #64748b;
}

.terminal-context-menu {
  position: fixed;
  z-index: 3000;
  min-width: 198px;
  display: grid;
  gap: 1px;
  padding: 5px;
  border: 1px solid rgba(114, 122, 135, 0.36);
  border-radius: 10px;
  background: rgba(246, 247, 249, 0.94);
  backdrop-filter: saturate(160%) blur(14px);
  box-shadow:
    0 14px 32px rgba(15, 23, 42, 0.22),
    0 2px 8px rgba(15, 23, 42, 0.12);
}

.terminal-context-menu button {
  height: 28px;
  border: 0;
  border-radius: 6px;
  text-align: left;
  color: #273142;
  background: transparent;
  padding: 0 10px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 450;
  line-height: 1;
}

.terminal-context-menu button:hover {
  background: #2f7cf6;
  color: #ffffff;
}

.terminal-context-menu__submenu {
  position: relative;
}

.terminal-context-menu__submenu-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.terminal-context-menu__submenu-arrow {
  color: #667085;
  font-size: 12px;
  line-height: 1;
}

.terminal-context-menu__submenu-trigger:hover .terminal-context-menu__submenu-arrow {
  color: #ffffff;
}

.terminal-context-submenu {
  position: absolute;
  left: calc(100% + 2px);
  top: 0;
  width: 280px;
  max-height: 320px;
  overflow: auto;
  z-index: 3001;
  display: grid;
  gap: 1px;
  padding: 5px;
  border: 1px solid rgba(114, 122, 135, 0.36);
  border-radius: 10px;
  background: rgba(246, 247, 249, 0.96);
  backdrop-filter: saturate(160%) blur(14px);
  box-shadow:
    0 14px 32px rgba(15, 23, 42, 0.22),
    0 2px 8px rgba(15, 23, 42, 0.12);
}

.terminal-context-submenu.left {
  left: auto;
  right: calc(100% + 2px);
}

.terminal-context-submenu__item {
  height: 30px !important;
  min-height: 30px;
  padding: 0 10px !important;
  display: flex;
  align-items: center;
}

.terminal-context-submenu__item span {
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.terminal-context-submenu__hint {
  margin: 0;
  padding: 8px 10px;
  color: #667085;
  font-size: 12px;
}
</style>
