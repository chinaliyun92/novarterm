import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { ServerService } from '../src/main/services/server-service'
import type { RepositoryRegistry } from '../src/main/repositories'
import type { SSHService } from '../src/main/ssh/ssh-service'
import type { SSHConnectionConfig, SSHConnectionSnapshot } from '../src/shared/types/ssh'
import type { ConnectionRecord, RecentDirectory, Server } from '../src/shared/types/db'

interface IntegrationHarnessOptions {
  connectError?: Error
  connectSnapshot?: SSHConnectionSnapshot
}

type IntegrationRepositories = Pick<
  RepositoryRegistry,
  'servers' | 'settings' | 'connectionRecords' | 'recentDirectories' | 'serverGroups'
>

interface IntegrationHarness {
  repositories: IntegrationRepositories
  service: ServerService
  serverId: number
}

type InMemoryRepositories = IntegrationRepositories & {
  _records: ConnectionRecord[]
  _directories: RecentDirectory[]
  _servers: Server[]
}

function createHarness(options: IntegrationHarnessOptions = {}): IntegrationHarness {
  const repositories = createInMemoryRepositories()
  const server = repositories.servers.create({
    name: 'integration-server',
    host: '127.0.0.1',
    port: 22,
    username: 'root',
    authType: 'password',
    password: 'secret',
    groupId: null,
    privateKeyPath: null,
    passphrase: null,
    defaultDirectory: null,
    isFavorite: false,
    lastConnectedAt: null,
  })

  const connectSnapshot: SSHConnectionSnapshot =
    options.connectSnapshot ?? {
      id: 'fake-ssh-id',
      state: 'connected',
      connectedAt: '2026-03-04T10:00:00.000Z',
      reconnectAttempt: 0,
    }

  const sshService = {
    connect: async (_sessionId: string, _config: SSHConnectionConfig) => {
      if (options.connectError) {
        throw options.connectError
      }
      return connectSnapshot
    },
    disconnect: async () => ({
      state: 'disconnected',
      disconnectedAt: new Date().toISOString(),
      reconnectAttempt: 0,
    }),
    getStatus: () => ({
      state: 'connected',
      reconnectAttempt: 0,
    }),
  } as unknown as SSHService

  const service = new ServerService({
    repositories,
    sshService,
  })

  return {
    repositories,
    service,
    serverId: server.id,
  }
}

function createInMemoryRepositories(): InMemoryRepositories {
  const servers: Server[] = []
  const records: ConnectionRecord[] = []
  const directories: RecentDirectory[] = []
  const now = () => new Date().toISOString()
  let serverSeq = 1
  let recordSeq = 1
  let directorySeq = 1

  return {
    _servers: servers,
    _records: records,
    _directories: directories,

    serverGroups: {
      findAll: () => [],
      findById: () => null,
      create: () => {
        throw new Error('not implemented in test harness')
      },
      update: () => null,
      delete: () => false,
    } as unknown as RepositoryRegistry['serverGroups'],

    servers: {
      findAll: () => [...servers],
      findById: (id: number) => servers.find((item) => item.id === id) ?? null,
      create: (input: Partial<Server>) => {
        const entity: Server = {
          id: serverSeq++,
          groupId: input.groupId ?? null,
          name: input.name ?? 'server',
          host: input.host ?? '127.0.0.1',
          port: input.port ?? 22,
          username: input.username ?? 'root',
          authType: input.authType ?? 'password',
          password: input.password ?? null,
          privateKeyPath: input.privateKeyPath ?? null,
          passphrase: input.passphrase ?? null,
          defaultDirectory: input.defaultDirectory ?? null,
          isFavorite: input.isFavorite ?? false,
          lastConnectedAt: input.lastConnectedAt ?? null,
          createdAt: now(),
          updatedAt: now(),
        }
        servers.push(entity)
        return entity
      },
      update: (id: number, patch: Partial<Server>) => {
        const target = servers.find((item) => item.id === id)
        if (!target) {
          return null
        }
        Object.assign(target, patch, { updatedAt: now() })
        return target
      },
      delete: (id: number) => {
        const index = servers.findIndex((item) => item.id === id)
        if (index < 0) {
          return false
        }
        servers.splice(index, 1)
        return true
      },
    } as unknown as RepositoryRegistry['servers'],

    settings: {
      findById: (_key: string) => null,
      findAll: () => [],
      create: () => {
        throw new Error('not implemented in test harness')
      },
      update: () => null,
      delete: () => false,
    } as unknown as RepositoryRegistry['settings'],

    connectionRecords: {
      findAll: () => [...records],
      create: (input: Partial<ConnectionRecord>) => {
        const entity: ConnectionRecord = {
          id: recordSeq++,
          serverId: input.serverId ?? 0,
          status: (input.status as ConnectionRecord['status']) ?? 'failed',
          startedAt: input.startedAt ?? now(),
          endedAt: input.endedAt ?? null,
          durationMs: input.durationMs ?? null,
          exitCode: input.exitCode ?? null,
          errorMessage: input.errorMessage ?? null,
          createdAt: now(),
        }
        records.push(entity)
        return entity
      },
      update: (id: number, patch: Partial<ConnectionRecord>) => {
        const target = records.find((item) => item.id === id)
        if (!target) {
          return null
        }
        Object.assign(target, patch)
        return target
      },
    } as unknown as RepositoryRegistry['connectionRecords'],

    recentDirectories: {
      findAll: () => [...directories],
      create: (input: Partial<RecentDirectory>) => {
        const entity: RecentDirectory = {
          id: directorySeq++,
          serverId: input.serverId ?? 0,
          path: input.path ?? '/',
          lastAccessedAt: input.lastAccessedAt ?? now(),
          createdAt: now(),
        }
        directories.push(entity)
        return entity
      },
      update: (id: number, patch: Partial<RecentDirectory>) => {
        const target = directories.find((item) => item.id === id)
        if (!target) {
          return null
        }
        Object.assign(target, patch)
        return target
      },
    } as unknown as RepositoryRegistry['recentDirectories'],
  }
}

