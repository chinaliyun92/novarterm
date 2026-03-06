import type {
  TerminalCloseRequest,
  TerminalDataEvent as SharedTerminalDataEvent,
  TerminalErrorEvent as SharedTerminalErrorEvent,
  TerminalExitEvent as SharedTerminalExitEvent,
  TerminalLoadPersistedRequest,
  TerminalLoadPersistedResponse,
  TerminalOpenRequest,
  TerminalResizeRequest,
  TerminalResult,
  TerminalSaveHistoryRequest,
  TerminalSaveHistoryResponse,
  TerminalSaveSnapshotRequest,
  TerminalSaveSnapshotResponse,
  TerminalWriteTempFileRequest,
  TerminalWriteTempFileResponse,
  TerminalWriteRequest,
} from '../../../shared/types/terminal'

export type SplitDirection = 'horizontal' | 'vertical'
export type SplitPane = 'primary' | 'secondary'
export type TerminalSessionKind = 'local' | 'ssh' | 'file'
export type FilePaneSourceKind = 'local' | 'ssh'

export type TerminalOpenPayload = TerminalOpenRequest
export type TerminalWritePayload = TerminalWriteRequest
export type TerminalResizePayload = TerminalResizeRequest
export type TerminalClosePayload = TerminalCloseRequest
export type TerminalDataEvent = SharedTerminalDataEvent
export type TerminalExitEvent = SharedTerminalExitEvent
export type TerminalErrorEvent = SharedTerminalErrorEvent
export type TerminalSessionPayload = { sessionId: string }
export type TerminalOpenPathPayload = { path: string }
export type TerminalGetCwdResponse = { cwd: string }
export type TerminalOpenPathResponse = { opened: boolean; path?: string }

export type TerminalListenerCleanup = (() => void) | { dispose: () => void } | void

export interface TerminalBridgeApi {
  open: (payload: TerminalOpenPayload) => Promise<TerminalResult<unknown>> | TerminalResult<unknown>
  write: (payload: TerminalWritePayload) => Promise<TerminalResult<unknown>> | TerminalResult<unknown>
  resize: (payload: TerminalResizePayload) => Promise<TerminalResult<unknown>> | TerminalResult<unknown>
  close: (payload: TerminalClosePayload) => Promise<TerminalResult<unknown>> | TerminalResult<unknown>
  getCwd?: (
    payload: TerminalSessionPayload
  ) => Promise<TerminalResult<TerminalGetCwdResponse | string>> | TerminalResult<TerminalGetCwdResponse | string>
  loadPersisted?: (
    payload: TerminalLoadPersistedRequest
  ) =>
    | Promise<TerminalResult<TerminalLoadPersistedResponse>>
    | TerminalResult<TerminalLoadPersistedResponse>
  saveSnapshot?: (
    payload: TerminalSaveSnapshotRequest
  ) =>
    | Promise<TerminalResult<TerminalSaveSnapshotResponse>>
    | TerminalResult<TerminalSaveSnapshotResponse>
  saveHistory?: (
    payload: TerminalSaveHistoryRequest
  ) =>
    | Promise<TerminalResult<TerminalSaveHistoryResponse>>
    | TerminalResult<TerminalSaveHistoryResponse>
  writeTempFile?: (
    payload: TerminalWriteTempFileRequest
  ) =>
    | Promise<TerminalResult<TerminalWriteTempFileResponse>>
    | TerminalResult<TerminalWriteTempFileResponse>
  resolveFilePath?: (file: File) => string | null
  openPath?: (
    payload: TerminalOpenPathPayload
  ) => Promise<TerminalResult<TerminalOpenPathResponse | unknown>> | TerminalResult<TerminalOpenPathResponse | unknown>
  onData?: (listener: (event: TerminalDataEvent) => void) => TerminalListenerCleanup
  onExit?: (listener: (event: TerminalExitEvent) => void) => TerminalListenerCleanup
  onError?: (listener: (event: TerminalErrorEvent) => void) => TerminalListenerCleanup
}

export interface TerminalSession {
  id: string
  title: string
  kind: TerminalSessionKind
  localShellName?: string | null
  sshHost?: string | null
  filePanePath?: string | null
  filePaneSourceKind?: FilePaneSourceKind | null
  filePaneSourceSessionId?: string | null
  tabId: string
  createdAt: number
  updatedAt: number
  hasPendingInput: boolean
}

export interface SplitLayoutLeafNode {
  id: string
  type: 'leaf'
  sessionId: string
}

export interface SplitLayoutBranchNode {
  id: string
  type: 'branch'
  direction: SplitDirection
  splitRatio?: number
  first: SplitLayoutNode
  second: SplitLayoutNode
}

export type SplitLayoutNode = SplitLayoutLeafNode | SplitLayoutBranchNode

export interface SplitState {
  enabled: boolean
  direction: SplitDirection
  root: SplitLayoutNode | null
  focusedPaneId: string | null
  maxPanes: number
}

export interface TerminalWorkspaceTab {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  split: SplitState
}

export interface CloseConfirmState {
  open: boolean
  sessionId: string | null
}
