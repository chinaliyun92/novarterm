import { computed, reactive, ref, watch } from 'vue'
import {
  createDefaultSessionTitle,
  reorderSessionsById,
  type ReorderSessionsPayload,
} from '../../../shared/utils/terminal-smoke'
import type {
  CloseConfirmState,
  SplitDirection,
  SplitLayoutLeafNode,
  SplitLayoutNode,
  SplitPane,
  SplitState,
  TerminalSession,
  TerminalSessionKind,
  TerminalWorkspaceTab,
} from '../types/terminal'

interface CreateSessionOptions {
  title?: string
  activate?: boolean
  kind?: TerminalSessionKind
}

interface LegacySplitState {
  enabled: boolean
  direction: SplitDirection
  primarySessionId: string | null
  secondarySessionId: string | null
  focusedPane: SplitPane
}

interface PersistedWorkspaceState {
  version: 2
  tabs: TerminalWorkspaceTab[]
  sessions: TerminalSession[]
  activeTabId: string | null
  activeSessionId: string | null
}

interface LegacyPersistedWorkspaceState {
  sessions: TerminalSession[]
  activeSessionId: string | null
  split: LegacySplitState | SplitState
}

type WorkspaceStateSource = 'electron' | 'local'

let sessionSequence = 1
let paneSequence = 1
let tabSequence = 1
const WORKSPACE_STORAGE_KEY = 'terminal-workspace-state:v1'
const WORKSPACE_SETTINGS_KEY = 'terminal-workspace-state:v1'
const MAX_SPLIT_PANES = 6
const MAX_TABS = 6
const MIN_SPLIT_RATIO = 0.1
const MAX_SPLIT_RATIO = 0.9
const PERSIST_DEBOUNCE_MS = 260
const SPLIT_DEBUG_STORAGE_KEY = 'iterm.split-debug'

function isSplitDebugEnabled(): boolean {
  return false
}

function logSplitDebug(event: string, detail?: Record<string, unknown>): void {
  if (!isSplitDebugEnabled()) {
    return
  }

  const timestamp = new Date().toISOString()
  if (detail) {
    console.log(`[split-debug][workspace][${timestamp}] ${event}`, detail)
    return
  }

  console.log(`[split-debug][workspace][${timestamp}] ${event}`)
}

type WorkspacePersistenceMode = 'pending' | 'electron' | 'local'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isValidSplitDirection(value: unknown): value is SplitDirection {
  return value === 'horizontal' || value === 'vertical'
}

function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5
  }

  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, value))
}

function isValidSession(value: unknown): value is TerminalSession {
  if (!isRecord(value)) {
    return false
  }

  const rawKind = (value as { kind?: unknown }).kind
  const kindValid = rawKind === undefined || rawKind === 'local' || rawKind === 'ssh' || rawKind === 'file'
  const rawLocalShellName = (value as { localShellName?: unknown }).localShellName
  const localShellNameValid =
    rawLocalShellName === undefined || rawLocalShellName === null || typeof rawLocalShellName === 'string'
  const rawSshHost = (value as { sshHost?: unknown }).sshHost
  const sshHostValid = rawSshHost === undefined || rawSshHost === null || typeof rawSshHost === 'string'
  const rawFilePaneSourceKind = (value as { filePaneSourceKind?: unknown }).filePaneSourceKind
  const filePaneSourceKindValid =
    rawFilePaneSourceKind === undefined ||
    rawFilePaneSourceKind === null ||
    rawFilePaneSourceKind === 'local' ||
    rawFilePaneSourceKind === 'ssh'

  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.title === 'string' &&
    value.title.trim().length > 0 &&
    kindValid &&
    (typeof value.tabId === 'string' || value.tabId === undefined) &&
    localShellNameValid &&
    sshHostValid &&
    ((value as { filePanePath?: unknown }).filePanePath === undefined ||
      (value as { filePanePath?: unknown }).filePanePath === null ||
      typeof (value as { filePanePath?: unknown }).filePanePath === 'string') &&
    filePaneSourceKindValid &&
    ((value as { filePaneSourceSessionId?: unknown }).filePaneSourceSessionId === undefined ||
      (value as { filePaneSourceSessionId?: unknown }).filePaneSourceSessionId === null ||
      typeof (value as { filePaneSourceSessionId?: unknown }).filePaneSourceSessionId === 'string') &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt) &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt) &&
    typeof value.hasPendingInput === 'boolean'
  )
}

function isValidSplitLayoutNode(value: unknown): value is SplitLayoutNode {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0 || typeof value.type !== 'string') {
    return false
  }

  if (value.type === 'leaf') {
    return typeof value.sessionId === 'string' && value.sessionId.length > 0
  }

  if (value.type === 'branch') {
    if (!isValidSplitDirection(value.direction)) {
      return false
    }

    const splitRatio = (value as { splitRatio?: unknown }).splitRatio
    if (
      splitRatio !== undefined &&
      (typeof splitRatio !== 'number' || !Number.isFinite(splitRatio) || splitRatio <= 0 || splitRatio >= 1)
    ) {
      return false
    }

    return isValidSplitLayoutNode(value.first) && isValidSplitLayoutNode(value.second)
  }

  return false
}

function isValidSplitState(value: unknown): value is SplitState {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.enabled === 'boolean' &&
    isValidSplitDirection(value.direction) &&
    (value.root === null || isValidSplitLayoutNode(value.root)) &&
    (typeof value.focusedPaneId === 'string' || value.focusedPaneId === null) &&
    typeof value.maxPanes === 'number' &&
    Number.isFinite(value.maxPanes) &&
    value.maxPanes >= 1
  )
}

function isValidLegacySplitState(value: unknown): value is LegacySplitState {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.enabled === 'boolean' &&
    isValidSplitDirection(value.direction) &&
    (typeof value.primarySessionId === 'string' || value.primarySessionId === null) &&
    (typeof value.secondarySessionId === 'string' || value.secondarySessionId === null) &&
    (value.focusedPane === 'primary' || value.focusedPane === 'secondary')
  )
}

