import type { SSHErrorPayload, SSHResult } from "./ssh";

export interface TerminalSessionRequest {
  sessionId: string;
}

export interface TerminalOpenOptions {
  cols?: number;
  rows?: number;
  width?: number;
  height?: number;
  term?: string;
  env?: Record<string, string>;
  shellPath?: string;
  command?: string;
  cwd?: string;
  forceLocal?: boolean;
}

export interface TerminalOpenRequest extends TerminalSessionRequest, TerminalOpenOptions {}

export interface TerminalWriteRequest extends TerminalSessionRequest {
  data: string;
}

export interface TerminalResizeOptions {
  cols: number;
  rows: number;
  width?: number;
  height?: number;
}

export interface TerminalResizeRequest extends TerminalSessionRequest, TerminalResizeOptions {}

export interface TerminalCloseRequest extends TerminalSessionRequest {}

export interface TerminalGetCwdRequest extends TerminalSessionRequest {
  preferRemote?: boolean;
}

export interface TerminalLoadPersistedRequest extends TerminalSessionRequest {
  maxBytes?: number;
}

export interface TerminalSaveCwdRequest extends TerminalSessionRequest {
  cwd: string;
}

export interface TerminalSaveSnapshotRequest extends TerminalSessionRequest {
  snapshot: string;
  cols?: number;
  rows?: number;
  cwd?: string;
}

export interface TerminalPrepareForQuitEvent {
  token: string;
  timeoutMs?: number;
}

export interface TerminalPrepareForQuitCompleteRequest {
  token: string;
}

export interface TerminalCleanPersistedLogsRequest {
  keepSessionIds: string[];
}

export interface TerminalWriteTempFileRequest {
  fileName?: string;
  mimeType?: string;
  dataBase64: string;
}

export type TerminalDataStream = "stdout" | "stderr";

export interface TerminalDataEvent {
  sessionId: string;
  stream: TerminalDataStream;
  data: string;
}

export interface TerminalExitEvent {
  sessionId: string;
  code?: number | null;
  signal?: string;
  dump?: string;
  description?: string;
}

export interface TerminalErrorEvent {
  sessionId: string;
  error: SSHErrorPayload;
}

export interface TerminalOpenResponse {
  opened: true;
  localShell?: string | null;
}

export interface TerminalWriteResponse {
  written: true;
}

export interface TerminalResizeResponse {
  resized: true;
}

export interface TerminalCloseResponse {
  closed: true;
}

export interface TerminalGetCwdResponse {
  cwd: string;
}

export interface TerminalLoadPersistedResponse {
  transcript: string;
  cwd?: string | null;
  loadedAt: string;
}

export interface TerminalSaveSnapshotResponse {
  saved: true;
}

export interface TerminalSaveCwdResponse {
  saved: true;
}

export interface TerminalPrepareForQuitCompleteResponse {
  acknowledged: true;
}

export interface TerminalCleanPersistedLogsResponse {
  removedCount: number;
}

export interface TerminalWriteTempFileResponse {
  path: string;
}

export type TerminalResult<T> = SSHResult<T>;
