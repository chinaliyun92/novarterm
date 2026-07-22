import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { ServerService, ServerServiceError } from '../src/main/services/server-service'
import type { CreateServerInput } from '../src/shared/types/db'
import type { RepositoryRegistry } from '../src/main/repositories'
import type { SSHService } from '../src/main/ssh/ssh-service'

function createServerService(): ServerService {
  const repositories = {
    serverGroups: {
      findAll: () => [],
      create: (input: { name: string; sortOrder?: number }) => ({
        id: 1,
        name: input.name,
        sortOrder: input.sortOrder ?? 0,
        createdAt: '',
        updatedAt: '',
      }),
      update: () => null,
      delete: () => false,
    },
    servers: {
      findAll: () => [],
      findById: () => null,
      create: (input: CreateServerInput) => ({
        id: 1,
        groupId: input.groupId ?? null,
        name: input.name,
        host: input.host,
        port: input.port ?? 22,
        username: input.username,
        authType: input.authType,
        password: input.password ?? null,
        privateKeyPath: input.privateKeyPath ?? null,
        passphrase: input.passphrase ?? null,
        defaultDirectory: input.defaultDirectory ?? null,
        lastConnectedAt: input.lastConnectedAt ?? null,
        createdAt: '',
        updatedAt: '',
      }),
      update: () => null,
      delete: () => false,
    },
    settings: {
      findById: () => null,
    },
    connectionRecords: {
      create: () => null,
      update: () => null,
      findById: () => null,
      findAll: () => [],
    },
    recentDirectories: {
      create: () => null,
      update: () => null,
      findById: () => null,
      findAll: () => [],
    },
  } as unknown as Pick<
    RepositoryRegistry,
    'serverGroups' | 'servers' | 'settings' | 'connectionRecords' | 'recentDirectories'
  >

  const sshService = {} as SSHService

  return new ServerService({
    repositories,
    sshService,
  })
}

test('createServer rejects empty host', () => {
  const service = createServerService()

  assert.throws(
    () =>
      service.createServer({
        name: 'demo',
        host: '   ',
        port: 22,
        username: 'root',
        authType: 'password',
        password: 'secret',
      }),
    (error: unknown) =>
      error instanceof ServerServiceError &&
      error.code === 'validation_error' &&
      error.message === 'server.host is required',
  )
})

test('createServer rejects invalid port', () => {
  const service = createServerService()

  assert.throws(
    () =>
      service.createServer({
        name: 'demo',
        host: 'localhost',
        port: 0,
        username: 'root',
        authType: 'password',
        password: 'secret',
      }),
    (error: unknown) =>
      error instanceof ServerServiceError &&
      error.code === 'validation_error' &&
      error.message === 'server.port must be a positive integer',
  )
})

test('createServer rejects private key auth without privateKeyPath', () => {
  const service = createServerService()

  assert.throws(
    () =>
      service.createServer({
        name: 'pk-server',
        host: 'localhost',
        username: 'ubuntu',
        authType: 'privateKey',
        privateKeyPath: '   ',
      }),
    (error: unknown) =>
      error instanceof ServerServiceError &&
      error.code === 'validation_error' &&
      error.message === 'server.privateKeyPath is required',
  )
})
