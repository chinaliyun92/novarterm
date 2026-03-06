import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { SSH_IPC_CHANNELS } from "../../shared/ipc/channels";
import type {
  SftpGetRequest,
  SftpListRequest,
  SftpMkdirRequest,
  SftpPutRequest,
  SftpReadFileRequest,
  SftpRenameRequest,
  SftpRmRequest,
  SftpWriteTextRequest,
  SSHConnectRequest,
  SSHResult,
  SSHSessionRequest,
} from "../../shared/types/ssh";
import { SSHService } from "../ssh/ssh-service";
import { toSSHErrorPayload } from "../ssh/errors";

type IpcMainLike = Pick<IpcMain, "handle" | "removeHandler">;

const sshService = new SSHService();

export function getSharedSSHService(): SSHService {
  return sshService;
}

export function registerSSHIPCHandlers(ipcMain: IpcMainLike): void {
  clearSSHIPCHandlers(ipcMain);

  ipcMain.handle(
    SSH_IPC_CHANNELS.connect,
    async (_event: IpcMainInvokeEvent, request: SSHConnectRequest) =>
      toResult(() => sshService.connect(request.sessionId, request.config)),
  );

  ipcMain.handle(
    SSH_IPC_CHANNELS.disconnect,
    async (_event: IpcMainInvokeEvent, request: SSHSessionRequest) =>
      toResult(() => sshService.disconnect(request.sessionId)),
  );

  ipcMain.handle(
    SSH_IPC_CHANNELS.reconnect,
    async (_event: IpcMainInvokeEvent, request: SSHSessionRequest) =>
      toResult(() => sshService.reconnect(request.sessionId)),
  );

  ipcMain.handle(
    SSH_IPC_CHANNELS.status,
    async (_event: IpcMainInvokeEvent, request: SSHSessionRequest) =>
      toResult(async () => sshService.getStatus(request.sessionId)),
  );

  ipcMain.handle(
    SSH_IPC_CHANNELS.sftpList,
    async (_event: IpcMainInvokeEvent, request: SftpListRequest) =>
      toResult(() => sshService.list(request.sessionId, request.remotePath)),
  );

  ipcMain.handle(
    SSH_IPC_CHANNELS.sftpGet,
    async (_event: IpcMainInvokeEvent, request: SftpGetRequest) =>
      toResult(() => sshService.get(request.sessionId, request.remotePath, request.localPath)),
  );

  ipcMain.handle(
    SSH_IPC_CHANNELS.sftpPut,
    async (_event: IpcMainInvokeEvent, request: SftpPutRequest) =>
      toResult(() => sshService.put(request.sessionId, request.localPath, request.remotePath)),
  );

  ipcMain.handle(
    SSH_IPC_CHANNELS.sftpReadFile,
    async (_event: IpcMainInvokeEvent, request: SftpReadFileRequest) =>
      toResult(() => sshService.readFile(request.sessionId, request.remotePath, request.mode)),
  );

  ipcMain.handle(
    SSH_IPC_CHANNELS.sftpWriteText,
    async (_event: IpcMainInvokeEvent, request: SftpWriteTextRequest) =>
      toResult(() =>
        sshService.writeText(request.sessionId, request.remotePath, request.content ?? ""),
      ),
  );

  ipcMain.handle(
    SSH_IPC_CHANNELS.sftpMkdir,
    async (_event: IpcMainInvokeEvent, request: SftpMkdirRequest) =>
      toResult(() => sshService.mkdir(request.sessionId, request.remotePath, request.recursive)),
  );

  ipcMain.handle(
    SSH_IPC_CHANNELS.sftpRm,
    async (_event: IpcMainInvokeEvent, request: SftpRmRequest) =>
      toResult(() =>
        sshService.rm(
          request.sessionId,
          request.remotePath,
          request.recursive,
          request.isDirectory,
        ),
      ),
  );

  ipcMain.handle(
    SSH_IPC_CHANNELS.sftpRename,
    async (_event: IpcMainInvokeEvent, request: SftpRenameRequest) =>
      toResult(() => sshService.rename(request.sessionId, request.fromPath, request.toPath)),
  );
}

export function clearSSHIPCHandlers(ipcMain: IpcMainLike): void {
  for (const channel of Object.values(SSH_IPC_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }
}

async function toResult<T>(execute: () => Promise<T>): Promise<SSHResult<T>> {
  try {
    const data = await execute();
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: toSSHErrorPayload(error),
    };
  }
}
