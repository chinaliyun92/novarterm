import { ref } from 'vue'

export interface TerminalTriggerRule {
  id: string
  pattern: string
  sendText: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

interface PersistedTerminalTriggersState {
  version: 1
  rules: TerminalTriggerRule[]
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

  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.pattern === 'string' &&
    typeof value.sendText === 'string' &&
    typeof value.enabled === 'boolean' &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt) &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt)
  )
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

    return parsed.rules.filter((rule) => isValidRule(rule))
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

  function addRule(input?: Partial<Pick<TerminalTriggerRule, 'pattern' | 'sendText' | 'enabled'>>): string {
    const now = Date.now()
    const rule: TerminalTriggerRule = {
      id: createRuleId(),
      pattern: input?.pattern ?? '',
      sendText: input?.sendText ?? '',
      enabled: input?.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    }
    rules.value = [...rules.value, rule]
    persist()
    return rule.id
  }

  function updateRule(
    id: string,
    patch: Partial<Pick<TerminalTriggerRule, 'pattern' | 'sendText' | 'enabled'>>,
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
