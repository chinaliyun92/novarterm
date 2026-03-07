/// <reference types="vite/client" />

import type {
  CreateServerInput,
  Server,
  UpdateServerInput
} from '../shared/types/db'
import type {
  DialogSaveFileRequest,
  DialogSaveFileResponse,
} from '../shared/types/dialog'
import type { RendererErrorReport } from '../shared/types/log'
import type {
  LocalFileActionData,
  LocalFileCreateDirectoryRequest,
  LocalFileCreateFileRequest,
  LocalFileDeleteRequest,
  LocalFileListData,
  LocalFileListRequest,
  LocalFileRenameRequest,
  LocalFileResult,
} from '../shared/types/local-file'
import type {
  DeleteResult,
  SearchServersRequest,
  ServerConnectData,
  ServerDirectoryRecordData,
  ServerDirectoryRecordRequest,
  ServerResult,
  ServerSSHActionData,
  ServersListData
} from '../shared/types/server'
import type {
  SettingsGetResponse,
  SettingsResult,
  SettingsSetResponse,
} from '../shared/types/settings'
import type {
  UpdateCheckResponse,
  UpdateOpenReleaseRequest,
  UpdateOpenReleaseResponse,
  UpdatePromptRequest,
  UpdatePromptResponse,
  UpdateResult,
} from '../shared/types/update'
import type {
  SftpGetRequest,
  SftpListItem,
  SftpListRequest,
  SftpMkdirRequest,
  SftpPutRequest,
  SftpReadFileRequest,
  SftpReadFileResponse,
  SftpRenameRequest,
  SftpRmRequest,
  SftpWriteTextRequest,
  SSHConnectRequest,
  SSHConnectionSnapshot,
  SSHResult,
  SSHSessionRequest
} from '../shared/types/ssh'
import type {
  TerminalCloseRequest,
  TerminalCloseResponse,
  TerminalDataEvent,
  TerminalErrorEvent,
  TerminalExitEvent,
  TerminalGetCwdRequest,
  TerminalGetCwdResponse,
  TerminalLoadPersistedRequest,
  TerminalLoadPersistedResponse,
  TerminalOpenRequest,
  TerminalOpenResponse,
  TerminalResizeRequest,
  TerminalResizeResponse,
  TerminalResult,
  TerminalSaveHistoryRequest,
  TerminalSaveHistoryResponse,
  TerminalSaveSnapshotRequest,
  TerminalSaveSnapshotResponse,
  TerminalWriteTempFileRequest,
  TerminalWriteTempFileResponse,
  TerminalWriteRequest,
  TerminalWriteResponse,
} from '../shared/types/terminal'

