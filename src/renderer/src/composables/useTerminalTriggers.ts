import { ref } from 'vue'

export type TerminalTriggerSource = 'user' | 'server_hidden'

export interface TerminalTriggerRule {
  id: string
  pattern: string
  sendText: string
  enabled: boolean
  autoSend: boolean
  hidden?: boolean
  source?: TerminalTriggerSource
  sourceServerId?: number
  createdAt: number
  updatedAt: number
}

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

function createTerminalTriggersStore() {
  const rules = ref<TerminalTriggerRule[]>(loadRulesFromLocalStorage())

  function persist(): void {
    saveRulesToLocalStorage(rules.value)
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
    rules.value = [...rules.value, rule]
    persist()
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
    rules.value = rules.value.map((rule) => {
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

    if (changed) {
      persist()
    }
    return changed
  }

  function removeRule(id: string): boolean {
    const normalizedId = id.trim()
    if (!normalizedId) {
      return false
    }

    const next = rules.value.filter((rule) => rule.id !== normalizedId)
    if (next.length === rules.value.length) {
      return false
    }

    rules.value = next
    persist()
    return true
  }

  return {
    rules,
    addRule,
    updateRule,
    removeRule,
  }
}

let terminalTriggersStore: ReturnType<typeof createTerminalTriggersStore> | null = null

export function useTerminalTriggers() {
  if (!terminalTriggersStore) {
    terminalTriggersStore = createTerminalTriggersStore()
  }
  return terminalTriggersStore
}
