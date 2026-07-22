const SESSION_TRANSCRIPT_MAX_CHARS = 200_000

const transcriptBySession = new Map<string, string>()
const sshCommandHintShownBySession = new Set<string>()
const openedSessionById = new Set<string>()
const persistedHydratedBySession = new Set<string>()

function appendTranscript(sessionId: string, data: string): void {
  if (!sessionId || !data) {
    return
  }

  const previous = transcriptBySession.get(sessionId) ?? ''
  const merged = `${previous}${data}`
  if (merged.length <= SESSION_TRANSCRIPT_MAX_CHARS) {
    transcriptBySession.set(sessionId, merged)
    return
  }

  transcriptBySession.set(sessionId, merged.slice(merged.length - SESSION_TRANSCRIPT_MAX_CHARS))
}

function getTranscript(sessionId: string): string {
  return transcriptBySession.get(sessionId) ?? ''
}

function setTranscript(sessionId: string, data: string): void {
  if (!sessionId) {
    return
  }

  if (!data) {
    transcriptBySession.delete(sessionId)
    return
  }

  if (data.length <= SESSION_TRANSCRIPT_MAX_CHARS) {
    transcriptBySession.set(sessionId, data)
    return
  }

  transcriptBySession.set(sessionId, data.slice(data.length - SESSION_TRANSCRIPT_MAX_CHARS))
}

function clearTranscript(sessionId: string): void {
  transcriptBySession.delete(sessionId)
}

function hasShownSshCommandHint(sessionId: string): boolean {
  return sshCommandHintShownBySession.has(sessionId)
}

function markSshCommandHintShown(sessionId: string): void {
  sshCommandHintShownBySession.add(sessionId)
}

function clearSshCommandHint(sessionId: string): void {
  sshCommandHintShownBySession.delete(sessionId)
}

function hasOpenedSession(sessionId: string): boolean {
  return openedSessionById.has(sessionId)
}

function markOpenedSession(sessionId: string): void {
  openedSessionById.add(sessionId)
}

function clearOpenedSession(sessionId: string): void {
  openedSessionById.delete(sessionId)
}

function hasHydratedPersistedState(sessionId: string): boolean {
  return persistedHydratedBySession.has(sessionId)
}

function markHydratedPersistedState(sessionId: string): void {
  persistedHydratedBySession.add(sessionId)
}

function clearHydratedPersistedState(sessionId: string): void {
  persistedHydratedBySession.delete(sessionId)
}

const terminalSessionCache = {
  appendTranscript,
  getTranscript,
  setTranscript,
  clearTranscript,
  hasShownSshCommandHint,
  markSshCommandHintShown,
  clearSshCommandHint,
  hasOpenedSession,
  markOpenedSession,
  clearOpenedSession,
  hasHydratedPersistedState,
  markHydratedPersistedState,
  clearHydratedPersistedState,
}

export function useTerminalSessionCache() {
  return terminalSessionCache
}