function isValidWorkspaceTab(value: unknown): value is Omit<TerminalWorkspaceTab, 'split'> & { split: unknown } {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.title === 'string' &&
    value.title.trim().length > 0 &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt) &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt)
  )
}

function normalizeSession(value: TerminalSession, fallbackTabId: string): TerminalSession {
  const rawKind = (value as { kind?: unknown }).kind
  const kind: TerminalSessionKind = rawKind === 'file' ? 'file' : 'local'

  const rawTabId = (value as { tabId?: unknown }).tabId
  const tabId = typeof rawTabId === 'string' && rawTabId.trim() ? rawTabId.trim() : fallbackTabId
  const rawFilePanePath = (value as { filePanePath?: unknown }).filePanePath
  const rawLocalShellName = (value as { localShellName?: unknown }).localShellName
  const rawSshHost = (value as { sshHost?: unknown }).sshHost
  const rawFilePaneSourceKind = (value as { filePaneSourceKind?: unknown }).filePaneSourceKind
  const rawFilePaneSourceSessionId = (value as { filePaneSourceSessionId?: unknown }).filePaneSourceSessionId

  const localShellName =
    typeof rawLocalShellName === 'string' && rawLocalShellName.trim() ? rawLocalShellName.trim() : null
  const sshHost =
    kind !== 'file' ? null : typeof rawSshHost === 'string' && rawSshHost.trim() ? rawSshHost.trim() : null
  const filePanePath =
    typeof rawFilePanePath === 'string' && rawFilePanePath.trim() ? rawFilePanePath.trim() : null
  const filePaneSourceKind =
    rawFilePaneSourceKind === 'local' || rawFilePaneSourceKind === 'ssh' ? rawFilePaneSourceKind : null
  const filePaneSourceSessionId =
    typeof rawFilePaneSourceSessionId === 'string' && rawFilePaneSourceSessionId.trim()
      ? rawFilePaneSourceSessionId.trim()
      : null

  return {
    ...value,
    kind,
    localShellName,
    sshHost,
    filePanePath,
    filePaneSourceKind,
    filePaneSourceSessionId,
    tabId,
  }
}

function filterRestorableSessions(sessions: TerminalSession[]): TerminalSession[] {
  return sessions.filter((session) => {
    if (session.kind === 'file' && session.filePaneSourceKind === 'ssh') {
      return false
    }

    if (session.kind !== 'file' && session.sshHost?.trim()) {
      return false
    }

    return true
  })
}

function createPaneId(): string {
  return `pane-${Date.now()}-${paneSequence++}`
}

function createTabId(): string {
  return `tab-${Date.now()}-${tabSequence++}`
}

function createLeafNode(sessionId: string, id = createPaneId()): SplitLayoutLeafNode {
  return {
    id,
    type: 'leaf',
    sessionId,
  }
}

function createBranchNode(
  direction: SplitDirection,
  first: SplitLayoutNode,
  second: SplitLayoutNode,
  splitRatio = 0.5,
  id = createPaneId(),
): SplitLayoutNode {
  return {
    id,
    type: 'branch',
    direction,
    splitRatio: clampSplitRatio(splitRatio),
    first,
    second,
  }
}

function cloneLayoutNode(node: SplitLayoutNode): SplitLayoutNode {
  if (node.type === 'leaf') {
    return { ...node }
  }

  return {
    ...node,
    first: cloneLayoutNode(node.first),
    second: cloneLayoutNode(node.second),
  }
}

function collectLeafNodes(node: SplitLayoutNode | null): SplitLayoutLeafNode[] {
  if (!node) {
    return []
  }

  if (node.type === 'leaf') {
    return [node]
  }

  return [...collectLeafNodes(node.first), ...collectLeafNodes(node.second)]
}

function findLeafById(node: SplitLayoutNode | null, paneId: string): SplitLayoutLeafNode | null {
  if (!node) {
    return null
  }

  if (node.type === 'leaf') {
    return node.id === paneId ? node : null
  }

  return findLeafById(node.first, paneId) ?? findLeafById(node.second, paneId)
}

function findLeafBySessionId(node: SplitLayoutNode | null, sessionId: string): SplitLayoutLeafNode | null {
  if (!node) {
    return null
  }

  if (node.type === 'leaf') {
    return node.sessionId === sessionId ? node : null
  }

  return findLeafBySessionId(node.first, sessionId) ?? findLeafBySessionId(node.second, sessionId)
}

function replaceLeafNodeById(
  node: SplitLayoutNode,
  paneId: string,
  replacement: SplitLayoutNode,
): { node: SplitLayoutNode; replaced: boolean } {
  if (node.type === 'leaf') {
    if (node.id !== paneId) {
      return { node, replaced: false }
    }

    return {
      node: replacement,
      replaced: true,
    }
  }

  const updatedFirst = replaceLeafNodeById(node.first, paneId, replacement)
  if (updatedFirst.replaced) {
    return {
      node: {
        ...node,
        first: updatedFirst.node,
      },
      replaced: true,
    }
  }

  const updatedSecond = replaceLeafNodeById(node.second, paneId, replacement)
  if (updatedSecond.replaced) {
    return {
      node: {
        ...node,
        second: updatedSecond.node,
      },
      replaced: true,
    }
  }

  return { node, replaced: false }
}

function removeLeafNodeById(
  node: SplitLayoutNode,
  paneId: string,
): { node: SplitLayoutNode | null; removed: boolean } {
  if (node.type === 'leaf') {
    if (node.id !== paneId) {
      return { node, removed: false }
    }

    return {
      node: null,
      removed: true,
    }
  }

  const updatedFirst = removeLeafNodeById(node.first, paneId)
  if (updatedFirst.removed) {
    if (!updatedFirst.node) {
      return {
        node: node.second,
        removed: true,
      }
    }

    return {
      node: {
        ...node,
        first: updatedFirst.node,
      },
      removed: true,
    }
  }

  const updatedSecond = removeLeafNodeById(node.second, paneId)
  if (updatedSecond.removed) {
    if (!updatedSecond.node) {
      return {
        node: node.first,
        removed: true,
      }
    }

    return {
      node: {
        ...node,
        second: updatedSecond.node,
      },
      removed: true,
    }
  }

  return { node, removed: false }
}

