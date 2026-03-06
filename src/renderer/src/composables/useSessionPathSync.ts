import { reactive, readonly } from 'vue'
import { buildCdCommand } from '../../../shared/utils/terminal-smoke'
import type { TerminalBridgeApi } from '../types/terminal'

interface TerminalBridgeFailure {
  ok: false
  error?: {
    code?: string
    message?: string
    detail?: string
  }
}

interface TerminalBridgeSuccess<T> {
  ok: true
  data: T
}

interface RefreshCwdOptions {
  preferRemote?: boolean
}

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

function isBridgeEnvelope<T>(result: unknown): result is TerminalBridgeSuccess<T> | TerminalBridgeFailure {
  return !!result && typeof result === 'object' && 'ok' in result
}

function isBridgeFailure(result: unknown): result is TerminalBridgeFailure {
  return isBridgeEnvelope(result) && result.ok === false
}

function unwrapBridgeData<T>(result: unknown): T | null {
  if (!isBridgeEnvelope<T>(result)) {
    return result as T
  }

  if (!result.ok) {
    return null
  }

  return result.data
}

function normalizeCwd(payload: unknown): string | null {
  if (typeof payload === 'string') {
    const value = payload.trim()
    return value || null
  }

  if (!payload || typeof payload !== 'object') {
    return null
  }

  const candidate =
    (payload as { cwd?: unknown; path?: unknown }).cwd ??
    (payload as { cwd?: unknown; path?: unknown }).path

  if (typeof candidate !== 'string') {
    return null
  }

  const value = candidate.trim()
  return value || null
}

function createSessionPathSyncState() {
  const cwdBySession = reactive<Record<string, string>>({})

  function setCwd(sessionId: string, cwd: string): string | null {
    const normalizedSessionId = sessionId.trim()
    const normalizedCwd = normalizeCwd(cwd)
    if (!normalizedSessionId || !normalizedCwd) {
      return null
    }

    cwdBySession[normalizedSessionId] = normalizedCwd
    return normalizedCwd
  }

  function hintCwd(sessionId: string, cwdHint: string): string | null {
    return setCwd(sessionId, cwdHint)
  }

  async function refreshCwd(sessionId: string, options: RefreshCwdOptions = {}): Promise<string | null> {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) {
      return null
    }

    const bridge = getTerminalBridge()
    if (!bridge?.getCwd) {
      return cwdBySession[normalizedSessionId] ?? null
    }

    try {
      const result = await bridge.getCwd({
        sessionId: normalizedSessionId,
        ...(options.preferRemote
          ? {
              preferRemote: true,
            }
          : {}),
      })
      if (isBridgeFailure(result)) {
        return cwdBySession[normalizedSessionId] ?? null
      }

      const cwd = normalizeCwd(unwrapBridgeData(result))
      if (cwd) {
        setCwd(normalizedSessionId, cwd)
      }
      return cwd ?? cwdBySession[normalizedSessionId] ?? null
    } catch {
      return cwdBySession[normalizedSessionId] ?? null
    }
  }

  async function cdTo(sessionId: string, path: string): Promise<string | null> {
    const normalizedSessionId = sessionId.trim()
    const targetPath = path.trim()
    if (!normalizedSessionId || !targetPath) {
      return null
    }

    const bridge = getTerminalBridge()
    if (!bridge) {
      return null
    }

    try {
      const result = await bridge.write({
        sessionId: normalizedSessionId,
        data: buildCdCommand(targetPath),
      })
      if (isBridgeFailure(result)) {
        return cwdBySession[normalizedSessionId] ?? null
      }
    } catch {
      return cwdBySession[normalizedSessionId] ?? null
    }

    await new Promise((resolve) => setTimeout(resolve, 120))
    return refreshCwd(normalizedSessionId)
  }

  function clearSession(sessionId: string): void {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) {
      return
    }
    delete cwdBySession[normalizedSessionId]
  }

  return {
    cwdBySession: readonly(cwdBySession),
    setCwd,
    hintCwd,
    refreshCwd,
    cdTo,
    clearSession,
  }
}

const sessionPathSyncState = createSessionPathSyncState()

export function useSessionPathSync() {
  return sessionPathSyncState
}

export type SessionPathSyncState = ReturnType<typeof createSessionPathSyncState>
