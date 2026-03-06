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
  ServerResult,
}

export const CONNECTION_STATE_LABELS: Record<SSHConnectionState, string> = {
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
  disconnecting: '断开中',
  reconnecting: '重连中',
  failed: '失败',
}