function updateBranchSplitRatioById(
  node: SplitLayoutNode,
  branchId: string,
  splitRatio: number,
): { node: SplitLayoutNode; updated: boolean } {
  if (node.type === 'leaf') {
    return { node, updated: false }
  }

  if (node.id === branchId) {
    const currentRatio = clampSplitRatio(node.splitRatio ?? 0.5)
    if (Math.abs(currentRatio - splitRatio) < 0.0005) {
      return { node, updated: false }
    }

    return {
      node: {
        ...node,
        splitRatio,
      },
      updated: true,
    }
  }

  const updatedFirst = updateBranchSplitRatioById(node.first, branchId, splitRatio)
  if (updatedFirst.updated) {
    return {
      node: {
        ...node,
        first: updatedFirst.node,
      },
      updated: true,
    }
  }

  const updatedSecond = updateBranchSplitRatioById(node.second, branchId, splitRatio)
  if (updatedSecond.updated) {
    return {
      node: {
        ...node,
        second: updatedSecond.node,
      },
      updated: true,
    }
  }

  return { node, updated: false }
}

function pruneInvalidLeafNodes(node: SplitLayoutNode | null, validSessionIds: Set<string>): SplitLayoutNode | null {
  if (!node) {
    return null
  }

  if (node.type === 'leaf') {
    if (!validSessionIds.has(node.sessionId)) {
      return null
    }

    return { ...node }
  }

  const first = pruneInvalidLeafNodes(node.first, validSessionIds)
  const second = pruneInvalidLeafNodes(node.second, validSessionIds)

  if (!first && !second) {
    return null
  }

  if (!first) {
    return second
  }

  if (!second) {
    return first
  }

  return {
    ...node,
    first,
    second,
  }
}

function trimLayoutToLimit(node: SplitLayoutNode, maxLeafCount: number): SplitLayoutNode {
  let next = node

  while (collectLeafNodes(next).length > maxLeafCount) {
    const leaves = collectLeafNodes(next)
    const overflowLeaf = leaves[leaves.length - 1]
    if (!overflowLeaf) {
      break
    }

    const removed = removeLeafNodeById(next, overflowLeaf.id)
    if (!removed.node) {
      break
    }

    next = removed.node
  }

  return next
}

function createDefaultSplitState(sessionId: string | null = null): SplitState {
  const root = sessionId ? createLeafNode(sessionId) : null
  return {
    enabled: false,
    direction: 'horizontal',
    root,
    focusedPaneId: root?.id ?? null,
    maxPanes: MAX_SPLIT_PANES,
  }
}

function cloneSplitState(state: SplitState): SplitState {
  return {
    enabled: state.enabled,
    direction: state.direction,
    root: state.root ? cloneLayoutNode(state.root) : null,
    focusedPaneId: state.focusedPaneId,
    maxPanes: state.maxPanes,
  }
}

function restoreSplitState(raw: unknown, sessions: TerminalSession[], preferredSessionId: string | null): SplitState {
  const fallbackSessionId =
    (preferredSessionId && sessions.some((item) => item.id === preferredSessionId)
      ? preferredSessionId
      : sessions[0]?.id) ?? null

  if (!fallbackSessionId) {
    return createDefaultSplitState(null)
  }

  const validSessionIds = new Set(sessions.map((item) => item.id))

  if (isValidSplitState(raw)) {
    const maxPanes = Math.max(1, Math.min(MAX_SPLIT_PANES, Math.floor(raw.maxPanes)))
    let root = raw.root ? pruneInvalidLeafNodes(raw.root, validSessionIds) : null

    if (!root) {
      root = createLeafNode(fallbackSessionId)
    }

    root = trimLayoutToLimit(root, maxPanes)
    const leaves = collectLeafNodes(root)
    const focusedPaneId =
      typeof raw.focusedPaneId === 'string' && leaves.some((leaf) => leaf.id === raw.focusedPaneId)
        ? raw.focusedPaneId
        : leaves[0]?.id ?? null

    return {
      enabled: leaves.length > 1,
      direction: raw.direction,
      root,
      focusedPaneId,
      maxPanes,
    }
  }

  if (isValidLegacySplitState(raw)) {
    const primarySessionId = raw.primarySessionId && validSessionIds.has(raw.primarySessionId)
      ? raw.primarySessionId
      : fallbackSessionId

    if (
      raw.enabled &&
      raw.secondarySessionId &&
      validSessionIds.has(raw.secondarySessionId) &&
      raw.secondarySessionId !== primarySessionId
    ) {
      const primaryLeaf = createLeafNode(primarySessionId)
      const secondaryLeaf = createLeafNode(raw.secondarySessionId)

      return {
        enabled: true,
        direction: raw.direction,
        root: createBranchNode(raw.direction, primaryLeaf, secondaryLeaf),
        focusedPaneId: raw.focusedPane === 'secondary' ? secondaryLeaf.id : primaryLeaf.id,
        maxPanes: MAX_SPLIT_PANES,
      }
    }

    return createDefaultSplitState(primarySessionId)
  }

  return createDefaultSplitState(fallbackSessionId)
}

function createSessionRecord(
  index: number,
  tabId: string,
  title?: string,
  kind: TerminalSessionKind = 'local',
): TerminalSession {
  const now = Date.now()
  return {
    id: `session-${now}-${sessionSequence++}`,
    title: title?.trim() || createDefaultSessionTitle(index),
    kind,
    localShellName: null,
    sshHost: null,
    filePanePath: null,
    filePaneSourceKind: null,
    filePaneSourceSessionId: null,
    tabId,
    createdAt: now,
    updatedAt: now,
    hasPendingInput: false,
  }
}

function createTabRecord(index: number, title?: string, split?: SplitState): TerminalWorkspaceTab {
  const now = Date.now()
  return {
    id: createTabId(),
    title: title?.trim() || createDefaultSessionTitle(index),
    createdAt: now,
    updatedAt: now,
    split: split ? cloneSplitState(split) : createDefaultSplitState(null),
  }
}

