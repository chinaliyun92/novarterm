import { randomUUID } from "node:crypto";
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import { SSH_IPC_CHANNELS, SSH_IPC_EVENTS } from "../../shared/ipc/channels";
import type {
  SftpExtractZipRequest,
  SftpTransferProgress,
  SftpDownloadProgressEvent,
  SftpGetRequest,
  SftpListRequest,
  SftpMkdirRequest,
  SftpPutRequest,
  SftpUploadProgressEvent,
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
const TRANSFER_PROGRESS_EMIT_INTERVAL_MS = 120;

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
    async (event: IpcMainInvokeEvent, request: SftpGetRequest): Promise<SSHResult<void>> => {
      const sender = event.sender;
      const taskId = randomUUID();
      const basePayload = {
        taskId,
        sessionId: request.sessionId,
        remotePath: request.remotePath,
        localPath: request.localPath,
      } as const;

      let latestProgress: SftpTransferProgress = {
        transferredBytes: 0,
        totalBytes: null,
        percent: 0,
      };
      let lastProgressEmitAt = 0;

      sendSftpDownloadProgress(sender, {
        ...basePayload,
        ...latestProgress,
        state: "started",
        at: new Date().toISOString(),
      });

      try {
        await sshService.get(
          request.sessionId,
          request.remotePath,
          request.localPath,
          (progress) => {
            latestProgress = normalizeDownloadProgress(progress);

            const now = Date.now();
            if (now - lastProgressEmitAt < TRANSFER_PROGRESS_EMIT_INTERVAL_MS) {
              return;
            }
            lastProgressEmitAt = now;

            sendSftpDownloadProgress(sender, {
              ...basePayload,
              ...latestProgress,
              state: "progress",
              at: new Date().toISOString(),
            });
          },
        );

        const completedTotal = latestProgress.totalBytes;
        const completedTransferred =
          completedTotal !== null
            ? Math.max(latestProgress.transferredBytes, completedTotal)
            : latestProgress.transferredBytes;

        sendSftpDownloadProgress(sender, {
          ...basePayload,
          transferredBytes: completedTransferred,
          totalBytes: completedTotal,
          percent: 100,
          state: "completed",
          at: new Date().toISOString(),
        });

        return {
          ok: true,
          data: undefined,
        };
      } catch (error) {
        const sshError = toSSHErrorPayload(error);
        sendSftpDownloadProgress(sender, {
          ...basePayload,
          ...latestProgress,
          state: "failed",
          error: sshError,
          at: new Date().toISOString(),
        });
        return {
          ok: false,
          error: sshError,
        };
      }
    },
  );

  ipcMain.handle(
    SSH_IPC_CHANNELS.sftpPut,
    async (event: IpcMainInvokeEvent, request: SftpPutRequest): Promise<SSHResult<void>> => {
      const sender = event.sender;
      const taskId = randomUUID();
      const basePayload = {
        taskId,
        sessionId: request.sessionId,
        remotePath: request.remotePath,
        localPath: request.localPath,
      } as const;

      let latestProgress: SftpTransferProgress = {
        transferredBytes: 0,
        totalBytes: null,
        percent: 0,
      };
      let lastProgressEmitAt = 0;

      sendSftpUploadProgress(sender, {
        ...basePayload,
        ...latestProgress,
        state: "started",
        at: new Date().toISOString(),
      });

      try {
        await sshService.put(
          request.sessionId,
          request.localPath,
          request.remotePath,
          (progress) => {
            latestProgress = normalizeTransferProgress(progress);

            const now = Date.now();
            if (now - lastProgressEmitAt < TRANSFER_PROGRESS_EMIT_INTERVAL_MS) {
              return;
            }
            lastProgressEmitAt = now;

            sendSftpUploadProgress(sender, {
              ...basePayload,
              ...latestProgress,
              state: "progress",
              at: new Date().toISOString(),
            });
          },
        );

        const completedTotal = latestProgress.totalBytes;
        const completedTransferred =
          completedTotal !== null
            ? Math.max(latestProgress.transferredBytes, completedTotal)
            : latestProgress.transferredBytes;

        sendSftpUploadProgress(sender, {
          ...basePayload,
          transferredBytes: completedTransferred,
          totalBytes: completedTotal,
          percent: 100,
          state: "completed",
          at: new Date().toISOString(),
        });

        return {
          ok: true,
          data: undefined,
        };
      } catch (error) {
        const sshError = toSSHErrorPayload(error);
        sendSftpUploadProgress(sender, {
          ...basePayload,
          ...latestProgress,
          state: "failed",
          error: sshError,
          at: new Date().toISOString(),
        });
        return {
          ok: false,
          error: sshError,
        };
      }
    },
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

  ipcMain.handle(
    SSH_IPC_CHANNELS.sftpExtractZip,
    async (_event: IpcMainInvokeEvent, request: SftpExtractZipRequest) =>
      toResult(() =>
        sshService.extractZip(
          request.sessionId,
          request.remoteZipPath,
          request.targetDirectoryPath,
        ),
      ),
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

function normalizeTransferProgress(progress: SftpTransferProgress): SftpTransferProgress {
  const transferredBytes = Number.isFinite(progress.transferredBytes)
    ? Math.max(0, Math.floor(progress.transferredBytes))
    : 0;
  const totalCandidate = progress.totalBytes;
  const totalBytes =
    typeof totalCandidate === "number" && Number.isFinite(totalCandidate) && totalCandidate > 0
      ? Math.max(0, Math.floor(totalCandidate))
      : null;
  const percent =
    totalBytes && totalBytes > 0
      ? Math.min(100, Math.max(0, Math.round((transferredBytes / totalBytes) * 100)))
      : null;

  return {
    transferredBytes,
    totalBytes,
    percent,
  };
}

function normalizeDownloadProgress(progress: SftpTransferProgress): SftpTransferProgress {
  return normalizeTransferProgress(progress);
}

function sendSftpDownloadProgress(
  sender: WebContents,
  payload: SftpDownloadProgressEvent,
): void {
  if (sender.isDestroyed()) {
    return;
  }

  sender.send(SSH_IPC_EVENTS.sftpDownloadProgress, payload);
}

function sendSftpUploadProgress(
  sender: WebContents,
  payload: SftpUploadProgressEvent,
): void {
  if (sender.isDestroyed()) {
    return;
  }

  sender.send(SSH_IPC_EVENTS.sftpUploadProgress, payload);
}
