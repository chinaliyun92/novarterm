export type SSHConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "reconnecting"
  | "failed";

export type SSHErrorCode =
  | "validation_error"
  | "connection_error"
  | "auth_error"
  | "timeout_error"
  | "not_connected"
  | "sftp_error"
  | "unknown_error";

export interface SSHErrorPayload {
  code: SSHErrorCode;
  message: string;
  detail?: string;
}

export interface SSHReconnectPolicy {
  enabled: boolean;
  maxAttempts: number;
  delayMs: number;
}

export interface SSHPasswordAuth {
  method: "password";
  username: string;
  password: string;
}

export interface SSHPrivateKeyAuth {
  method: "privateKey";
  username: string;
  privateKey: string;
  passphrase?: string;
}

export type SSHAuth = SSHPasswordAuth | SSHPrivateKeyAuth;

export interface SSHConnectionConfig {
  id: string;
  host: string;
  port: number;
  readyTimeoutMs?: number;
  reconnect?: Partial<SSHReconnectPolicy>;
  auth: SSHAuth;
}

export interface SSHConnectionSnapshot {
  id?: string;
  state: SSHConnectionState;
  connectedAt?: string;
  disconnectedAt?: string;
  reconnectAttempt: number;
  lastError?: SSHErrorPayload;
}

export interface SftpListItem {
  name: string;
  path: string;
  type: "file" | "directory" | "link" | "unknown";
  size: number;
  modifyTime: number;
  accessTime: number;
}

export interface SSHResultSuccess<T> {
  ok: true;
  data: T;
}

export interface SSHResultFailure {
  ok: false;
  error: SSHErrorPayload;
}

export type SSHResult<T> = SSHResultSuccess<T> | SSHResultFailure;

export interface SSHConnectRequest {
  sessionId: string;
  config: SSHConnectionConfig;
}

export interface SSHSessionRequest {
  sessionId: string;
}

export interface SftpListRequest {
  sessionId: string;
  remotePath: string;
}

export interface SftpGetRequest {
  sessionId: string;
  remotePath: string;
  localPath: string;
}

export interface SftpPutRequest {
  sessionId: string;
  localPath: string;
  remotePath: string;
}

export type SftpReadFileMode = "text" | "base64";

export interface SftpReadFileRequest {
  sessionId: string;
  remotePath: string;
  mode?: SftpReadFileMode;
}

export interface SftpReadFileResponse {
  remotePath: string;
  mode: SftpReadFileMode;
  content: string;
}

export interface SftpWriteTextRequest {
  sessionId: string;
  remotePath: string;
  content?: string;
}

export interface SftpMkdirRequest {
  sessionId: string;
  remotePath: string;
  recursive?: boolean;
}

export interface SftpRmRequest {
  sessionId: string;
  remotePath: string;
  recursive?: boolean;
  isDirectory?: boolean;
}

export interface SftpRenameRequest {
  sessionId: string;
  fromPath: string;
  toPath: string;
}
