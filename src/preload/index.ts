import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'

import {
  DIALOG_IPC_CHANNELS,
  LOCAL_FILE_IPC_CHANNELS,
  LOG_IPC_CHANNELS,
  SETTINGS_IPC_CHANNELS,
  SERVER_IPC_CHANNELS,
  SHELL_IPC_CHANNELS,
  SSH_IPC_CHANNELS,
  SSH_IPC_EVENTS,
  TERMINAL_IPC_CHANNELS,
  TERMINAL_IPC_EVENTS,
  TRIGGER_IPC_CHANNELS,
  UPDATE_IPC_CHANNELS,
  UPDATE_IPC_EVENTS,
} from '../shared/ipc/channels'
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
  LocalFileImportData,
  LocalFileImportRequest,
  LocalFileListData,
  LocalFileListRequest,
  LocalFileRenameRequest,
  LocalFileResult,
} from '../shared/types/local-file'
import type {
  CreateServerInput,
  UpdateServerInput
} from '../shared/types/db'
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
  SftpExtractZipRequest,
  SftpExtractZipResponse,
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
  SftpDownloadProgressEvent,
  SftpUploadProgressEvent,
  SSHResult,
  SSHSessionRequest
} from '../shared/types/ssh'
import type {
  SettingsCleanCommandBarHistoryRequest,
  SettingsCleanCommandBarHistoryResponse,
  SettingsGetResponse,
  SettingsResult,
  SettingsSetResponse,
} from '../shared/types/settings'
import type {
  TriggerListResponse,
  TriggerReplaceAllRequest,
  TriggerReplaceAllResponse,
  TriggerResult,
} from '../shared/types/trigger'
import type {
  NativeUpdateState,
  UpdateCheckResponse,
  UpdateDownloadResponse,
  UpdateOpenReleaseRequest,
  UpdateOpenReleaseResponse,
  UpdatePromptRequest,
  UpdatePromptResponse,
  UpdateRestartResponse,
  UpdateResult,
} from '../shared/types/update'
import type {
  TerminalCleanPersistedLogsRequest,
  TerminalCleanPersistedLogsResponse,
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
  TerminalSaveCwdRequest,
  TerminalSaveCwdResponse,
  TerminalPrepareForQuitCompleteRequest,
  TerminalPrepareForQuitCompleteResponse,
  TerminalPrepareForQuitEvent,
  TerminalResizeRequest,
  TerminalResizeResponse,
  TerminalResult,
  TerminalSaveSnapshotRequest,
  TerminalSaveSnapshotResponse,
  TerminalWriteTempFileRequest,
  TerminalWriteTempFileResponse,
  TerminalWriteRequest,
  TerminalWriteResponse,
} from '../shared/types/terminal'

type PingResponse = {
  message: string
  at: string
  dbReady: boolean
}

type Unsubscribe = () => void

const invoke = <T>(channel: string, payload?: unknown): Promise<T> =>
  payload === undefined
    ? (ipcRenderer.invoke(channel) as Promise<T>)
    : (ipcRenderer.invoke(channel, payload) as Promise<T>)

