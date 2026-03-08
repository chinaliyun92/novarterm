import type {
  CreateServerInput,
  Server,
  UpdateServerInput,
} from './db';
import type { SSHConnectionSnapshot } from './ssh';

export interface ServerErrorPayload {
  code: string;
  message: string;
  detail?: string;
}

export interface ServerResultSuccess<T> {
  ok: true;
  data: T;
}

export interface ServerResultFailure {
  ok: false;
  error: ServerErrorPayload;
}

export type ServerResult<T> = ServerResultSuccess<T> | ServerResultFailure;

export interface ServerIdRequest {
  serverId: number;
}

export interface CreateServerRequest {
  input: CreateServerInput;
}

export interface UpdateServerRequest {
  serverId: number;
  input: UpdateServerInput;
}

export interface SearchServersRequest {
  keyword?: string;
}

export interface ServerSessionRequest {
  serverId: number;
  sessionId: string;
}

export interface ServerDirectoryRecordRequest {
  sessionId?: string;
  serverId?: number;
  path: string;
}

export interface DeleteResult {
  deleted: true;
}

export interface ServerSSHActionData {
  serverId: number;
  sessionId: string;
  snapshot: SSHConnectionSnapshot;
}

export interface ServerConnectData extends ServerSSHActionData {
  lastConnectedAt: string;
}

export interface ServerDirectoryRecordData {
  recorded: true;
  serverId: number;
  path: string;
  lastAccessedAt: string;
}

export interface ServersListData {
  servers: Server[];
}