test('ServerService.connect success writes connection_records connected entry', async (t) => {
  const harness = createHarness({
    connectSnapshot: {
      id: 'connect-success',
      state: 'connected',
      connectedAt: '2026-03-04T12:00:00.000Z',
      reconnectAttempt: 0,
    },
  })

  await harness.service.connect({
    serverId: harness.serverId,
    sessionId: 'session-connect-ok',
  })

  const records = harness.repositories.connectionRecords
    .findAll()
    .filter((item) => item.serverId === harness.serverId)
  assert.equal(records.length, 1)
  assert.equal(records[0].status, 'connected')
  assert.equal(records[0].startedAt, '2026-03-04T12:00:00.000Z')
  assert.equal(records[0].endedAt, null)
  assert.equal(records[0].errorMessage, null)
})

test('ServerService.connect failure writes failed connection record', async (t) => {
  const harness = createHarness({
    connectError: new Error('fake ssh connect failure'),
  })

  await assert.rejects(
    () =>
      harness.service.connect({
        serverId: harness.serverId,
        sessionId: 'session-connect-fail',
      }),
    /fake ssh connect failure/,
  )

  const records = harness.repositories.connectionRecords
    .findAll()
    .filter((item) => item.serverId === harness.serverId)
  assert.equal(records.length, 1)
  assert.equal(records[0].status, 'failed')
  assert.equal(records[0].endedAt === null, false)
  assert.match(records[0].errorMessage ?? '', /fake ssh connect failure/)
})

test('ServerService.recordDirectory upserts recent_directories by session binding', async (t) => {
  const harness = createHarness()

  const sessionId = 'session-record-directory'
  await harness.service.connect({
    serverId: harness.serverId,
    sessionId,
  })

  const first = harness.service.recordDirectory({
    sessionId,
    path: '/var/log',
  })

  await new Promise((resolve) => setTimeout(resolve, 8))

  const second = harness.service.recordDirectory({
    sessionId,
    path: '/var/log',
  })

  const rows = harness.repositories.recentDirectories
    .findAll()
    .filter((item) => item.serverId === harness.serverId && item.path === '/var/log')

  assert.equal(rows.length, 1)
  assert.equal(first.recorded, true)
  assert.equal(second.recorded, true)
  assert.equal(rows[0].path, '/var/log')
  assert.ok(Date.parse(second.lastAccessedAt) >= Date.parse(first.lastAccessedAt))
})
