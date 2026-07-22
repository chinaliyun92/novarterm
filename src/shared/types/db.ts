export type AuthType = 'password' | 'privateKey';
export type ConnectionStatus = 'connecting' | 'connected' | 'failed' | 'disconnected';
export type SessionType = 'local' | 'ssh';
export type SessionStatus = 'active' | 'closed';

export interface DatabaseBootstrapOptions {
  dbPath?: string;
  dataDir?: string;
  dbFileName?: string;
  readonly?: boolean;
  fileMustExist?: boolean;
}

export interface ServerGroup {
  id: number;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServerGroupInput {
  name: string;
  sortOrder?: number;
}

export interface UpdateServerGroupInput {
  name?: string;
  sortOrder?: number;
}

export interface Server {
  id: number;
  groupId: number | null;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password: string | null;
  privateKeyPath: string | null;
  passphrase: string | null;
  defaultDirectory: string | null;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServerInput {
  groupId?: number | null;
  name: string;
  host: string;
  port?: number;
  username: string;
  authType: AuthType;
  password?: string | null;
  privateKeyPath?: string | null;
  passphrase?: string | null;
  defaultDirectory?: string | null;
  lastConnectedAt?: string | null;
}

export interface UpdateServerInput {
  groupId?: number | null;
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  authType?: AuthType;
  password?: string | null;
  privateKeyPath?: string | null;
  passphrase?: string | null;
  defaultDirectory?: string | null;
  lastConnectedAt?: string | null;
}

export interface ConnectionRecord {
  id: number;
  serverId: number;
  status: ConnectionStatus;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface CreateConnectionRecordInput {
  serverId: number;
  status: ConnectionStatus;
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number | null;
  exitCode?: number | null;
  errorMessage?: string | null;
}

export interface UpdateConnectionRecordInput {
  status?: ConnectionStatus;
  startedAt?: string;
  endedAt?: string | null;
  durationMs?: number | null;
  exitCode?: number | null;
  errorMessage?: string | null;
}

export interface Setting {
  key: string;
  value: string;
  updatedAt: string;
}

export interface CreateSettingInput {
  key: string;
  value: string;
}

export interface UpdateSettingInput {
  value?: string;
}

export interface RecentDirectory {
  id: number;
  serverId: number;
  path: string;
  lastAccessedAt: string;
  createdAt: string;
}

export interface CreateRecentDirectoryInput {
  serverId: number;
  path: string;
  lastAccessedAt: string;
}

export interface UpdateRecentDirectoryInput {
  path?: string;
  lastAccessedAt?: string;
}

export interface Session {
  id: number;
  title: string;
  sessionType: SessionType;
  serverId: number | null;
  shell: string | null;
  cwd: string | null;
  status: SessionStatus;
  layout: string | null;
  tabOrder: number;
  lastActiveAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionInput {
  title: string;
  sessionType: SessionType;
  serverId?: number | null;
  shell?: string | null;
  cwd?: string | null;
  status?: SessionStatus;
  layout?: string | null;
  tabOrder?: number;
  lastActiveAt: string;
}

export interface UpdateSessionInput {
  title?: string;
  sessionType?: SessionType;
  serverId?: number | null;
  shell?: string | null;
  cwd?: string | null;
  status?: SessionStatus;
  layout?: string | null;
  tabOrder?: number;
  lastActiveAt?: string;
}