function parsePersistedWorkspaceState(raw: string): PersistedWorkspaceState | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isRecord(parsed)) {
    return null
  }

  const candidateActiveSessionId =
    typeof parsed.activeSessionId === 'string' || parsed.activeSessionId === null ? parsed.activeSessionId : null

  const parsedSessions = parsed.sessions
  if (!Array.isArray(parsedSessions) || !parsedSessions.every((item) => isValidSession(item))) {
    return null
  }

  const normalizedSessions = filterRestorableSessions(
    parsedSessions.map((item) => normalizeSession(item as TerminalSession, '')),
  )

  if (Array.isArray(parsed.tabs) && parsed.tabs.every((item) => isValidWorkspaceTab(item))) {
    const tabCandidates = parsed.tabs as Array<Omit<TerminalWorkspaceTab, 'split'> & { split: unknown }>

    const tabs: TerminalWorkspaceTab[] = []
    const sessions: TerminalSession[] = []

    for (const candidate of tabCandidates) {
      const tabId = candidate.id
      const tabSessions = normalizedSessions
        .filter((session) => session.tabId === tabId)
        .map((session) => ({ ...session, tabId }))

      if (!tabSessions.length) {
        continue
      }

      const split = restoreSplitState(candidate.split, tabSessions, candidateActiveSessionId)
      tabs.push({
        id: tabId,
        title: candidate.title,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
        split,
      })
      sessions.push(...tabSessions)
    }

    if (!tabs.length || !sessions.length) {
      return null
    }

    const limitedTabs = tabs.slice(0, MAX_TABS)
    const limitedTabIds = new Set(limitedTabs.map((tab) => tab.id))
    const limitedSessions = sessions.filter((session) => limitedTabIds.has(session.tabId))

    if (!limitedTabs.length || !limitedSessions.length) {
      return null
    }

    const activeTabId =
      typeof parsed.activeTabId === 'string' && limitedTabs.some((tab) => tab.id === parsed.activeTabId)
        ? parsed.activeTabId
        : limitedTabs[0]?.id ?? null

    const activeTab = limitedTabs.find((tab) => tab.id === activeTabId) ?? null
    const activeSessionId =
      typeof candidateActiveSessionId === 'string' &&
      activeTab &&
      limitedSessions.some((session) => session.id === candidateActiveSessionId && session.tabId === activeTab.id)
        ? candidateActiveSessionId
        : collectLeafNodes(activeTab?.split.root ?? null)[0]?.sessionId ?? null

    return {
      version: 2,
      tabs: limitedTabs,
      sessions: limitedSessions,
      activeTabId,
      activeSessionId,
    }
  }

  if (!('split' in parsed)) {
    return null
  }

  const legacy = parsed as unknown as LegacyPersistedWorkspaceState
  const normalizedActiveSessionId =
    typeof legacy.activeSessionId === 'string' || legacy.activeSessionId === null ? legacy.activeSessionId : null

  const visibleLegacySessions = normalizedSessions.filter((session) => {
    const rawHidden = (session as TerminalSession & { hiddenInTabs?: unknown }).hiddenInTabs
    return rawHidden !== true
  })

  const seedSessions = visibleLegacySessions.length ? visibleLegacySessions : normalizedSessions
  if (!seedSessions.length) {
    return null
  }

  const tabs: TerminalWorkspaceTab[] = []
  const sessions: TerminalSession[] = []

  for (const seed of seedSessions) {
    if (tabs.length >= MAX_TABS) {
      break
    }

    const tab = createTabRecord(tabs.length + 1, seed.title)
    const session: TerminalSession = {
      ...seed,
      tabId: tab.id,
    }

    tab.split = createDefaultSplitState(session.id)
    tabs.push(tab)
    sessions.push(session)
  }

  const activeSession =
    sessions.find((session) => session.id === normalizedActiveSessionId) ?? sessions[0]
  const activeTabId = activeSession?.tabId ?? tabs[0]?.id ?? null

  return {
    version: 2,
    tabs,
    sessions,
    activeTabId,
    activeSessionId: activeSession?.id ?? null,
  }
}

function toWorkspaceStateFreshnessScore(state: PersistedWorkspaceState): number {
  const tabMax = state.tabs.reduce((maxValue, tab) => Math.max(maxValue, tab.updatedAt), 0)
  const sessionMax = state.sessions.reduce((maxValue, session) => Math.max(maxValue, session.updatedAt), 0)
  return Math.max(tabMax, sessionMax, 0)
}

function pickPreferredWorkspaceState(
  settingsState: PersistedWorkspaceState | null,
  localState: PersistedWorkspaceState | null,
): { state: PersistedWorkspaceState | null; source: WorkspaceStateSource | null } {
  if (!settingsState && !localState) {
    return { state: null, source: null }
  }

  if (settingsState && !localState) {
    return { state: settingsState, source: 'electron' }
  }

  if (!settingsState && localState) {
    return { state: localState, source: 'local' }
  }

  const settingsScore = toWorkspaceStateFreshnessScore(settingsState as PersistedWorkspaceState)
  const localScore = toWorkspaceStateFreshnessScore(localState as PersistedWorkspaceState)
  if (localScore > settingsScore) {
    return { state: localState as PersistedWorkspaceState, source: 'local' }
  }

  return { state: settingsState as PersistedWorkspaceState, source: 'electron' }
}

function getWorkspaceStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

function getElectronSettingsApi(): SettingsApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  const candidate = (window as unknown as { electronAPI?: Partial<ElectronApi> }).electronAPI
  if (!candidate || !candidate.settings) {
    return null
  }

  const { settings } = candidate
  if (typeof settings.get !== 'function' || typeof settings.set !== 'function') {
    return null
  }

  return settings as SettingsApi
}