declare global {
  interface PingResponse {
    message: string
    at: string
    dbReady: boolean
  }

  interface ServerApi {
    list: () => Promise<ServerResult<ServersListData>>
    search: (query: SearchServersRequest) => Promise<ServerResult<ServersListData>>
    create: (input: CreateServerInput) => Promise<ServerResult<Server>>
    update: (serverId: number, input: UpdateServerInput) => Promise<ServerResult<Server>>
    delete: (serverId: number) => Promise<ServerResult<DeleteResult>>
    favorite: (serverId: number, isFavorite?: boolean) => Promise<ServerResult<Server>>
    connect: (serverId: number, sessionId: string) => Promise<ServerResult<ServerConnectData>>
    reconnect: (serverId: number, sessionId: string) => Promise<ServerResult<ServerSSHActionData>>
    disconnect: (serverId: number, sessionId: string) => Promise<ServerResult<ServerSSHActionData>>
    status: (serverId: number, sessionId: string) => Promise<ServerResult<ServerSSHActionData>>
    recordDirectory: (request: ServerDirectoryRecordRequest) => Promise<ServerResult<ServerDirectoryRecordData>>
  }

  interface SshSftpApi {
    list: (request: SftpListRequest) => Promise<SSHResult<SftpListItem[]>>
    get: (request: SftpGetRequest) => Promise<SSHResult<void>>
    put: (request: SftpPutRequest) => Promise<SSHResult<void>>
    readFile: (request: SftpReadFileRequest) => Promise<SSHResult<SftpReadFileResponse>>
    writeText: (request: SftpWriteTextRequest) => Promise<SSHResult<void>>
    mkdir: (request: SftpMkdirRequest) => Promise<SSHResult<void>>
    rm: (request: SftpRmRequest) => Promise<SSHResult<void>>
    rename: (request: SftpRenameRequest) => Promise<SSHResult<void>>
  }

  interface SshApi {
    connect: (request: SSHConnectRequest) => Promise<SSHResult<SSHConnectionSnapshot>>
    disconnect: (request: SSHSessionRequest) => Promise<SSHResult<SSHConnectionSnapshot>>
    reconnect: (request: SSHSessionRequest) => Promise<SSHResult<SSHConnectionSnapshot>>
    status: (request: SSHSessionRequest) => Promise<SSHResult<SSHConnectionSnapshot>>
    sftp: SshSftpApi
  }

  interface SettingsApi {
    get: (key: string) => Promise<SettingsResult<SettingsGetResponse>>
    set: (key: string, value: string) => Promise<SettingsResult<SettingsSetResponse>>
  }

  interface UpdateApi {
    check: () => Promise<UpdateResult<UpdateCheckResponse>>
    promptForUpdate: (request: UpdatePromptRequest) => Promise<UpdateResult<UpdatePromptResponse>>
    openReleasePage: (request?: UpdateOpenReleaseRequest) => Promise<UpdateResult<UpdateOpenReleaseResponse>>
  }

  interface DialogApi {
    saveFile: (request: DialogSaveFileRequest) => Promise<DialogSaveFileResponse>
  }

  interface ShellApi {
    openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>
  }

  interface LogApi {
    reportRendererError: (report: RendererErrorReport) => Promise<void>
  }

  interface LocalFileApi {
    list: (request: LocalFileListRequest) => Promise<LocalFileResult<LocalFileListData>>
    createFile: (request: LocalFileCreateFileRequest) => Promise<LocalFileResult<LocalFileActionData>>
    createDirectory: (request: LocalFileCreateDirectoryRequest) => Promise<LocalFileResult<LocalFileActionData>>
    rename: (request: LocalFileRenameRequest) => Promise<LocalFileResult<LocalFileActionData>>
    delete: (request: LocalFileDeleteRequest) => Promise<LocalFileResult<LocalFileActionData>>
  }

  type Unsubscribe = () => void

  interface TerminalApi {
    open: (request: TerminalOpenRequest) => Promise<TerminalResult<TerminalOpenResponse>>
    write: (request: TerminalWriteRequest) => Promise<TerminalResult<TerminalWriteResponse>>
    resize: (request: TerminalResizeRequest) => Promise<TerminalResult<TerminalResizeResponse>>
    close: (request: TerminalCloseRequest) => Promise<TerminalResult<TerminalCloseResponse>>
    getCwd: (request: TerminalGetCwdRequest) => Promise<TerminalResult<TerminalGetCwdResponse>>
    loadPersisted: (request: TerminalLoadPersistedRequest) => Promise<TerminalResult<TerminalLoadPersistedResponse>>
    saveSnapshot: (request: TerminalSaveSnapshotRequest) => Promise<TerminalResult<TerminalSaveSnapshotResponse>>
    saveHistory: (request: TerminalSaveHistoryRequest) => Promise<TerminalResult<TerminalSaveHistoryResponse>>
    writeTempFile: (request: TerminalWriteTempFileRequest) => Promise<TerminalResult<TerminalWriteTempFileResponse>>
    resolveFilePath: (file: File) => string | null
    onData: (listener: (event: TerminalDataEvent) => void) => Unsubscribe
    onExit: (listener: (event: TerminalExitEvent) => void) => Unsubscribe
    onError: (listener: (event: TerminalErrorEvent) => void) => Unsubscribe
  }

  interface ElectronApi {
    ping: () => Promise<PingResponse>
    server: ServerApi
    ssh: SshApi
    dialog: DialogApi
    shell: ShellApi
    log: LogApi
    settings: SettingsApi
    update: UpdateApi
    localFile: LocalFileApi
    terminal: TerminalApi
  }

  interface Window {
    electronAPI: ElectronApi
    __electronAPIBridge?: ElectronApi
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<object, object, unknown>
  export default component
}

export {}
