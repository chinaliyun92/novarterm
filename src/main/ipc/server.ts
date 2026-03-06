import type { IpcMain, IpcMainInvokeEvent } from 'electron';

import { SERVER_IPC_CHANNELS } from '../../shared/ipc/channels';
import type {
  CreateServerRequest,
  SearchServersRequest,
  ServerIdRequest,
  ServerResult,
  ServerDirectoryRecordRequest,
  ServerSessionRequest,
  ToggleServerFavoriteRequest,
  UpdateServerRequest,
} from '../../shared/types/server';
import type { RepositoryRegistry } from '../repositories';
import {
  ServerService,
  toServerErrorPayload,
} from '../services/server-service';
import { getSharedSSHService } from './ssh';

type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>;
type ServerRepositories = Pick<
  RepositoryRegistry,
  'servers' | 'settings' | 'connectionRecords' | 'recentDirectories'
>;

export function registerServerIPCHandlers(
  ipcMain: IpcMainLike,
  repositories: ServerRepositories,
): void {
  clearServerIPCHandlers(ipcMain);
  const service = new ServerService({
    repositories,
    sshService: getSharedSSHService(),
  });

  ipcMain.handle(
    SERVER_IPC_CHANNELS.serverList,
    async () =>
      toResult(async () => ({
        servers: service.listServers(),
      })),
  );

  ipcMain.handle(
    SERVER_IPC_CHANNELS.serverGet,
    async (_event: IpcMainInvokeEvent, request: ServerIdRequest) =>
      toResult(async () => service.getServer(request.serverId)),
  );

  ipcMain.handle(
    SERVER_IPC_CHANNELS.serverCreate,
    async (_event: IpcMainInvokeEvent, request: CreateServerRequest) =>
      toResult(async () => service.createServer(request.input)),
  );

  ipcMain.handle(
    SERVER_IPC_CHANNELS.serverUpdate,
    async (_event: IpcMainInvokeEvent, request: UpdateServerRequest) =>
      toResult(async () => service.updateServer(request.serverId, request.input)),
  );

  ipcMain.handle(
    SERVER_IPC_CHANNELS.serverDelete,
    async (_event: IpcMainInvokeEvent, request: ServerIdRequest) =>
      toResult(async () => {
        service.deleteServer(request.serverId);
        return { deleted: true as const };
      }),
  );

  ipcMain.handle(
    SERVER_IPC_CHANNELS.serverSearch,
    async (_event: IpcMainInvokeEvent, request: SearchServersRequest) =>
      toResult(async () => ({
        servers: service.searchServers(request),
      })),
  );

  ipcMain.handle(
    SERVER_IPC_CHANNELS.serverToggleFavorite,
    async (_event: IpcMainInvokeEvent, request: ToggleServerFavoriteRequest) =>
      toResult(async () => service.toggleFavorite(request)),
  );

  ipcMain.handle(
    SERVER_IPC_CHANNELS.connect,
    async (_event: IpcMainInvokeEvent, request: ServerSessionRequest) =>
      toResult(async () => service.connect(request)),
  );

  ipcMain.handle(
    SERVER_IPC_CHANNELS.reconnect,
    async (_event: IpcMainInvokeEvent, request: ServerSessionRequest) =>
      toResult(async () => service.reconnect(request)),
  );

  ipcMain.handle(
    SERVER_IPC_CHANNELS.disconnect,
    async (_event: IpcMainInvokeEvent, request: ServerSessionRequest) =>
      toResult(async () => service.disconnect(request)),
  );

  ipcMain.handle(
    SERVER_IPC_CHANNELS.status,
    async (_event: IpcMainInvokeEvent, request: ServerSessionRequest) =>
      toResult(async () => service.status(request)),
  );

  ipcMain.handle(
    SERVER_IPC_CHANNELS.directoryRecord,
    async (_event: IpcMainInvokeEvent, request: ServerDirectoryRecordRequest) =>
      toResult(async () => service.recordDirectory(request)),
  );
}

export function clearServerIPCHandlers(ipcMain: IpcMainLike): void {
  for (const channel of Object.values(SERVER_IPC_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }
}

async function toResult<T>(
  execute: () => Promise<T> | T,
): Promise<ServerResult<T>> {
  try {
    const data = await execute();
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: toServerErrorPayload(error),
    };
  }
}
