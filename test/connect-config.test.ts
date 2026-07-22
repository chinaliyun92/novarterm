import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  normalizeReconnectPolicy,
  toSSH2ConnectConfig,
} from '../src/main/ssh/connect-config'
import type { SSHConnectionConfig } from '../src/shared/types/ssh'

test('normalizeReconnectPolicy returns defaults when input is undefined', () => {
  const policy = normalizeReconnectPolicy()

  assert.deepEqual(policy, {
    enabled: true,
    maxAttempts: 3,
    delayMs: 1500,
  })
})

test('normalizeReconnectPolicy keeps provided values and fills missing fields', () => {
  const policy = normalizeReconnectPolicy({
    enabled: false,
    delayMs: 3200,
  })

  assert.deepEqual(policy, {
    enabled: false,
    maxAttempts: 3,
    delayMs: 3200,
  })
})

test('toSSH2ConnectConfig maps password auth to ssh2 config', () => {
  const config: SSHConnectionConfig = {
    id: 'test-password',
    host: '127.0.0.1',
    port: 22,
    auth: {
      method: 'password',
      username: 'root',
      password: 'secret',
    },
  }

  const ssh2Config = toSSH2ConnectConfig(config)

  assert.equal(ssh2Config.host, '127.0.0.1')
  assert.equal(ssh2Config.port, 22)
  assert.equal(ssh2Config.username, 'root')
  assert.equal(ssh2Config.password, 'secret')
  assert.equal(ssh2Config.readyTimeout, 15000)
  assert.equal('privateKey' in ssh2Config, false)
})

test('toSSH2ConnectConfig maps private key auth and custom timeout', () => {
  const config: SSHConnectionConfig = {
    id: 'test-private-key',
    host: 'example.com',
    port: 2222,
    readyTimeoutMs: 24000,
    auth: {
      method: 'privateKey',
      username: 'deploy',
      privateKey: '----PRIVATE KEY----',
      passphrase: 'pass',
    },
  }

  const ssh2Config = toSSH2ConnectConfig(config)

  assert.equal(ssh2Config.host, 'example.com')
  assert.equal(ssh2Config.port, 2222)
  assert.equal(ssh2Config.username, 'deploy')
  assert.equal(ssh2Config.privateKey, '----PRIVATE KEY----')
  assert.equal(ssh2Config.passphrase, 'pass')
  assert.equal(ssh2Config.readyTimeout, 24000)
  assert.equal('password' in ssh2Config, false)
})
