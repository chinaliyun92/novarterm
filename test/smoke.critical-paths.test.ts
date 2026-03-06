import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { normalizeRemotePath } from '../src/renderer/src/types/file-browser'
import {
  buildCdCommand,
  createDefaultSessionTitle,
  decideConflictAction,
  parseConflictResolutionChoice,
  parsePerFileConflictAction,
  reorderSessionsById,
  requiresCloseConfirm,
  type ConflictResolutionStrategy,
} from '../src/shared/utils/terminal-smoke'

interface SmokeSession {
  id: string
  title: string
  hasPendingInput: boolean
}

test('smoke: multi-session create/reorder/close-confirm flow simulation', () => {
  const sessions: SmokeSession[] = [
    { id: 's1', title: createDefaultSessionTitle(1), hasPendingInput: false },
    { id: 's2', title: createDefaultSessionTitle(2), hasPendingInput: true },
    { id: 's3', title: createDefaultSessionTitle(3), hasPendingInput: false },
  ]

  assert.equal(sessions[0].title, 'Session 1')
  assert.equal(sessions[1].title, 'Session 2')

  const reordered = reorderSessionsById(sessions, {
    fromSessionId: 's1',
    toSessionId: 's3',
    position: 'after',
  })
  assert.deepEqual(
    reordered.map((item) => item.id),
    ['s2', 's3', 's1'],
  )

  const closeCandidate = reordered[0]
  assert.equal(closeCandidate.id, 's2')
  assert.equal(requiresCloseConfirm(closeCandidate.hasPendingInput), true)

  const afterCloseConfirm = reordered.filter((item) => item.id !== closeCandidate.id)
  assert.deepEqual(
    afterCloseConfirm.map((item) => item.id),
    ['s3', 's1'],
  )
})

test('smoke: terminal/file linkage path normalize + cd command build', () => {
  const normalized = normalizeRemotePath('  //var///tmp/work dir/  ')
  assert.equal(normalized, '/var/tmp/work dir')

  const command = buildCdCommand(normalized)
  assert.equal(command, "cd '/var/tmp/work dir'\n")

  const withSingleQuote = buildCdCommand("/srv/app/it's")
  assert.equal(withSingleQuote, "cd '/srv/app/it'\\''s'\n")
})

test('smoke: drag-upload conflict strategy decision flow', () => {
  const initialChoice = parseConflictResolutionChoice('3')
  assert.equal(initialChoice, 'per-file')

  let strategy: ConflictResolutionStrategy = initialChoice

  const firstAction = parsePerFileConflictAction('3')
  const firstDecision = decideConflictAction(strategy, firstAction)
  assert.deepEqual(firstDecision, {
    nextStrategy: 'overwrite-all',
    action: 'overwrite',
  })
  strategy = firstDecision.nextStrategy

  const secondDecision = decideConflictAction(strategy, parsePerFileConflictAction('2'))
  assert.deepEqual(secondDecision, {
    nextStrategy: 'overwrite-all',
    action: 'overwrite',
  })

  const cancelChoice = parseConflictResolutionChoice(null)
  assert.equal(cancelChoice, 'cancel-batch')
  const cancelDecision = decideConflictAction('per-file', parsePerFileConflictAction(null))
  assert.deepEqual(cancelDecision, {
    nextStrategy: 'per-file',
    action: 'cancel-batch',
  })
})
