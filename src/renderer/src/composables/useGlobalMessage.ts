import { computed, reactive } from 'vue'

export type GlobalMessageLevel = 'info' | 'success' | 'error'

export interface GlobalMessageItem {
  id: number
  text: string
  level: GlobalMessageLevel
}

interface ShowGlobalMessageOptions {
  level?: GlobalMessageLevel
  durationMs?: number
  replace?: boolean
}

const DEFAULT_DURATION_MS = 2400
const state = reactive({
  items: [] as GlobalMessageItem[],
})

let messageSequence = 1
const removeTimerById = new Map<number, ReturnType<typeof setTimeout>>()

function clearRemoveTimer(id: number): void {
  const timer = removeTimerById.get(id)
  if (!timer) {
    return
  }
  clearTimeout(timer)
  removeTimerById.delete(id)
}

function clear(): void {
  for (const item of state.items) {
    clearRemoveTimer(item.id)
  }
  state.items.splice(0, state.items.length)
}

function remove(id: number): void {
  clearRemoveTimer(id)
  const index = state.items.findIndex((item) => item.id === id)
  if (index >= 0) {
    state.items.splice(index, 1)
  }
}

function show(text: string, options: ShowGlobalMessageOptions = {}): number | null {
  const content = text.trim()
  if (!content) {
    return null
  }

  const level = options.level ?? 'info'
  const durationMs =
    Number.isFinite(options.durationMs) && (options.durationMs as number) > 0
      ? Math.round(options.durationMs as number)
      : DEFAULT_DURATION_MS
  const replace = options.replace === true

  if (replace) {
    clear()
  }

  const id = messageSequence++
  state.items.push({
    id,
    text: content,
    level,
  })

  const timer = setTimeout(() => {
    removeTimerById.delete(id)
    remove(id)
  }, durationMs)
  removeTimerById.set(id, timer)
  return id
}

function info(text: string, options: Omit<ShowGlobalMessageOptions, 'level'> = {}): number | null {
  return show(text, {
    ...options,
    level: 'info',
  })
}

function success(text: string, options: Omit<ShowGlobalMessageOptions, 'level'> = {}): number | null {
  return show(text, {
    ...options,
    level: 'success',
  })
}

function error(text: string, options: Omit<ShowGlobalMessageOptions, 'level'> = {}): number | null {
  return show(text, {
    ...options,
    level: 'error',
  })
}

export function useGlobalMessage() {
  return {
    items: computed(() => state.items),
    show,
    info,
    success,
    error,
    remove,
    clear,
  }
}

