export interface ReorderSessionsPayload {
  fromSessionId: string
  toSessionId: string
  position: 'before' | 'after'
}

export interface SessionLike {
  id: string
}

export type ConflictResolutionStrategy = 'overwrite-all' | 'skip-all' | 'per-file'
export type ConflictResolutionChoice = ConflictResolutionStrategy | 'cancel-batch'
export type PerFileConflictAction = 'overwrite' | 'skip' | 'overwrite-all' | 'skip-all' | 'cancel-batch'

export interface ConflictDecision {
  nextStrategy: ConflictResolutionStrategy
  action: 'overwrite' | 'skip' | 'cancel-batch'
}

export function createDefaultSessionTitle(index: number): string {
  return `Session ${index}`
}

export function requiresCloseConfirm(hasPendingInput: boolean): boolean {
  return hasPendingInput
}

export function reorderSessionsById<T extends SessionLike>(
  sessions: T[],
  payload: ReorderSessionsPayload,
): T[] {
  if (payload.fromSessionId === payload.toSessionId) {
    return sessions
  }

  const fromIndex = sessions.findIndex((item) => item.id === payload.fromSessionId)
  const toIndex = sessions.findIndex((item) => item.id === payload.toSessionId)
  if (fromIndex < 0 || toIndex < 0) {
    return sessions
  }

  const reordered = [...sessions]
  const [moved] = reordered.splice(fromIndex, 1)
  if (!moved) {
    return sessions
  }

  const targetIndex = reordered.findIndex((item) => item.id === payload.toSessionId)
  if (targetIndex < 0) {
    return sessions
  }

  const insertIndex = payload.position === 'before' ? targetIndex : targetIndex + 1
  reordered.splice(insertIndex, 0, moved)
  return reordered
}

export function escapeShellPath(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`
}

export function buildCdCommand(path: string): string {
  return `cd ${escapeShellPath(path)}\n`
}

export function parseConflictResolutionChoice(input: string | null | undefined): ConflictResolutionChoice {
  if (input === null) {
    return 'cancel-batch'
  }

  const normalized = (input ?? '').trim()
  if (!normalized) {
    return 'per-file'
  }

  if (normalized === '0') {
    return 'cancel-batch'
  }
  if (normalized === '1') {
    return 'overwrite-all'
  }
  if (normalized === '2') {
    return 'skip-all'
  }
  if (normalized === '3') {
    return 'per-file'
  }

  return 'per-file'
}

export function parsePerFileConflictAction(input: string | null | undefined): PerFileConflictAction {
  if (input === null) {
    return 'cancel-batch'
  }

  const normalized = (input ?? '').trim()
  if (!normalized || normalized === '2') {
    return 'skip'
  }

  if (normalized === '0') {
    return 'cancel-batch'
  }
  if (normalized === '1') {
    return 'overwrite'
  }
  if (normalized === '3') {
    return 'overwrite-all'
  }
  if (normalized === '4') {
    return 'skip-all'
  }

  return 'skip'
}

export function decideConflictAction(
  strategy: ConflictResolutionStrategy,
  perFileAction: PerFileConflictAction = 'skip',
): ConflictDecision {
  if (strategy === 'overwrite-all') {
    return {
      nextStrategy: 'overwrite-all',
      action: 'overwrite',
    }
  }

  if (strategy === 'skip-all') {
    return {
      nextStrategy: 'skip-all',
      action: 'skip',
    }
  }

  if (perFileAction === 'cancel-batch') {
    return {
      nextStrategy: 'per-file',
      action: 'cancel-batch',
    }
  }

  if (perFileAction === 'overwrite-all') {
    return {
      nextStrategy: 'overwrite-all',
      action: 'overwrite',
    }
  }

  if (perFileAction === 'skip-all') {
    return {
      nextStrategy: 'skip-all',
      action: 'skip',
    }
  }

  if (perFileAction === 'overwrite') {
    return {
      nextStrategy: 'per-file',
      action: 'overwrite',
    }
  }

  return {
    nextStrategy: 'per-file',
    action: 'skip',
  }
}