function createWorkspaceState() {
  const workspaceStorage = getWorkspaceStorage()
  const electronSettingsApi = getElectronSettingsApi()
  const persistenceMode = ref<WorkspacePersistenceMode>('pending')
  const isRestoring = ref(true)
  let persistTimer: ReturnType<typeof setTimeout> | null = null

  const tabs = ref<TerminalWorkspaceTab[]>([])
  const sessions = ref<TerminalSession[]>([])
  const activeTabSessionId = ref<string | null>(null)
  const activeSessionId = ref<string | null>(null)

  const split = reactive<SplitState>(createDefaultSplitState(null))

  const closeConfirm = reactive<CloseConfirmState>({
    open: false,
    sessionId: null,
  })

  const tabSessions = computed(() => tabs.value)
  const canCreateMoreTabs = computed(() => tabs.value.length < MAX_TABS)

  const activeTab = computed(() => {
    return tabs.value.find((tab) => tab.id === activeTabSessionId.value) ?? null
  })

  const activeSession = computed(() => {
    return sessions.value.find((item) => item.id === activeSessionId.value) ?? null
  })

  const canSplitMore = computed(() => {
    const tab = activeTab.value
    if (!tab) {
      return false
    }

    return collectLeafNodes(tab.split.root).length < tab.split.maxPanes
  })

  const primarySession = computed(() => {
    const tab = activeTab.value
    if (!tab) {
      return null
    }

    const primarySessionId = collectLeafNodes(tab.split.root)[0]?.sessionId
    if (!primarySessionId) {
      return null
    }

    return sessions.value.find((item) => item.id === primarySessionId) ?? null
  })

  const secondarySession = computed(() => {
    const tab = activeTab.value
    if (!tab) {
      return null
    }

    const secondarySessionId = collectLeafNodes(tab.split.root)[1]?.sessionId
    if (!secondarySessionId) {
      return null
    }

    return sessions.value.find((item) => item.id === secondarySessionId) ?? null
  })

  function getSessionsByTabId(tabId: string): TerminalSession[] {
    return sessions.value.filter((session) => session.tabId === tabId)
  }

  function findSessionById(id: string): TerminalSession | undefined {
    return sessions.value.find((item) => item.id === id)
  }

  function findTabById(id: string): TerminalWorkspaceTab | undefined {
    return tabs.value.find((item) => item.id === id)
  }

  function findTabBySessionId(sessionId: string): TerminalWorkspaceTab | undefined {
    const session = findSessionById(sessionId)
    if (!session) {
      return undefined
    }

    return findTabById(session.tabId)
  }

  function touchSession(sessionId: string): void {
    const target = findSessionById(sessionId)
    if (target) {
      target.updatedAt = Date.now()
    }
  }

  function touchTab(tabId: string): void {
    const target = findTabById(tabId)
    if (target) {
      target.updatedAt = Date.now()
    }
  }

  function syncActiveSplitView(): void {
    const tab = activeTab.value
    if (!tab) {
      const fallback = createDefaultSplitState(null)
      split.enabled = fallback.enabled
      split.direction = fallback.direction
      split.root = fallback.root
      split.focusedPaneId = fallback.focusedPaneId
      split.maxPanes = fallback.maxPanes
      return
    }

    split.enabled = tab.split.enabled
    split.direction = tab.split.direction
    split.root = tab.split.root ? cloneLayoutNode(tab.split.root) : null
    split.focusedPaneId = tab.split.focusedPaneId
    split.maxPanes = tab.split.maxPanes
  }

  function ensureTabSplitConsistency(tab: TerminalWorkspaceTab, preferredSessionId: string | null = null): void {
    const tabOwnedSessions = getSessionsByTabId(tab.id)
    if (!tabOwnedSessions.length) {
      tab.split = createDefaultSplitState(null)
      return
    }

    tab.split = restoreSplitState(tab.split, tabOwnedSessions, preferredSessionId)
  }

  function activateTab(tabId: string, preferredSessionId: string | null = null): boolean {
    const tab = findTabById(tabId)
    if (!tab) {
      return false
    }

    ensureTabSplitConsistency(tab, preferredSessionId)
    const leaves = collectLeafNodes(tab.split.root)

    let nextLeaf: SplitLayoutLeafNode | null = null
    if (preferredSessionId) {
      nextLeaf = leaves.find((leaf) => leaf.sessionId === preferredSessionId) ?? null
    }
    if (!nextLeaf && tab.split.focusedPaneId) {
      nextLeaf = leaves.find((leaf) => leaf.id === tab.split.focusedPaneId) ?? null
    }
    if (!nextLeaf) {
      nextLeaf = leaves[0] ?? null
    }

    activeTabSessionId.value = tab.id
    if (nextLeaf) {
      tab.split.focusedPaneId = nextLeaf.id
      activeSessionId.value = nextLeaf.sessionId
      touchSession(nextLeaf.sessionId)
    } else {
      activeSessionId.value = null
    }

    touchTab(tab.id)
    syncActiveSplitView()
    return true
  }

  function createPaneSession(tab: TerminalWorkspaceTab, kind: TerminalSessionKind = 'local'): TerminalSession {
    const session = createSessionRecord(sessions.value.length + 1, tab.id, tab.title, kind)
    sessions.value.push(session)
    return session
  }

  function createSession(options: CreateSessionOptions = {}): TerminalSession | null {
    if (tabs.value.length >= MAX_TABS) {
      return null
    }

    const tab = createTabRecord(tabs.value.length + 1, options.title)
    const kind = options.kind ?? 'local'
    const session = createSessionRecord(sessions.value.length + 1, tab.id, tab.title, kind)

    tab.split = createDefaultSplitState(session.id)
    tabs.value.push(tab)
    sessions.value.push(session)

    if (options.activate ?? true) {
      activateTab(tab.id, session.id)
    } else if (!activeTabSessionId.value) {
      activateTab(tab.id, session.id)
    } else {
      syncActiveSplitView()
    }

    return session
  }

  function ensureWorkspaceReady(): void {
    const validTabIds = new Set(sessions.value.map((session) => session.tabId))
    tabs.value = tabs.value.filter((tab) => validTabIds.has(tab.id))

    if (tabs.value.length > MAX_TABS) {
      const limitedTabs = tabs.value.slice(0, MAX_TABS)
      const limitedTabIds = new Set(limitedTabs.map((tab) => tab.id))
      tabs.value = limitedTabs
      sessions.value = sessions.value.filter((session) => limitedTabIds.has(session.tabId))
    }

    if (!tabs.value.length || !sessions.value.length) {
      tabs.value = []
      sessions.value = []
      activeTabSessionId.value = null
      activeSessionId.value = null
      createSession({ title: 'Local Shell', activate: true, kind: 'local' })
      return
    }

    for (const tab of tabs.value) {
      ensureTabSplitConsistency(tab, activeTabSessionId.value === tab.id ? activeSessionId.value : null)
    }

    if (!activeTabSessionId.value || !findTabById(activeTabSessionId.value)) {
      activeTabSessionId.value = tabs.value[0]?.id ?? null
    }

    const tab = activeTabSessionId.value ? findTabById(activeTabSessionId.value) : null
    if (!tab) {
      createSession({ title: 'Local Shell', activate: true, kind: 'local' })
      return
    }

    const sessionCandidate =
      activeSessionId.value && getSessionsByTabId(tab.id).some((item) => item.id === activeSessionId.value)
        ? activeSessionId.value
        : null

    activateTab(tab.id, sessionCandidate)
  }

  function buildPersistedWorkspacePayload(): PersistedWorkspaceState {
    return {
      version: 2,
      tabs: tabs.value.map((tab) => ({
        ...tab,
        split: cloneSplitState(tab.split),
      })),
      sessions: sessions.value.map((session) => ({ ...session })),
      activeTabId: activeTabSessionId.value,
      activeSessionId: activeSessionId.value,
    }
  }

  function applyPersistedWorkspaceState(restored: PersistedWorkspaceState): void {
    sessions.value = filterRestorableSessions(restored.sessions.map((item) => ({ ...item })))
    tabs.value = restored.tabs.map((tab) => ({
      ...tab,
      split: cloneSplitState(tab.split),
    }))
    activeTabSessionId.value = restored.activeTabId
    activeSessionId.value = restored.activeSessionId
    ensureWorkspaceReady()
  }

  function clearWorkspaceLocalStorage(): void {
    if (!workspaceStorage) {
      return
    }

    try {
      workspaceStorage.removeItem(WORKSPACE_STORAGE_KEY)
    } catch {
      // ignore remove failures
    }
  }

  function writeWorkspaceToLocalStorage(raw: string): void {
    if (!workspaceStorage) {
      return
    }

    try {
      workspaceStorage.setItem(WORKSPACE_STORAGE_KEY, raw)
    } catch {
      // ignore persist errors
    }
  }

  function loadWorkspaceFromLocalStorage(): PersistedWorkspaceState | null {
    if (!workspaceStorage) {
      return null
    }

    let rawState: string | null = null
    try {
      rawState = workspaceStorage.getItem(WORKSPACE_STORAGE_KEY)
    } catch {
      return null
    }

    if (!rawState) {
      return null
    }

    const restored = parsePersistedWorkspaceState(rawState)
    if (!restored) {
      clearWorkspaceLocalStorage()
      return null
    }

    return restored
  }

  async function loadWorkspaceFromSettings(): Promise<PersistedWorkspaceState | null> {
    if (!electronSettingsApi) {
      return null
    }

    let rawState: string | null = null
    try {
      const result = await electronSettingsApi.get(WORKSPACE_SETTINGS_KEY)
      if (!result.ok) {
        return null
      }

      rawState = result.data.setting?.value ?? null
    } catch {
      return null
    }

    if (!rawState) {
      return null
    }

    const restored = parsePersistedWorkspaceState(rawState)
    if (!restored) {
      clearWorkspaceLocalStorage()
      try {
        await electronSettingsApi.set(WORKSPACE_SETTINGS_KEY, '')
      } catch {
        // ignore cleanup failures
      }
      return null
    }

    return restored
  }

  async function persistWorkspaceState(): Promise<void> {
    const rawPayload = JSON.stringify(buildPersistedWorkspacePayload())
    // Always keep a synchronous local backup. This minimizes data loss when the
    // app quits before async electron settings persistence finishes.
    writeWorkspaceToLocalStorage(rawPayload)

    if (!electronSettingsApi) {
      persistenceMode.value = 'local'
      return
    }

    try {
      const result = await electronSettingsApi.set(WORKSPACE_SETTINGS_KEY, rawPayload)
      if (!result.ok) {
        throw new Error(result.error.message)
      }
      persistenceMode.value = 'electron'
    } catch {
      persistenceMode.value = 'local'
    }
  }

  function clearPersistTimer(): void {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
  }

  function schedulePersistWorkspaceState(delayMs = PERSIST_DEBOUNCE_MS): void {
    if (isRestoring.value) {
      return
    }

    const delay = Math.max(0, Math.floor(delayMs))
    clearPersistTimer()
    persistTimer = setTimeout(() => {
      persistTimer = null
      void persistWorkspaceState()
    }, delay)
  }

  function persistWorkspaceStateToLocalStorageNow(): void {
    if (isRestoring.value) {
      return
    }

    try {
      const rawPayload = JSON.stringify(buildPersistedWorkspacePayload())
      writeWorkspaceToLocalStorage(rawPayload)
    } catch {
      // ignore stringify/persist failures
    }
  }

  async function initializeWorkspaceState(): Promise<void> {
    const settingsState = await loadWorkspaceFromSettings()
    const localState = loadWorkspaceFromLocalStorage()
    const preferred = pickPreferredWorkspaceState(settingsState, localState)
    if (preferred.state) {
      applyPersistedWorkspaceState(preferred.state)
      persistenceMode.value = preferred.source === 'electron' ? 'electron' : 'local'
    } else {
      ensureWorkspaceReady()
    }

    isRestoring.value = false
    schedulePersistWorkspaceState(0)
  }

  function switchSession(id: string): void {
    if (findTabById(id)) {
      void activateTab(id)
      return
    }

    const session = findSessionById(id)
    if (!session) {
      return
    }

    void activateTab(session.tabId, session.id)
  }

  function reorderSessions(payload: ReorderSessionsPayload): void {
    const reordered = reorderSessionsById(tabs.value, payload)
    if (reordered === tabs.value) {
      return
    }

    tabs.value = reordered
    if (activeTabSessionId.value && !findTabById(activeTabSessionId.value)) {
      activeTabSessionId.value = tabs.value[0]?.id ?? null
    }
    syncActiveSplitView()
  }

  function renameSession(id: string, nextTitle: string): void {
    const value = nextTitle.trim()
    if (!value) {
      return
    }

    const tab = findTabById(id) ?? findTabBySessionId(id)
    if (!tab) {
      return
    }

    tab.title = value
    touchTab(tab.id)
  }

  function updateSession(
    id: string,
    payload: {
      title?: string
      localShellName?: string | null
      sshHost?: string | null
      filePanePath?: string | null
      filePaneSourceKind?: 'local' | 'ssh' | null
      filePaneSourceSessionId?: string | null
    },
  ): void {
    const target = findSessionById(id)
    if (!target) {
      return
    }

    let changed = false

    if (typeof payload.title === 'string') {
      const nextTitle = payload.title.trim()
      if (nextTitle && target.title !== nextTitle) {
        target.title = nextTitle
        changed = true
      }
    }

    if (payload.filePanePath !== undefined) {
      const nextPath =
        typeof payload.filePanePath === 'string' && payload.filePanePath.trim()
          ? payload.filePanePath.trim()
          : null
      if (target.filePanePath !== nextPath) {
        target.filePanePath = nextPath
        changed = true
      }
    }

    if (payload.localShellName !== undefined) {
      const nextShellName =
        typeof payload.localShellName === 'string' && payload.localShellName.trim()
          ? payload.localShellName.trim()
          : null
      if (target.localShellName !== nextShellName) {
        target.localShellName = nextShellName
        changed = true
      }
    }

    if (payload.sshHost !== undefined) {
      const nextSshHost =
        typeof payload.sshHost === 'string' && payload.sshHost.trim() ? payload.sshHost.trim() : null
      if (target.sshHost !== nextSshHost) {
        target.sshHost = nextSshHost
        changed = true
      }
    }

    if (payload.filePaneSourceKind !== undefined) {
      const nextSourceKind =
        payload.filePaneSourceKind === 'local' || payload.filePaneSourceKind === 'ssh'
          ? payload.filePaneSourceKind
          : null
      if (target.filePaneSourceKind !== nextSourceKind) {
        target.filePaneSourceKind = nextSourceKind
        changed = true
      }
    }

    if (payload.filePaneSourceSessionId !== undefined) {
      const nextSourceSessionId =
        typeof payload.filePaneSourceSessionId === 'string' && payload.filePaneSourceSessionId.trim()
          ? payload.filePaneSourceSessionId.trim()
          : null
      if (target.filePaneSourceSessionId !== nextSourceSessionId) {
        target.filePaneSourceSessionId = nextSourceSessionId
        changed = true
      }
    }

    if (!changed) {
      return
    }

    touchSession(target.id)
    touchTab(target.tabId)
    syncActiveSplitView()
  }

  function closeTabNow(tabId: string): void {
    const tabIndex = tabs.value.findIndex((tab) => tab.id === tabId)
    if (tabIndex < 0) {
      return
    }

    tabs.value.splice(tabIndex, 1)
    sessions.value = sessions.value.filter((session) => session.tabId !== tabId)

    if (!tabs.value.length || !sessions.value.length) {
      tabs.value = []
      sessions.value = []
      activeTabSessionId.value = null
      activeSessionId.value = null
      createSession({ title: 'Local Shell', activate: true, kind: 'local' })
      return
    }

    const nextTab = tabs.value[Math.min(tabIndex, tabs.value.length - 1)] ?? tabs.value[0]
    if (nextTab) {
      activateTab(nextTab.id)
      return
    }

    syncActiveSplitView()
  }

  function requestCloseSession(id: string): void {
    const tab = findTabById(id) ?? findTabBySessionId(id)
    if (!tab) {
      return
    }

    closeConfirm.open = false
    closeConfirm.sessionId = null
    closeTabNow(tab.id)
  }

  function cancelCloseSession(): void {
    closeConfirm.open = false
    closeConfirm.sessionId = null
  }

  function confirmCloseSession(): void {
    const tabId = closeConfirm.sessionId
    cancelCloseSession()
    if (tabId) {
      closeTabNow(tabId)
    }
  }

  function focusPane(paneId: string): void {
    const tab = activeTab.value
    if (!tab) {
      return
    }

    const leaf = findLeafById(tab.split.root, paneId)
    if (!leaf) {
      return
    }

    if (tab.split.focusedPaneId === leaf.id && activeSessionId.value === leaf.sessionId) {
      return
    }

    tab.split.focusedPaneId = leaf.id
    activeSessionId.value = leaf.sessionId
    logSplitDebug('focus pane', {
      tabId: tab.id,
      paneId: leaf.id,
      sessionId: leaf.sessionId,
    })
    touchSession(leaf.sessionId)
    touchTab(tab.id)
    syncActiveSplitView()
  }

  function setSplitDirection(direction: SplitDirection): void {
    const tab = activeTab.value
    if (!tab) {
      return
    }

    tab.split.direction = direction
    syncActiveSplitView()
  }

  function setBranchSplitRatio(branchId: string, ratio: number, options?: { transient?: boolean }): boolean {
    const tab = activeTab.value
    if (!tab || !tab.split.root) {
      return false
    }

    const splitRatio = clampSplitRatio(ratio)
    const updated = updateBranchSplitRatioById(tab.split.root, branchId, splitRatio)
    if (!updated.updated) {
      return false
    }

    tab.split.root = updated.node
    if (options?.transient) {
      return true
    }

    touchTab(tab.id)
    syncActiveSplitView()
    schedulePersistWorkspaceState(0)
    return true
  }

  function splitFocusedPane(
    direction: SplitDirection = split.direction,
    options?: { kind?: TerminalSessionKind },
  ): boolean {
    const tab = activeTab.value
    if (!tab) {
      return false
    }

    ensureTabSplitConsistency(tab, activeSessionId.value)
    tab.split.direction = direction

    if (!tab.split.root) {
      const seed = createPaneSession(tab, 'local')
      tab.split.root = createLeafNode(seed.id)
      tab.split.focusedPaneId = tab.split.root.id
    }

    const leaves = collectLeafNodes(tab.split.root)
    logSplitDebug('split request', {
      tabId: tab.id,
      direction,
      focusedPaneId: tab.split.focusedPaneId,
      activeSessionId: activeSessionId.value,
      paneCount: leaves.length,
      maxPanes: tab.split.maxPanes,
      leaves: leaves.map((leaf) => ({ paneId: leaf.id, sessionId: leaf.sessionId })),
    })
    if (leaves.length >= tab.split.maxPanes) {
      syncActiveSplitView()
      return false
    }

    const targetLeaf =
      (tab.split.focusedPaneId ? findLeafById(tab.split.root, tab.split.focusedPaneId) : null) ?? leaves[0] ?? null
    if (!targetLeaf) {
      syncActiveSplitView()
      return false
    }

    const created = createPaneSession(tab, options?.kind ?? 'local')
    const newLeaf = createLeafNode(created.id)
    const replacement = createBranchNode(direction, { ...targetLeaf }, newLeaf)
    const replaced = replaceLeafNodeById(tab.split.root, targetLeaf.id, replacement)
    if (!replaced.replaced) {
      sessions.value = sessions.value.filter((session) => session.id !== created.id)
      syncActiveSplitView()
      return false
    }

    tab.split.root = replaced.node
    tab.split.focusedPaneId = newLeaf.id
    tab.split.enabled = true
    activeSessionId.value = created.id
    logSplitDebug('split applied', {
      tabId: tab.id,
      direction,
      sourcePaneId: targetLeaf.id,
      sourceSessionId: targetLeaf.sessionId,
      newPaneId: newLeaf.id,
      newSessionId: created.id,
      nextActiveSessionId: activeSessionId.value,
    })
    touchSession(created.id)
    touchTab(tab.id)
    syncActiveSplitView()
    schedulePersistWorkspaceState(0)
    return true
  }

  function enableSplit(direction: SplitDirection = split.direction): void {
    void splitFocusedPane(direction)
  }

  function closeFocusedPane(): boolean {
    const tab = activeTab.value
    if (!tab) {
      return false
    }

    ensureTabSplitConsistency(tab, activeSessionId.value)
    const leaves = collectLeafNodes(tab.split.root)
    if (leaves.length <= 1 || !tab.split.root) {
      syncActiveSplitView()
      return false
    }

    const targetLeaf =
      (tab.split.focusedPaneId ? findLeafById(tab.split.root, tab.split.focusedPaneId) : null) ?? leaves[leaves.length - 1] ?? null
    if (!targetLeaf) {
      syncActiveSplitView()
      return false
    }

    const removed = removeLeafNodeById(tab.split.root, targetLeaf.id)
    if (!removed.removed || !removed.node) {
      syncActiveSplitView()
      return false
    }

    tab.split.root = removed.node
    sessions.value = sessions.value.filter((session) => session.id !== targetLeaf.sessionId)

    ensureTabSplitConsistency(tab, null)
    const nextLeaves = collectLeafNodes(tab.split.root)
    const nextFocused = nextLeaves[0] ?? null
    tab.split.focusedPaneId = nextFocused?.id ?? null
    activeSessionId.value = nextFocused?.sessionId ?? null

    if (nextFocused?.sessionId) {
      touchSession(nextFocused.sessionId)
    }

    touchTab(tab.id)
    syncActiveSplitView()
    schedulePersistWorkspaceState(0)
    return true
  }

  function disableSplit(): void {
    const tab = activeTab.value
    if (!tab) {
      return
    }

    ensureTabSplitConsistency(tab, activeSessionId.value)
    const leaves = collectLeafNodes(tab.split.root)
    const focusedLeaf =
      (tab.split.focusedPaneId ? findLeafById(tab.split.root, tab.split.focusedPaneId) : null) ?? leaves[0] ?? null

    if (!focusedLeaf) {
      return
    }

    const singleLeaf = createLeafNode(focusedLeaf.sessionId)
    tab.split.root = singleLeaf
    tab.split.focusedPaneId = singleLeaf.id
    tab.split.enabled = false
    activeSessionId.value = focusedLeaf.sessionId
    touchSession(focusedLeaf.sessionId)
    touchTab(tab.id)
    syncActiveSplitView()
    schedulePersistWorkspaceState(0)
  }

  function toggleSplit(direction?: SplitDirection): void {
    if (split.enabled && (!direction || split.direction === direction)) {
      disableSplit()
      return
    }

    enableSplit(direction ?? split.direction)
  }

  watch(
    () => ({
      tabs: tabs.value,
      sessions: sessions.value,
      activeTabId: activeTabSessionId.value,
      activeSessionId: activeSessionId.value,
    }),
    () => {
      schedulePersistWorkspaceState()
    },
    { deep: true },
  )

  watch(activeTabSessionId, () => {
    syncActiveSplitView()
  })

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', persistWorkspaceStateToLocalStorageNow)
  }

  void initializeWorkspaceState()

  return {
    sessions,
    tabSessions,
    tabs,
    canCreateMoreTabs,
    maxTabs: MAX_TABS,
    activeSessionId,
    activeTabSessionId,
    activeSession,
    activeTab,
    primarySession,
    secondarySession,
    canSplitMore,
    split,
    closeConfirm,
    createSession,
    switchSession,
    reorderSessions,
    renameSession,
    updateSession,
    requestCloseSession,
    cancelCloseSession,
    confirmCloseSession,
    toggleSplit,
    setSplitDirection,
    setBranchSplitRatio,
    enableSplit,
    disableSplit,
    splitFocusedPane,
    closeFocusedPane,
    focusPane,
  }
}

const workspaceState = createWorkspaceState()

export function useTerminalWorkspaceState() {
  return workspaceState
}

export type TerminalWorkspaceState = ReturnType<typeof createWorkspaceState>
