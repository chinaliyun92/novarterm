export const SSH_IPC_CHANNELS = {
  connect: "ssh:connect",
  disconnect: "ssh:disconnect",
  reconnect: "ssh:reconnect",
  status: "ssh:status",
  sftpList: "ssh:sftp:list",
  sftpGet: "ssh:sftp:get",
  sftpPut: "ssh:sftp:put",
  sftpReadFile: "ssh:sftp:readFile",
  sftpWriteText: "ssh:sftp:writeText",
  sftpMkdir: "ssh:sftp:mkdir",
  sftpRm: "ssh:sftp:rm",
  sftpRename: "ssh:sftp:rename",
} as const;

export type SSHIPCChannel = (typeof SSH_IPC_CHANNELS)[keyof typeof SSH_IPC_CHANNELS];

export const TERMINAL_IPC_CHANNELS = {
  open: "terminal:open",
  write: "terminal:write",
  resize: "terminal:resize",
  close: "terminal:close",
  getCwd: "terminal:getCwd",
  loadPersisted: "terminal:loadPersisted",
  saveSnapshot: "terminal:saveSnapshot",
  saveHistory: "terminal:saveHistory",
  writeTempFile: "terminal:writeTempFile",
} as const;

export type TerminalIPCChannel =
  (typeof TERMINAL_IPC_CHANNELS)[keyof typeof TERMINAL_IPC_CHANNELS];

export const TERMINAL_IPC_EVENTS = {
  data: "terminal:data",
  exit: "terminal:exit",
  error: "terminal:error",
} as const;

export type TerminalIPCEventChannel =
  (typeof TERMINAL_IPC_EVENTS)[keyof typeof TERMINAL_IPC_EVENTS];

export const SERVER_IPC_CHANNELS = {
  serverList: "server:list",
  serverGet: "server:get",
  serverCreate: "server:create",
  serverUpdate: "server:update",
  serverDelete: "server:delete",
  serverSearch: "server:search",
  serverToggleFavorite: "server:favorite:toggle",
  connect: "server:ssh:connect",
  reconnect: "server:ssh:reconnect",
  disconnect: "server:ssh:disconnect",
  status: "server:ssh:status",
  directoryRecord: "server:directory:record",
} as const;

export type ServerIPCChannel = (typeof SERVER_IPC_CHANNELS)[keyof typeof SERVER_IPC_CHANNELS];

export const SETTINGS_IPC_CHANNELS = {
  get: 'settings:get',
  set: 'settings:set',
} as const;

export type SettingsIPCChannel =
  (typeof SETTINGS_IPC_CHANNELS)[keyof typeof SETTINGS_IPC_CHANNELS];

export const UPDATE_IPC_CHANNELS = {
  check: 'update:check',
  promptForUpdate: 'update:promptForUpdate',
  openReleasePage: 'update:openReleasePage',
} as const;

export type UpdateIPCChannel =
  (typeof UPDATE_IPC_CHANNELS)[keyof typeof UPDATE_IPC_CHANNELS];

export const SHELL_IPC_CHANNELS = {
  openExternal: 'shell:openExternal',
} as const;

export type ShellIPCChannel =
  (typeof SHELL_IPC_CHANNELS)[keyof typeof SHELL_IPC_CHANNELS];

export const DIALOG_IPC_CHANNELS = {
  showSaveDialog: 'dialog:showSaveDialog',
} as const;

export type DialogIPCChannel =
  (typeof DIALOG_IPC_CHANNELS)[keyof typeof DIALOG_IPC_CHANNELS];

export const LOG_IPC_CHANNELS = {
  reportRendererError: 'log:reportRendererError',
} as const;

export type LogIPCChannel =
  (typeof LOG_IPC_CHANNELS)[keyof typeof LOG_IPC_CHANNELS];

export const LOCAL_FILE_IPC_CHANNELS = {
  list: 'local-file:list',
  createFile: 'local-file:createFile',
  createDirectory: 'local-file:createDirectory',
  rename: 'local-file:rename',
  delete: 'local-file:delete',
} as const;

export type LocalFileIPCChannel =
  (typeof LOCAL_FILE_IPC_CHANNELS)[keyof typeof LOCAL_FILE_IPC_CHANNELS];
