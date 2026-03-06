import type { IpcMain, IpcMainInvokeEvent } from 'electron';

import { SETTINGS_IPC_CHANNELS } from '../../shared/ipc/channels';
import type {
  SettingsErrorPayload,
  SettingsGetRequest,
  SettingsGetResponse,
  SettingsResult,
  SettingsSetRequest,
  SettingsSetResponse,
} from '../../shared/types/settings';
import type { RepositoryRegistry } from '../repositories';

type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>;
type SettingsRepositories = Pick<RepositoryRegistry, 'settings'>;

type SettingsIPCErrorCode = 'validation_error' | 'unknown_error';

class SettingsIPCError extends Error {
  public readonly code: SettingsIPCErrorCode;
  public readonly detail?: string;

  constructor(code: SettingsIPCErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'SettingsIPCError';
    this.code = code;
    this.detail = detail;
  }
}

export function registerSettingsIPCHandlers(
  ipcMain: IpcMainLike,
  repositories: SettingsRepositories,
): void {
  clearSettingsIPCHandlers(ipcMain);

  ipcMain.handle(
    SETTINGS_IPC_CHANNELS.get,
    async (_event: IpcMainInvokeEvent, request: SettingsGetRequest) =>
      toResult(async () => {
        const key = normalizeKey(request.key);
        return {
          setting: repositories.settings.findById(key),
        } satisfies SettingsGetResponse;
      }),
  );

  ipcMain.handle(
    SETTINGS_IPC_CHANNELS.set,
    async (_event: IpcMainInvokeEvent, request: SettingsSetRequest) =>
      toResult(async () => {
        const key = normalizeKey(request.key);
        const value = normalizeValue(request.value);
        const existing = repositories.settings.findById(key);

        if (!existing) {
          return {
            setting: repositories.settings.create({ key, value }),
          } satisfies SettingsSetResponse;
        }

        const updated = repositories.settings.update(key, { value });
        if (!updated) {
          throw new SettingsIPCError(
            'unknown_error',
            `Failed to update setting for key "${key}"`,
          );
        }

        return {
          setting: updated,
        } satisfies SettingsSetResponse;
      }),
  );
}

export function clearSettingsIPCHandlers(ipcMain: IpcMainLike): void {
  for (const channel of Object.values(SETTINGS_IPC_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }
}

function normalizeKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) {
    throw new SettingsIPCError('validation_error', 'settings.key is required');
  }
  return trimmed;
}

function normalizeValue(value: string): string {
  if (typeof value !== 'string') {
    throw new SettingsIPCError('validation_error', 'settings.value must be a string');
  }

  return value;
}

function toSettingsErrorPayload(error: unknown): SettingsErrorPayload {
  if (error instanceof SettingsIPCError) {
    return {
      code: error.code,
      message: error.message,
      detail: error.detail,
    };
  }

  if (error instanceof Error) {
    return {
      code: 'unknown_error',
      message: error.message || 'Unexpected settings IPC error',
    };
  }

  return {
    code: 'unknown_error',
    message: String(error),
  };
}

async function toResult<T>(
  execute: () => Promise<T> | T,
): Promise<SettingsResult<T>> {
  try {
    const data = await execute();
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: toSettingsErrorPayload(error),
    };
  }
}
