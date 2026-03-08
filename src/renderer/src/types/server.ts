import type {
  CreateServerInput,
  Server,
  UpdateServerInput,
} from '../../../shared/types/db'
import type { ServerResult } from '../../../shared/types/server'
import type { SSHConnectionSnapshot, SSHConnectionState } from '../../../shared/types/ssh'

export type ServerRecord = Server
export type ServerAuthType = Server['authType']

export type {
  CreateServerInput,
  UpdateServerInput,
  SSHConnectionSnapshot,
  SSHConnectionState,
  ServerResult,
}
