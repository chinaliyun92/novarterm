import { computed, reactive, ref } from 'vue'
import { useI18n } from './useI18n'
import type {
  CreateServerInput,
  ServerRecord,
  ServerResult,
  UpdateServerInput,
  SSHConnectionSnapshot,
  SSHConnectionState,
} from '../types/server'
import type { ServerSSHActionData, ServersListData } from '../../../shared/types/server'

const DISCONNECTED_SNAPSHOT: SSHConnectionSnapshot = {
  state: 'disconnected',
  reconnectAttempt: 0,
}
const ACTIVE_SESSION_STATUS_REFRESH_INTERVAL_MS = 4_000
const i18n = useI18n()

const CONNECTION_STATE_LABEL_KEYS: Record<SSHConnectionState, string> = {
  disconnected: 'server.sidebar.state.disconnected',
  connecting: 'server.sidebar.state.connecting',
  connected: 'server.sidebar.state.connected',
  disconnecting: 'server.sidebar.state.disconnecting',
  reconnecting: 'server.sidebar.state.reconnecting',
  failed: 'server.sidebar.state.failed',
}

function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params)
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  if (typeof error === 'string' && error.trim()) {
    return error
  }
  return fallback
}

function resolveElectronApi(): Partial<ElectronApi> | null {
  if (typeof window === 'undefined') {
    return null
  }

  const target = window as Window & {
    electronAPI?: Partial<ElectronApi>
    __electronAPIBridge?: ElectronApi
  }

  if (target.electronAPI?.server && target.electronAPI?.ssh) {
    return target.electronAPI
  }

  if (target.__electronAPIBridge?.server && target.__electronAPIBridge?.ssh) {
    target.electronAPI = target.__electronAPIBridge
    return target.__electronAPIBridge
  }

  return target.electronAPI ?? target.__electronAPIBridge ?? null
}

function getServerApi(): ServerApi {
  const serverApi = resolveElectronApi()?.server
  if (!serverApi) {
    throw new Error(t('server.sidebar.error.serverApiUnavailable'))
  }
  return serverApi
}

function getSshApi(): SshApi {
  const sshApi = resolveElectronApi()?.ssh
  if (!sshApi) {
    throw new Error(t('server.sidebar.error.sshApiUnavailable'))
  }
  return sshApi
}

function unwrapResult<T>(result: ServerResult<T>, fallback: string): T {
  if (result.ok) {
    return result.data
  }

  const message = result.error?.message?.trim() || fallback
  throw new Error(message)
}

function normalizeSnapshot(snapshot: SSHConnectionSnapshot): SSHConnectionSnapshot {
  return {
    state: snapshot.state,
    reconnectAttempt: snapshot.reconnectAttempt ?? 0,
    id: snapshot.id,
    connectedAt: snapshot.connectedAt,
    disconnectedAt: snapshot.disconnectedAt,
    lastError: snapshot.lastError,
  }
}