const subscribe = <T>(channel: string, listener: (payload: T) => void): Unsubscribe => {
  const handler = (_event: IpcRendererEvent, payload: T) => {
    listener(payload)
  }
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api = {
  ping: () => invoke<PingResponse>('app:ping'),

  server: {
    list: () => invoke<ServerResult<ServersListData>>(SERVER_IPC_CHANNELS.serverList),
    search: (query: SearchServersRequest) =>
      invoke<ServerResult<ServersListData>>(SERVER_IPC_CHANNELS.serverSearch, query),
    create: (input: CreateServerInput) =>
      invoke<ServerResult<ServersListData['servers'][number]>>(SERVER_IPC_CHANNELS.serverCreate, { input }),
    update: (serverId: number, input: UpdateServerInput) =>
      invoke<ServerResult<ServersListData['servers'][number]>>(SERVER_IPC_CHANNELS.serverUpdate, {
        serverId,
        input,
      }),
    delete: (serverId: number) =>
      invoke<ServerResult<DeleteResult>>(SERVER_IPC_CHANNELS.serverDelete, { serverId }),
    connect: (serverId: number, sessionId: string) =>
      invoke<ServerResult<ServerConnectData>>(SERVER_IPC_CHANNELS.connect, { serverId, sessionId }),
    reconnect: (serverId: number, sessionId: string) =>
      invoke<ServerResult<ServerSSHActionData>>(SERVER_IPC_CHANNELS.reconnect, { serverId, sessionId }),
    disconnect: (serverId: number, sessionId: string) =>
      invoke<ServerResult<ServerSSHActionData>>(SERVER_IPC_CHANNELS.disconnect, { serverId, sessionId }),
    status: (serverId: number, sessionId: string) =>
      invoke<ServerResult<ServerSSHActionData>>(SERVER_IPC_CHANNELS.status, { serverId, sessionId }),
    recordDirectory: (request: ServerDirectoryRecordRequest) =>
      invoke<ServerResult<ServerDirectoryRecordData>>(SERVER_IPC_CHANNELS.directoryRecord, request),
  },

  ssh: {
    connect: (request: SSHConnectRequest) =>
      invoke<SSHResult<SSHConnectionSnapshot>>(SSH_IPC_CHANNELS.connect, request),
    disconnect: (request: SSHSessionRequest) =>
      invoke<SSHResult<SSHConnectionSnapshot>>(SSH_IPC_CHANNELS.disconnect, request),
    reconnect: (request: SSHSessionRequest) =>
      invoke<SSHResult<SSHConnectionSnapshot>>(SSH_IPC_CHANNELS.reconnect, request),
    status: (request: SSHSessionRequest) =>
      invoke<SSHResult<SSHConnectionSnapshot>>(SSH_IPC_CHANNELS.status, request),
    onSftpDownloadProgress: (listener: (event: SftpDownloadProgressEvent) => void) =>
      subscribe<SftpDownloadProgressEvent>(SSH_IPC_EVENTS.sftpDownloadProgress, listener),
    onSftpUploadProgress: (listener: (event: SftpUploadProgressEvent) => void) =>
      subscribe<SftpUploadProgressEvent>(SSH_IPC_EVENTS.sftpUploadProgress, listener),

    sftp: {
      list: (request: SftpListRequest) =>
        invoke<SSHResult<SftpListItem[]>>(SSH_IPC_CHANNELS.sftpList, request),
      get: (request: SftpGetRequest) => invoke<SSHResult<void>>(SSH_IPC_CHANNELS.sftpGet, request),
      put: (request: SftpPutRequest) => invoke<SSHResult<void>>(SSH_IPC_CHANNELS.sftpPut, request),
      readFile: (request: SftpReadFileRequest) =>
        invoke<SSHResult<SftpReadFileResponse>>(SSH_IPC_CHANNELS.sftpReadFile, request),
      writeText: (request: SftpWriteTextRequest) =>
        invoke<SSHResult<void>>(SSH_IPC_CHANNELS.sftpWriteText, request),
      mkdir: (request: SftpMkdirRequest) =>
        invoke<SSHResult<void>>(SSH_IPC_CHANNELS.sftpMkdir, request),
      rm: (request: SftpRmRequest) => invoke<SSHResult<void>>(SSH_IPC_CHANNELS.sftpRm, request),
      rename: (request: SftpRenameRequest) =>
        invoke<SSHResult<void>>(SSH_IPC_CHANNELS.sftpRename, request),
      extractZip: (request: SftpExtractZipRequest) =>
        invoke<SSHResult<SftpExtractZipResponse>>(SSH_IPC_CHANNELS.sftpExtractZip, request),
    },
  },

  dialog: {
    saveFile: (request: DialogSaveFileRequest) =>
      invoke<DialogSaveFileResponse>(DIALOG_IPC_CHANNELS.showSaveDialog, request),
  },

  shell: {
    openExternal: (url: string) =>
      invoke<{ ok: boolean; error?: string }>(SHELL_IPC_CHANNELS.openExternal, url),
    openPath: (path: string) =>
      invoke<{ ok: boolean; error?: string }>(SHELL_IPC_CHANNELS.openPath, path),
  },

  log: {
    reportRendererError: (report: RendererErrorReport) =>
      invoke<void>(LOG_IPC_CHANNELS.reportRendererError, report),
  },

  settings: {
    get: (key: string) =>
      invoke<SettingsResult<SettingsGetResponse>>(SETTINGS_IPC_CHANNELS.get, { key }),
    set: (key: string, value: string) =>
      invoke<SettingsResult<SettingsSetResponse>>(SETTINGS_IPC_CHANNELS.set, { key, value }),
    cleanCommandBarHistory: (request: SettingsCleanCommandBarHistoryRequest) =>
      invoke<SettingsResult<SettingsCleanCommandBarHistoryResponse>>(
        SETTINGS_IPC_CHANNELS.cleanCommandBarHistory,
        request,
      ),
  },

  trigger: {
    list: () =>
      invoke<TriggerResult<TriggerListResponse>>(TRIGGER_IPC_CHANNELS.list),
    replaceAll: (request: TriggerReplaceAllRequest) =>
      invoke<TriggerResult<TriggerReplaceAllResponse>>(TRIGGER_IPC_CHANNELS.replaceAll, request),
  },

  update: {
    check: () => invoke<UpdateResult<UpdateCheckResponse>>(UPDATE_IPC_CHANNELS.check),
    getState: () => invoke<UpdateResult<NativeUpdateState>>(UPDATE_IPC_CHANNELS.getState),
    download: () => invoke<UpdateResult<UpdateDownloadResponse>>(UPDATE_IPC_CHANNELS.download),
    restartToInstall: () =>
      invoke<UpdateResult<UpdateRestartResponse>>(UPDATE_IPC_CHANNELS.restartToInstall),
    promptForUpdate: (request: UpdatePromptRequest) =>
      invoke<UpdateResult<UpdatePromptResponse>>(UPDATE_IPC_CHANNELS.promptForUpdate, request),
    openReleasePage: (request?: UpdateOpenReleaseRequest) =>
      invoke<UpdateResult<UpdateOpenReleaseResponse>>(
        UPDATE_IPC_CHANNELS.openReleasePage,
        request ?? {},
      ),
    onStateChanged: (listener: (event: NativeUpdateState) => void) =>
      subscribe<NativeUpdateState>(UPDATE_IPC_EVENTS.stateChanged, listener),
  },

  localFile: {
    list: (request: LocalFileListRequest) =>
      invoke<LocalFileResult<LocalFileListData>>(LOCAL_FILE_IPC_CHANNELS.list, request),
    createFile: (request: LocalFileCreateFileRequest) =>
      invoke<LocalFileResult<LocalFileActionData>>(LOCAL_FILE_IPC_CHANNELS.createFile, request),
    createDirectory: (request: LocalFileCreateDirectoryRequest) =>
      invoke<LocalFileResult<LocalFileActionData>>(LOCAL_FILE_IPC_CHANNELS.createDirectory, request),
    rename: (request: LocalFileRenameRequest) =>
      invoke<LocalFileResult<LocalFileActionData>>(LOCAL_FILE_IPC_CHANNELS.rename, request),
    delete: (request: LocalFileDeleteRequest) =>
      invoke<LocalFileResult<LocalFileActionData>>(LOCAL_FILE_IPC_CHANNELS.delete, request),
    importPaths: (request: LocalFileImportRequest) =>
      invoke<LocalFileResult<LocalFileImportData>>(LOCAL_FILE_IPC_CHANNELS.importPaths, request),
  },

  terminal: {
    open: (request: TerminalOpenRequest) =>
      invoke<TerminalResult<TerminalOpenResponse>>(TERMINAL_IPC_CHANNELS.open, request),
    write: (request: TerminalWriteRequest) =>
      invoke<TerminalResult<TerminalWriteResponse>>(TERMINAL_IPC_CHANNELS.write, request),
    resize: (request: TerminalResizeRequest) =>
      invoke<TerminalResult<TerminalResizeResponse>>(TERMINAL_IPC_CHANNELS.resize, request),
    close: (request: TerminalCloseRequest) =>
      invoke<TerminalResult<TerminalCloseResponse>>(TERMINAL_IPC_CHANNELS.close, request),
    getCwd: (request: TerminalGetCwdRequest) =>
      invoke<TerminalResult<TerminalGetCwdResponse>>(TERMINAL_IPC_CHANNELS.getCwd, request),
    loadPersisted: (request: TerminalLoadPersistedRequest) =>
      invoke<TerminalResult<TerminalLoadPersistedResponse>>(TERMINAL_IPC_CHANNELS.loadPersisted, request),
    saveCwd: (request: TerminalSaveCwdRequest) =>
      invoke<TerminalResult<TerminalSaveCwdResponse>>(TERMINAL_IPC_CHANNELS.saveCwd, request),
    saveSnapshot: (request: TerminalSaveSnapshotRequest) =>
      invoke<TerminalResult<TerminalSaveSnapshotResponse>>(TERMINAL_IPC_CHANNELS.saveSnapshot, request),
    prepareForQuitComplete: (request: TerminalPrepareForQuitCompleteRequest) =>
      invoke<TerminalResult<TerminalPrepareForQuitCompleteResponse>>(
        TERMINAL_IPC_CHANNELS.prepareForQuitComplete,
        request,
      ),
    cleanPersistedLogs: (request: TerminalCleanPersistedLogsRequest) =>
      invoke<TerminalResult<TerminalCleanPersistedLogsResponse>>(
        TERMINAL_IPC_CHANNELS.cleanPersistedLogs,
        request,
      ),
    writeTempFile: (request: TerminalWriteTempFileRequest) =>
      invoke<TerminalResult<TerminalWriteTempFileResponse>>(TERMINAL_IPC_CHANNELS.writeTempFile, request),
    resolveFilePath: (file: File) => {
      try {
        const value = webUtils.getPathForFile(file)
        return typeof value === 'string' && value.trim() ? value : null
      } catch {
        return null
      }
    },
    onData: (listener: (event: TerminalDataEvent) => void) =>
      subscribe<TerminalDataEvent>(TERMINAL_IPC_EVENTS.data, listener),
    onExit: (listener: (event: TerminalExitEvent) => void) =>
      subscribe<TerminalExitEvent>(TERMINAL_IPC_EVENTS.exit, listener),
    onError: (listener: (event: TerminalErrorEvent) => void) =>
      subscribe<TerminalErrorEvent>(TERMINAL_IPC_EVENTS.error, listener),
    onPrepareForQuit: (listener: (event: TerminalPrepareForQuitEvent) => void) =>
      subscribe<TerminalPrepareForQuitEvent>(TERMINAL_IPC_EVENTS.prepareForQuit, listener),
  },
}

function exposeApi(name: string): boolean {
  try {
    contextBridge.exposeInMainWorld(name, api)
    return true
  } catch {
    // Ignore duplicate exposures (can happen in dev edge cases).
    return false
  }
}

function mergeApiBridge(existing: Partial<typeof api> | undefined): typeof api {
  return {
    ...api,
    server: {
      ...(existing?.server ?? {}),
      ...api.server,
    },
    ssh: {
      ...(existing?.ssh ?? {}),
      ...api.ssh,
      sftp: {
        ...(existing?.ssh?.sftp ?? {}),
        ...api.ssh.sftp,
      },
    },
    dialog: {
      ...(existing?.dialog ?? {}),
      ...api.dialog,
    },
    shell: {
      ...(existing?.shell ?? {}),
      ...api.shell,
    },
    log: {
      ...(existing?.log ?? {}),
      ...api.log,
    },
    settings: {
      ...(existing?.settings ?? {}),
      ...api.settings,
    },
    update: {
      ...(existing?.update ?? {}),
      ...api.update,
    },
    trigger: {
      ...(existing?.trigger ?? {}),
      ...api.trigger,
    },
    localFile: {
      ...(existing?.localFile ?? {}),
      ...api.localFile,
    },
    terminal: {
      ...(existing?.terminal ?? {}),
      ...api.terminal,
    },
  }
}

const bridgeExposed = exposeApi('__electronAPIBridge')
const apiExposed = exposeApi('electronAPI')

if (!bridgeExposed || !apiExposed) {
  const target = globalThis as typeof globalThis & {
    electronAPI?: Partial<typeof api>
    __electronAPIBridge?: Partial<typeof api>
  }
  target.__electronAPIBridge = mergeApiBridge(target.__electronAPIBridge)
  target.electronAPI = mergeApiBridge(target.electronAPI)
}
