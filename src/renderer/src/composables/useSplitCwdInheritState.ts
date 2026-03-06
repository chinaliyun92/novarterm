const pendingCwdBySession = new Map<string, string>()

function normalizeSessionId(sessionId: string): string {
  return sessionId.trim()
}

function setPending(sessionId: string, cwd: string): void {
  const normalizedSessionId = normalizeSessionId(sessionId)
  const normalizedCwd = cwd.trim()
  if (!normalizedSessionId || !normalizedCwd) {
    return
  }

  pendingCwdBySession.set(normalizedSessionId, normalizedCwd)
}

function getPending(sessionId: string): string | null {
  const normalizedSessionId = normalizeSessionId(sessionId)
  if (!normalizedSessionId) {
    return null
  }

  return pendingCwdBySession.get(normalizedSessionId) ?? null
}

function hasPending(sessionId: string): boolean {
  const normalizedSessionId = normalizeSessionId(sessionId)
  if (!normalizedSessionId) {
    return false
  }

  return pendingCwdBySession.has(normalizedSessionId)
}

function clearPending(sessionId: string): void {
  const normalizedSessionId = normalizeSessionId(sessionId)
  if (!normalizedSessionId) {
    return
  }

  pendingCwdBySession.delete(normalizedSessionId)
}

function clearAllPending(): void {
  pendingCwdBySession.clear()
}

const splitCwdInheritState = {
  setPending,
  getPending,
  hasPending,
  clearPending,
  clearAllPending,
}

export function useSplitCwdInheritState() {
  return splitCwdInheritState
}