function createServerSidebarState() {
  const servers = ref<ServersListData['servers']>([])

  const loading = ref(false)
  const initialized = ref(false)
  const lastError = ref<string | null>(null)

  const searchKeyword = ref('')
  const selectedServerId = ref<number | null>(null)

  const sessionSnapshots = reactive<Record<string, SSHConnectionSnapshot>>({})
  const sessionServerBindings = reactive<Record<string, number>>({})
  const pendingSessions = reactive<Record<string, boolean>>({})
  let activeSessionPollingTimer: ReturnType<typeof setInterval> | null = null
  let activeSessionPollingSessionId: string | null = null
  let activeSessionPollingInFlight = false
  let activeSessionPollingGeneration = 0

  const selectedServer = computed(() => {
    if (selectedServerId.value === null) {
      return null
    }

    return servers.value.find((server) => server.id === selectedServerId.value) ?? null
  })

  const visibleServers = computed<ServerRecord[]>(() => {
    const keyword = searchKeyword.value.trim().toLowerCase()
    const filtered = servers.value.filter((server) => {
      if (!keyword) {
        return true
      }

      return [server.name, server.host, server.username].some((field) =>
        field.toLowerCase().includes(keyword),
      )
    })

    filtered.sort((left: ServerRecord, right: ServerRecord) => {
      const byName = left.name.localeCompare(right.name)
      if (byName !== 0) {
        return byName
      }

      return left.host.localeCompare(right.host)
    })

    return filtered
  })

  function ensureSelectedServer(): void {
    if (selectedServerId.value !== null) {
      const exists = servers.value.some((server) => server.id === selectedServerId.value)
      if (exists) {
        return
      }
    }

    selectedServerId.value = servers.value[0]?.id ?? null
  }

  async function loadServers(): Promise<void> {
    const data = unwrapResult(await getServerApi().list(), t('server.sidebar.error.loadServersFailed'))
    servers.value = data.servers
    ensureSelectedServer()
  }

  async function load(): Promise<void> {
    loading.value = true
    lastError.value = null

    try {
      await loadServers()
      initialized.value = true
    } catch (error) {
      lastError.value = toErrorMessage(error, t('server.sidebar.error.loadServerDataFailed'))
      throw error
    } finally {
      loading.value = false
    }
  }

  async function ensureLoaded(): Promise<void> {
    if (initialized.value || loading.value) {
      return
    }

    await load()
  }

  async function createServer(input: CreateServerInput): Promise<ServerRecord> {
    await ensureLoaded()
    const created = unwrapResult(await getServerApi().create(input), t('server.sidebar.error.createServerFailed'))
    await loadServers()
    return created
  }

  async function updateServer(serverId: number, input: UpdateServerInput): Promise<ServerRecord> {
    await ensureLoaded()
    const updated = unwrapResult(await getServerApi().update(serverId, input), t('server.sidebar.error.updateServerFailed'))
    await loadServers()
    return updated
  }

  async function deleteServer(serverId: number): Promise<void> {
    await ensureLoaded()
    unwrapResult(await getServerApi().delete(serverId), t('server.sidebar.error.deleteServerFailed'))
    await loadServers()
  }

  function selectServer(serverId: number): void {
    selectedServerId.value = serverId
  }

  function getSessionSnapshot(sessionId: string | null): SSHConnectionSnapshot {
    if (!sessionId) {
      return DISCONNECTED_SNAPSHOT
    }

    return sessionSnapshots[sessionId] ?? DISCONNECTED_SNAPSHOT
  }

  function isSessionBusy(sessionId: string | null): boolean {
    if (!sessionId) {
      return false
    }

    return pendingSessions[sessionId] ?? false
  }

  function getSessionBoundServer(sessionId: string | null): ServerRecord | null {
    if (!sessionId) {
      return null
    }

    const serverId = sessionServerBindings[sessionId]
    if (!serverId) {
      return null
    }

    return servers.value.find((server) => server.id === serverId) ?? null
  }

  function getSessionStateLabel(sessionId: string | null): string {
    const state = getSessionSnapshot(sessionId).state
    return t(CONNECTION_STATE_LABEL_KEYS[state])
  }

  async function probeSessionStatusLatency(sessionId: string | null): Promise<number | null> {
    if (!sessionId) {
      return null
    }

    const startedAt = performance.now()
    try {
      const result = await getSshApi().status({ sessionId })
      if (!result.ok) {
        return null
      }
      return Math.round(performance.now() - startedAt)
    } catch {
      return null
    }
  }

  function resolveServerIdForSession(
    sessionId: string,
    options: { allowSelectedFallback?: boolean } = {},
  ): number | null {
    const boundServerId = sessionServerBindings[sessionId]
    if (boundServerId) {
      return boundServerId
    }

    if (options.allowSelectedFallback) {
      return selectedServerId.value
    }

    return null
  }

  function applySessionStatus(sessionId: string, data: ServerSSHActionData): void {
    sessionServerBindings[sessionId] = data.serverId
    sessionSnapshots[sessionId] = normalizeSnapshot(data.snapshot)
  }

  async function connectSession(sessionId: string, serverId: number): Promise<void> {
    pendingSessions[sessionId] = true
    sessionSnapshots[sessionId] = {
      state: 'connecting',
      reconnectAttempt: 0,
    }

    try {
      const data = unwrapResult(
        await getServerApi().connect(serverId, sessionId),
        t('server.sidebar.error.connectFailed'),
      )

      sessionServerBindings[sessionId] = data.serverId
      sessionSnapshots[sessionId] = normalizeSnapshot(data.snapshot)
      await loadServers()
    } catch (error) {
      const message = toErrorMessage(error, t('server.sidebar.error.connectFailed'))
      sessionSnapshots[sessionId] = {
        state: 'failed',
        reconnectAttempt: 0,
        lastError: {
          code: 'unknown_error',
          message,
        },
      }
      throw new Error(message)
    } finally {
      pendingSessions[sessionId] = false
    }
  }

  async function disconnectSession(sessionId: string): Promise<void> {
    const serverId = resolveServerIdForSession(sessionId, { allowSelectedFallback: false })
    if (!serverId) {
      throw new Error(t('server.sidebar.error.noBoundServerForSession'))
    }

    pendingSessions[sessionId] = true
    sessionSnapshots[sessionId] = {
      state: 'disconnecting',
      reconnectAttempt: 0,
    }

    try {
      const data = unwrapResult(
        await getServerApi().disconnect(serverId, sessionId),
        t('server.sidebar.error.disconnectFailed'),
      )
      applySessionStatus(sessionId, data)
      if (data.snapshot.state === 'disconnected') {
        delete sessionServerBindings[sessionId]
      }
    } catch (error) {
      const message = toErrorMessage(error, t('server.sidebar.error.disconnectFailed'))
      sessionSnapshots[sessionId] = {
        state: 'failed',
        reconnectAttempt: 0,
        lastError: {
          code: 'unknown_error',
          message,
        },
      }
      throw new Error(message)
    } finally {
      pendingSessions[sessionId] = false
    }
  }

  async function reconnectSession(sessionId: string): Promise<void> {
    const serverId = resolveServerIdForSession(sessionId, { allowSelectedFallback: false })
    if (!serverId) {
      throw new Error(t('server.sidebar.error.noBoundServerForSession'))
    }

    pendingSessions[sessionId] = true
    sessionSnapshots[sessionId] = {
      state: 'reconnecting',
      reconnectAttempt: 0,
    }

    try {
      const data = unwrapResult(
        await getServerApi().reconnect(serverId, sessionId),
        t('server.sidebar.error.reconnectFailed'),
      )
      applySessionStatus(sessionId, data)
      await loadServers()
    } catch (error) {
      const message = toErrorMessage(error, t('server.sidebar.error.reconnectFailed'))
      sessionSnapshots[sessionId] = {
        state: 'failed',
        reconnectAttempt: 0,
        lastError: {
          code: 'unknown_error',
          message,
        },
      }
      throw new Error(message)
    } finally {
      pendingSessions[sessionId] = false
    }
  }

  async function refreshSessionStatus(sessionId: string): Promise<void> {
    const serverId = resolveServerIdForSession(sessionId, { allowSelectedFallback: false })
    if (!serverId) {
      sessionSnapshots[sessionId] = DISCONNECTED_SNAPSHOT
      return
    }

    try {
      const data = unwrapResult(
        await getServerApi().status(serverId, sessionId),
        t('server.sidebar.error.readStatusFailed'),
      )
      applySessionStatus(sessionId, data)
    } catch (error) {
      const message = toErrorMessage(error, t('server.sidebar.error.readStatusFailed'))
      sessionSnapshots[sessionId] = {
        state: 'failed',
        reconnectAttempt: 0,
        lastError: {
          code: 'unknown_error',
          message,
        },
      }
    }
  }

  async function pollActiveSessionStatusOnce(): Promise<void> {
    const sessionId = activeSessionPollingSessionId
    if (!sessionId || activeSessionPollingInFlight || pendingSessions[sessionId]) {
      return
    }

    activeSessionPollingInFlight = true
    try {
      await refreshSessionStatus(sessionId)
    } finally {
      activeSessionPollingInFlight = false
    }
  }

  function clearActiveSessionPollingTimer(): void {
    if (activeSessionPollingTimer === null) {
      return
    }

    clearInterval(activeSessionPollingTimer)
    activeSessionPollingTimer = null
  }

  function stopActiveSessionStatusPolling(): void {
    activeSessionPollingGeneration += 1
    activeSessionPollingSessionId = null
    clearActiveSessionPollingTimer()
  }

  function startActiveSessionStatusPolling(sessionId: string | null): void {
    const normalizedSessionId = sessionId?.trim() ?? ''
    if (!normalizedSessionId) {
      stopActiveSessionStatusPolling()
      return
    }

    const changedSession = activeSessionPollingSessionId !== normalizedSessionId
    activeSessionPollingSessionId = normalizedSessionId
    void pollActiveSessionStatusOnce()

    if (!changedSession && activeSessionPollingTimer !== null) {
      return
    }

    activeSessionPollingGeneration += 1
    const generation = activeSessionPollingGeneration
    clearActiveSessionPollingTimer()

    activeSessionPollingTimer = setInterval(() => {
      if (generation !== activeSessionPollingGeneration) {
        return
      }

      void pollActiveSessionStatusOnce()
    }, ACTIVE_SESSION_STATUS_REFRESH_INTERVAL_MS)
  }

  async function recordSessionDirectory(sessionId: string, path: string): Promise<void> {
    const normalizedSessionId = sessionId.trim()
    const normalizedPath = path.trim()
    if (!normalizedSessionId || !normalizedPath) {
      return
    }

    const serverId = resolveServerIdForSession(normalizedSessionId, { allowSelectedFallback: false })
    const request = serverId
      ? { sessionId: normalizedSessionId, serverId, path: normalizedPath }
      : { sessionId: normalizedSessionId, path: normalizedPath }

    try {
      unwrapResult(
        await getServerApi().recordDirectory(request),
        t('server.sidebar.error.recordRecentDirectoryFailed'),
      )
    } catch {
      // Directory history persistence is best-effort and should not block UI actions.
    }
  }

  return {
    servers,
    visibleServers,
    loading,
    initialized,
    lastError,
    searchKeyword,
    selectedServerId,
    selectedServer,
    ensureLoaded,
    load,
    createServer,
    updateServer,
    deleteServer,
    selectServer,
    getSessionSnapshot,
    getSessionBoundServer,
    getSessionStateLabel,
    isSessionBusy,
    probeSessionStatusLatency,
    connectSession,
    reconnectSession,
    disconnectSession,
    refreshSessionStatus,
    startActiveSessionStatusPolling,
    stopActiveSessionStatusPolling,
    recordSessionDirectory,
  }
}

const serverSidebarState = createServerSidebarState()

export function useServerSidebarState() {
  return serverSidebarState
}

export type ServerSidebarState = ReturnType<typeof createServerSidebarState>
