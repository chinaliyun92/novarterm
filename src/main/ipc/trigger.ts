import type { IpcMain, IpcMainInvokeEvent } from 'electron';

import { TRIGGER_IPC_CHANNELS } from '../../shared/ipc/channels';
import type {
  TerminalTriggerRule,
  TriggerErrorPayload,
  TriggerListResponse,
  TriggerReplaceAllRequest,
  TriggerReplaceAllResponse,
  TriggerResult,
} from '../../shared/types/trigger';
import type { RepositoryRegistry } from '../repositories';

type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>;
type TriggerRepositories = Pick<RepositoryRegistry, 'terminalTriggers'>;

type TriggerIPCErrorCode = 'validation_error' | 'unknown_error';

class TriggerIPCError extends Error {
  public readonly code: TriggerIPCErrorCode;
  public readonly detail?: string;

  constructor(code: TriggerIPCErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'TriggerIPCError';
    this.code = code;
    this.detail = detail;
  }
}

export function registerTriggerIPCHandlers(
  ipcMain: IpcMainLike,
  repositories: TriggerRepositories,
): void {
  clearTriggerIPCHandlers(ipcMain);

  ipcMain.handle(
    TRIGGER_IPC_CHANNELS.list,
    async () =>
      toResult(async () => ({
        rules: repositories.terminalTriggers.findAll(),
      } satisfies TriggerListResponse)),
  );

  ipcMain.handle(
    TRIGGER_IPC_CHANNELS.replaceAll,
    async (_event: IpcMainInvokeEvent, request: TriggerReplaceAllRequest) =>
      toResult(async () => {
        const normalizedRules = normalizeRules(request.rules);
        return {
          rules: repositories.terminalTriggers.replaceAll(normalizedRules),
        } satisfies TriggerReplaceAllResponse;
      }),
  );
}

export function clearTriggerIPCHandlers(ipcMain: IpcMainLike): void {
  for (const channel of Object.values(TRIGGER_IPC_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }
}

function normalizeRules(rules: TerminalTriggerRule[]): TerminalTriggerRule[] {
  if (!Array.isArray(rules)) {
    throw new TriggerIPCError('validation_error', 'trigger.rules must be an array');
  }

  return rules.map((rule) => normalizeRule(rule));
}

function normalizeRule(rule: TerminalTriggerRule): TerminalTriggerRule {
  if (!rule || typeof rule !== 'object') {
    throw new TriggerIPCError('validation_error', 'trigger.rule must be an object');
  }

  const id = typeof rule.id === 'string' ? rule.id.trim() : '';
  const pattern = typeof rule.pattern === 'string' ? rule.pattern : '';
  const sendText = typeof rule.sendText === 'string' ? rule.sendText : '';
  const source = rule.source === 'server_hidden' ? 'server_hidden' : 'user';
  const sourceServerId = typeof rule.sourceServerId === 'number' && Number.isFinite(rule.sourceServerId)
    ? rule.sourceServerId
    : undefined;
  const createdAt = typeof rule.createdAt === 'number' && Number.isFinite(rule.createdAt)
    ? rule.createdAt
    : Date.now();
  const updatedAt = typeof rule.updatedAt === 'number' && Number.isFinite(rule.updatedAt)
    ? rule.updatedAt
    : createdAt;

  if (!id) {
    throw new TriggerIPCError('validation_error', 'trigger.id is required');
  }

  return {
    id,
    pattern,
    sendText,
    enabled: Boolean(rule.enabled),
    autoSend: Boolean(rule.autoSend),
    hidden: Boolean(rule.hidden),
    source,
    sourceServerId,
    createdAt,
    updatedAt,
  };
}

function toTriggerErrorPayload(error: unknown): TriggerErrorPayload {
  if (error instanceof TriggerIPCError) {
    return {
      code: error.code,
      message: error.message,
      detail: error.detail,
    };
  }

  if (error instanceof Error) {
    return {
      code: 'unknown_error',
      message: error.message || 'Unexpected trigger IPC error',
    };
  }

  return {
    code: 'unknown_error',
    message: String(error),
  };
}

async function toResult<T>(
  execute: () => Promise<T> | T,
): Promise<TriggerResult<T>> {
  try {
    const data = await execute();
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: toTriggerErrorPayload(error),
    };
  }
}
