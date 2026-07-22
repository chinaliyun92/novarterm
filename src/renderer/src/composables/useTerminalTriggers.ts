import { ref } from 'vue'
import type { TerminalTriggerRule, TerminalTriggerSource } from '../../../shared/types/trigger'
import type { ServerRecord } from '../types/server'

interface PersistedTerminalTriggersState {
  version: 1
  rules: unknown[]
}

const STORAGE_KEY = 'iterm.terminal-triggers.v1'

let triggerSequence = 1

function createRuleId(): string {
  return `trigger-${Date.now()}-${triggerSequence++}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isValidRule(value: unknown): value is TerminalTriggerRule {
  if (!isRecord(value)) {
    return false
  }

  const hidden = value.hidden
  const source = value.source
  const sourceServerId = value.sourceServerId

  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.pattern === 'string' &&
    typeof value.sendText === 'string' &&
    typeof value.enabled === 'boolean' &&
    (hidden === undefined || typeof hidden === 'boolean') &&
    (source === undefined || source === 'user' || source === 'server_hidden') &&
    (sourceServerId === undefined || (typeof sourceServerId === 'number' && Number.isFinite(sourceServerId))) &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt) &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt)
  )
}

function resolveDefaultAutoSend(source: TerminalTriggerSource | undefined): boolean {
  return source === 'server_hidden'
}

function normalizeRule(value: unknown): TerminalTriggerRule | null {
  if (!isValidRule(value)) {
    return null
  }

  const record = value as unknown as Record<string, unknown>
  const source = record.source as TerminalTriggerSource | undefined
  const autoSend = typeof record.autoSend === 'boolean'
    ? record.autoSend
    : resolveDefaultAutoSend(source)

  return {
    id: value.id,
    pattern: value.pattern,
    sendText: value.sendText,
    enabled: value.enabled,
    autoSend,
    hidden: value.hidden,
    source,
    sourceServerId: value.sourceServerId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

function loadRulesFromLocalStorage(): TerminalTriggerRule[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as Partial<PersistedTerminalTriggersState>
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.rules)) {
      return []
    }

    return parsed.rules
      .map((rule) => normalizeRule(rule))
      .filter((rule): rule is TerminalTriggerRule => rule !== null)
  } catch {
    return []
  }
}

function saveRulesToLocalStorage(rules: TerminalTriggerRule[]): void {
  if (typeof window === 'undefined') {
    return
  }

  const payload: PersistedTerminalTriggersState = {
    version: 1,
    rules,
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore storage write failures
  }
}

function clearRulesFromLocalStorage(): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore storage write failures
  }
}

function getTriggerApi(): TriggerApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  const candidate = (window as unknown as { electronAPI?: Partial<ElectronApi> }).electronAPI
  if (!candidate?.trigger) {
    return null
  }

  const api = candidate.trigger
  if (typeof api.list !== 'function' || typeof api.replaceAll !== 'function') {
    return null
  }

  return api
}

function createTerminalTriggersStore() {
  const localRules = loadRulesFromLocalStorage()
  const rules = ref<TerminalTriggerRule[]>(localRules)
  const loaded = ref(false)
  const persistenceMode = ref<'pending' | 'electron' | 'local'>('pending')
  const electronTriggerApi = getTriggerApi()
  let loadPromise: Promise<void> | null = null
  let persistChain: Promise<void> = Promise.resolve()

  function buildHiddenServerPasswordPatterns(server: Pick<ServerRecord, 'username' | 'host'>): string[] {
    const username = server.username.trim()
    const host = server.host.trim()
    const variants = [
      `${username}@${host}'s password:`,
      `${host}'s password:`,
    ]

    return [...new Set(variants.filter((pattern) => pattern.trim().length > 0))]
  }

  async function replaceAllInElectron(nextRules: TerminalTriggerRule[]): Promise<void> {
    if (!electronTriggerApi) {
      saveRulesToLocalStorage(nextRules)
      persistenceMode.value = 'local'
      return
    }

    const result = await electronTriggerApi.replaceAll({ rules: nextRules })
    if (!result.ok) {
      throw new Error(result.error.message)
    }

    rules.value = result.data.rules
    persistenceMode.value = 'electron'
  }

  function queuePersist(nextRules: TerminalTriggerRule[]): void {
    if (!electronTriggerApi) {
      saveRulesToLocalStorage(nextRules)
    }

    persistChain = persistChain
      .catch(() => undefined)
      .then(async () => {
        await replaceAllInElectron(nextRules)
        if (electronTriggerApi) {
          clearRulesFromLocalStorage()
        }
      })
      .catch(() => {
        persistenceMode.value = 'local'
        saveRulesToLocalStorage(nextRules)
      })
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded.value) {
      return
    }

    if (loadPromise) {
      await loadPromise
      return
    }

    loadPromise = (async () => {
      if (!electronTriggerApi) {
        persistenceMode.value = 'local'
        loaded.value = true
        return
      }

      const result = await electronTriggerApi.list()
      if (!result.ok) {
        persistenceMode.value = 'local'
        loaded.value = true
        return
      }

      const persistedRules = result.data.rules
      if (persistedRules.length > 0) {
        rules.value = persistedRules
        clearRulesFromLocalStorage()
      } else if (localRules.length > 0) {
        await replaceAllInElectron(localRules)
        clearRulesFromLocalStorage()
      } else {
        rules.value = persistedRules
        persistenceMode.value = 'electron'
      }

      loaded.value = true
    })()

    try {
      await loadPromise
    } finally {
      loadPromise = null
    }
  }

  function addRule(
    input?: Partial<
      Pick<TerminalTriggerRule, 'pattern' | 'sendText' | 'enabled' | 'autoSend' | 'hidden' | 'source' | 'sourceServerId'>
    >,
  ): string {
    const now = Date.now()
    const source = input?.source ?? 'user'
    const rule: TerminalTriggerRule = {
      id: createRuleId(),
      pattern: input?.pattern ?? '',
      sendText: input?.sendText ?? '',
      enabled: input?.enabled ?? true,
      autoSend: input?.autoSend ?? resolveDefaultAutoSend(source),
      hidden: input?.hidden ?? false,
      source,
      sourceServerId: typeof input?.sourceServerId === 'number' ? input.sourceServerId : undefined,
      createdAt: now,
      updatedAt: now,
    }
    const nextRules = [...rules.value, rule]
    rules.value = nextRules
    queuePersist(nextRules)
    return rule.id
  }

  function updateRule(
    id: string,
    patch: Partial<Pick<TerminalTriggerRule, 'pattern' | 'sendText' | 'enabled' | 'autoSend' | 'hidden' | 'source' | 'sourceServerId'>>,
  ): boolean {
    const normalizedId = id.trim()
    if (!normalizedId) {
      return false
    }

    let changed = false
    const nextRules = rules.value.map((rule) => {
      if (rule.id !== normalizedId) {
        return rule
      }

      changed = true
      return {
        ...rule,
        pattern: patch.pattern ?? rule.pattern,
        sendText: patch.sendText ?? rule.sendText,
        enabled: patch.enabled ?? rule.enabled,
        autoSend: patch.autoSend ?? rule.autoSend,
        hidden: patch.hidden ?? rule.hidden,
        source: patch.source ?? rule.source,
        sourceServerId: patch.sourceServerId ?? rule.sourceServerId,
        updatedAt: Date.now(),
      }
    })

    if (!changed) {
      return false
    }

    rules.value = nextRules
    queuePersist(nextRules)
    return true
  }

  function removeRule(id: string): boolean {
    const normalizedId = id.trim()
    if (!normalizedId) {
      return false
    }

    const nextRules = rules.value.filter((rule) => rule.id !== normalizedId)
    if (nextRules.length === rules.value.length) {
      return false
    }

    rules.value = nextRules
    queuePersist(nextRules)
    return true
  }

  function syncHiddenServerRules(servers: ServerRecord[]): void {
    const serversById = new Map(servers.map((server) => [server.id, server]))
    let nextRules = rules.value.filter((rule) => {
      if (rule.source !== 'server_hidden') {
        return true
      }

      return typeof rule.sourceServerId === 'number' && serversById.has(rule.sourceServerId)
    })

    const now = Date.now()
    for (const server of servers) {
      const username = server.username.trim()
      const host = server.host.trim()
      const rawPassword = typeof server.password === 'string' ? server.password.trim() : ''
      const existingHiddenRules = nextRules.filter(
        (rule) => rule.source === 'server_hidden' && rule.sourceServerId === server.id,
      )

      if (!username || !host || !rawPassword) {
        nextRules = nextRules.filter(
          (rule) => !(rule.source === 'server_hidden' && rule.sourceServerId === server.id),
        )
        continue
      }

      const patterns = buildHiddenServerPasswordPatterns({ username, host })
      const reusableRules = [...existingHiddenRules]
      const syncedRules = patterns.map((pattern) => {
        const existingRule = reusableRules.shift()
        if (!existingRule) {
          return {
            id: createRuleId(),
            pattern,
            sendText: rawPassword,
            enabled: true,
            autoSend: true,
            hidden: true,
            source: 'server_hidden' as const,
            sourceServerId: server.id,
            createdAt: now,
            updatedAt: now,
          }
        }

        return {
          ...existingRule,
          pattern,
          sendText: rawPassword,
          enabled: true,
          autoSend: true,
          hidden: true,
          source: 'server_hidden' as const,
          sourceServerId: server.id,
          updatedAt: now,
        }
      })

      nextRules = nextRules.filter(
        (rule) => !(rule.source === 'server_hidden' && rule.sourceServerId === server.id),
      )
      nextRules.push(...syncedRules)
    }

    const changed = JSON.stringify(nextRules) !== JSON.stringify(rules.value)
    if (!changed) {
      return
    }

    rules.value = nextRules
    queuePersist(nextRules)
  }

  return {
    rules,
    loaded,
    persistenceMode,
    ensureLoaded,
    addRule,
    updateRule,
    removeRule,
    syncHiddenServerRules,
  }
}

let terminalTriggersStore: ReturnType<typeof createTerminalTriggersStore> | null = null

export function useTerminalTriggers() {
  if (!terminalTriggersStore) {
    terminalTriggersStore = createTerminalTriggersStore()
  }
  return terminalTriggersStore
}

export type { TerminalTriggerRule, TerminalTriggerSource }
