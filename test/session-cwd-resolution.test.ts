import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { resolvePreferredSessionCwd, resolveSessionCwdHintFromCommand } from '../src/shared/utils/session-cwd'

test('ssh prefers hinted absolute cwd over refreshed fallback cwd', () => {
  const cwd = resolvePreferredSessionCwd({
    isSshSession: true,
    hintedCwd: '/var/www',
    refreshedCwd: '/root',
  })

  assert.equal(cwd, '/var/www')
})

test('ssh expands "~" cwd using refreshed absolute home cwd', () => {
  const cwd = resolvePreferredSessionCwd({
    isSshSession: true,
    hintedCwd: '~/project',
    refreshedCwd: '/home/loki',
  })

  assert.equal(cwd, '/home/loki/project')
})

test('ssh falls back to refreshed cwd when no hint is available', () => {
  const cwd = resolvePreferredSessionCwd({
    isSshSession: true,
    hintedCwd: null,
    refreshedCwd: '/root',
  })

  assert.equal(cwd, '/root')
})

test('local prefers hint first, then refreshed cwd', () => {
  const withHint = resolvePreferredSessionCwd({
    isSshSession: false,
    hintedCwd: '/Users/loki/Documents',
    refreshedCwd: '/Users/loki',
  })
  assert.equal(withHint, '/Users/loki/Documents')

  const withoutHint = resolvePreferredSessionCwd({
    isSshSession: false,
    hintedCwd: null,
    refreshedCwd: '/Users/loki',
  })
  assert.equal(withoutHint, '/Users/loki')
})

test('extract cwd hint from cd command for ssh prompt fallback', () => {
  assert.equal(resolveSessionCwdHintFromCommand('cd /var/www/zhongmeng'), '/var/www/zhongmeng')
  assert.equal(resolveSessionCwdHintFromCommand("cd '/var/www/space dir'"), '/var/www/space dir')
  assert.equal(resolveSessionCwdHintFromCommand('cd ~/workspace'), '~/workspace')
  assert.equal(resolveSessionCwdHintFromCommand('cd /tmp;'), '/tmp')
  assert.equal(resolveSessionCwdHintFromCommand('pwd'), null)
  assert.equal(resolveSessionCwdHintFromCommand('cd foo/bar'), '~/foo/bar')
  assert.equal(resolveSessionCwdHintFromCommand('cd /tmp; ls'), null)
  assert.equal(resolveSessionCwdHintFromCommand('cd /tmp && ls'), null)
})
