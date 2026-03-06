import { readFile } from 'node:fs/promises';

import type {
  CreateServerInput,
  Server,
  UpdateServerInput,
} from '../../shared/types/db';
import type {
  SearchServersRequest,
  ServerConnectData,
  ServerDirectoryRecordData,
  ServerDirectoryRecordRequest,
  ServerErrorPayload,
  ServerSSHActionData,
  ServerSessionRequest,
  ToggleServerFavoriteRequest,
} from '../../shared/types/server';
import type { SSHAuth, SSHConnectionConfig } from '../../shared/types/ssh';
import type { RepositoryRegistry } from '../repositories';
import { SSHService } from '../ssh/ssh-service';

type ServerRepositories = Pick<
  RepositoryRegistry,
  'servers' | 'settings' | 'connectionRecords' | 'recentDirectories'
>;

const RUNTIME_SETTING_KEYS = {
  readyTimeoutMs: ['ssh.readyTimeoutMs', 'sshTimeoutMs'],
  reconnectEnabled: ['ssh.reconnectEnabled', 'sshAutoReconnect'],
  reconnectMaxAttempts: ['ssh.reconnectMaxAttempts'],
  reconnectDelayMs: ['ssh.reconnectDelayMs'],
} as const;

const DEFAULT_READY_TIMEOUT_MS = 15_000;
const READY_TIMEOUT_RANGE = { min: 1_000, max: 120_000 };
const DEFAULT_RECONNECT_ENABLED = true;
const DEFAULT_RECONNECT_MAX_ATTEMPTS = 3;
const RECONNECT_MAX_ATTEMPTS_RANGE = { min: 1, max: 10 };
const DEFAULT_RECONNECT_DELAY_MS = 1_500;
const RECONNECT_DELAY_RANGE = { min: 200, max: 60_000 };

interface RuntimeSSHSettings {
  readyTimeoutMs: number;
  reconnect: {
    enabled: boolean;
    maxAttempts: number;
    delayMs: number;
  };
}

export type ServerServiceErrorCode =
  | 'validation_error'
  | 'not_found'
  | 'io_error'
  | 'unknown_error';

export class ServerServiceError extends Error {
  public readonly code: ServerServiceErrorCode;
  public readonly detail?: string;

  constructor(code: ServerServiceErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'ServerServiceError';
    this.code = code;
    this.detail = detail;
  }
}

export function toServerErrorPayload(error: unknown): ServerErrorPayload {
  if (error instanceof ServerServiceError) {
    return {
      code: error.code,
      message: error.message,
      detail: error.detail,
    };
  }

  if (error instanceof Error) {
    const codeValue = (error as { code?: unknown }).code;
    return {
      code: typeof codeValue === 'string' ? codeValue : 'unknown_error',
      message: error.message || 'Unexpected server service error',
    };
  }

  return {
    code: 'unknown_error',
    message: String(error),
  };
}

interface ServerServiceOptions {
  repositories: ServerRepositories;
  sshService: SSHService;
}

export class ServerService {
  private readonly repositories: ServerRepositories;
  private readonly sshService: SSHService;
  private readonly sessionServerBindings = new Map<string, number>();

  constructor(options: ServerServiceOptions) {
    this.repositories = options.repositories;
    this.sshService = options.sshService;
  }

  public listServers(): Server[] {
    return this.repositories.servers.findAll();
  }

  public getServer(serverId: number): Server {
    return this.requireServer(serverId);
  }

  public createServer(input: CreateServerInput): Server {
    this.validateCreateServerInput(input);
    return this.repositories.servers.create(input);
  }

  public updateServer(serverId: number, input: UpdateServerInput): Server {
    this.assertPositiveId(serverId, 'serverId');
    if (input.name !== undefined) {
      this.assertNonEmpty(input.name, 'server.name');
    }
    if (input.host !== undefined) {
      this.assertNonEmpty(input.host, 'server.host');
    }
    if (input.username !== undefined) {
      this.assertNonEmpty(input.username, 'server.username');
    }

    const updated = this.repositories.servers.update(serverId, input);
    if (!updated) {
      throw new ServerServiceError('not_found', `Server ${serverId} not found`);
    }
    return updated;
  }

  public deleteServer(serverId: number): void {
    this.assertPositiveId(serverId, 'serverId');
    const deleted = this.repositories.servers.delete(serverId);
    if (!deleted) {
      throw new ServerServiceError('not_found', `Server ${serverId} not found`);
    }
  }

  public searchServers(request: SearchServersRequest): Server[] {
    const keyword = request.keyword?.trim().toLowerCase() ?? '';
    const { isFavorite } = request;

    return this.repositories.servers.findAll().filter((server) => {
      if (isFavorite !== undefined && server.isFavorite !== isFavorite) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      const haystacks = [
        server.name,
        server.host,
        server.username,
        server.defaultDirectory ?? '',
      ];

      return haystacks.some((value) => value.toLowerCase().includes(keyword));
    });
  }

  public toggleFavorite(request: ToggleServerFavoriteRequest): Server {
    const server = this.requireServer(request.serverId);
    const nextFavorite = request.isFavorite ?? !server.isFavorite;
    const updated = this.repositories.servers.update(server.id, { isFavorite: nextFavorite });

    if (!updated) {
      throw new ServerServiceError('not_found', `Server ${request.serverId} not found`);
    }

    return updated;
  }

  public async connect(request: ServerSessionRequest): Promise<ServerConnectData> {
    this.assertSessionRequest(request);
    const server = this.requireServer(request.serverId);
    const startedAt = new Date().toISOString();

    try {
      const config = await this.toConnectionConfig(server, request.sessionId);
      const snapshot = await this.sshService.connect(request.sessionId, config);
      const lastConnectedAt = new Date().toISOString();
      const updated = this.repositories.servers.update(server.id, { lastConnectedAt });
      if (!updated) {
        throw new ServerServiceError('not_found', `Server ${server.id} not found`);
      }
      this.sessionServerBindings.set(request.sessionId, request.serverId);
      this.safeCreateConnectionRecord({
        serverId: request.serverId,
        status: 'connected',
        startedAt: snapshot.connectedAt ?? startedAt,
      });

      return {
        serverId: request.serverId,
        sessionId: request.sessionId,
        snapshot,
        lastConnectedAt,
      };
    } catch (error) {
      this.sessionServerBindings.delete(request.sessionId);
      this.safeCreateConnectionRecord({
        serverId: request.serverId,
        status: 'failed',
        startedAt,
        endedAt: new Date().toISOString(),
        errorMessage: this.toErrorMessage(error),
      });
      throw error;
    }
  }

  public async reconnect(request: ServerSessionRequest): Promise<ServerSSHActionData> {
    this.assertSessionRequest(request);
    const server = this.requireServer(request.serverId);
    const startedAt = new Date().toISOString();
    this.sessionServerBindings.set(request.sessionId, request.serverId);

    try {
      const snapshot = await this.sshService.reconnect(request.sessionId);
      const lastConnectedAt = new Date().toISOString();
      const updated = this.repositories.servers.update(server.id, { lastConnectedAt });
      if (!updated) {
        throw new ServerServiceError('not_found', `Server ${server.id} not found`);
      }

      this.safeCreateConnectionRecord({
        serverId: request.serverId,
        status: 'connected',
        startedAt: snapshot.connectedAt ?? startedAt,
      });

      return {
        serverId: request.serverId,
        sessionId: request.sessionId,
        snapshot,
      };
    } catch (error) {
      this.safeCreateConnectionRecord({
        serverId: request.serverId,
        status: 'failed',
        startedAt,
        endedAt: new Date().toISOString(),
        errorMessage: this.toErrorMessage(error),
      });
      throw error;
    }
  }

  public async disconnect(request: ServerSessionRequest): Promise<ServerSSHActionData> {
    this.assertSessionRequest(request);
    this.requireServer(request.serverId);
    const snapshot = await this.sshService.disconnect(request.sessionId);
    this.sessionServerBindings.delete(request.sessionId);
    this.safeFinalizeConnectionRecord(
      request.serverId,
      snapshot.disconnectedAt ?? new Date().toISOString(),
      'disconnected',
    );

    return {
      serverId: request.serverId,
      sessionId: request.sessionId,
      snapshot,
    };
  }

  public status(request: ServerSessionRequest): ServerSSHActionData {
    this.assertSessionRequest(request);
    this.requireServer(request.serverId);
    this.sessionServerBindings.set(request.sessionId, request.serverId);
    const snapshot = this.sshService.getStatus(request.sessionId);
    if (snapshot.state === 'disconnected') {
      this.sessionServerBindings.delete(request.sessionId);
    }

    return {
      serverId: request.serverId,
      sessionId: request.sessionId,
      snapshot,
    };
  }

  public recordDirectory(request: ServerDirectoryRecordRequest): ServerDirectoryRecordData {
    const normalizedPath = request.path?.trim();
    if (!normalizedPath) {
      throw new ServerServiceError('validation_error', 'path is required');
    }

    const serverId = this.resolveServerIdForDirectoryRecord(request);
    this.requireServer(serverId);
    const lastAccessedAt = new Date().toISOString();
    const existing = this.findRecentDirectory(serverId, normalizedPath);

    if (existing) {
      this.repositories.recentDirectories.update(existing.id, {
        lastAccessedAt,
      });
    } else {
      try {
        this.repositories.recentDirectories.create({
          serverId,
          path: normalizedPath,
          lastAccessedAt,
        });
      } catch (error) {
        // Concurrent updates may hit UNIQUE(server_id, path); retry as update.
        const concurrentExisting = this.findRecentDirectory(serverId, normalizedPath);
        if (concurrentExisting) {
          this.repositories.recentDirectories.update(concurrentExisting.id, {
            lastAccessedAt,
          });
        } else {
          throw new ServerServiceError('unknown_error', 'Failed to persist recent directory', this.toErrorMessage(error));
        }
      }
    }

    return {
      recorded: true,
      serverId,
      path: normalizedPath,
      lastAccessedAt,
    };
  }

  private requireServer(serverId: number): Server {
    this.assertPositiveId(serverId, 'serverId');
    const server = this.repositories.servers.findById(serverId);

    if (!server) {
      throw new ServerServiceError('not_found', `Server ${serverId} not found`);
    }

    return server;
  }

  private validateCreateServerInput(input: CreateServerInput): void {
    this.assertNonEmpty(input.name, 'server.name');
    this.assertNonEmpty(input.host, 'server.host');
    this.assertNonEmpty(input.username, 'server.username');

    if (input.port !== undefined && (!Number.isInteger(input.port) || input.port <= 0)) {
      throw new ServerServiceError('validation_error', 'server.port must be a positive integer');
    }

    if (input.authType === 'password') {
      this.assertNonEmpty(input.password ?? '', 'server.password');
      return;
    }

    this.assertNonEmpty(input.privateKeyPath ?? '', 'server.privateKeyPath');
  }

  private async toConnectionConfig(server: Server, sessionId: string): Promise<SSHConnectionConfig> {
    const auth = await this.toSSHAuth(server);
    const runtimeSshSettings = this.getRuntimeSSHSettings();

    return {
      id: `server-${server.id}-session-${sessionId}`,
      host: server.host,
      port: server.port,
      auth,
      readyTimeoutMs: runtimeSshSettings.readyTimeoutMs,
      reconnect: {
        enabled: runtimeSshSettings.reconnect.enabled,
        maxAttempts: runtimeSshSettings.reconnect.maxAttempts,
        delayMs: runtimeSshSettings.reconnect.delayMs,
      },
    };
  }

  private async toSSHAuth(server: Server): Promise<SSHAuth> {
    if (server.authType === 'password') {
      if (!server.password || !server.password.trim()) {
        throw new ServerServiceError(
          'validation_error',
          `Server ${server.id} password is required for password auth`,
        );
      }

      return {
        method: 'password',
        username: server.username,
        password: server.password,
      };
    }

    if (!server.privateKeyPath || !server.privateKeyPath.trim()) {
      throw new ServerServiceError(
        'validation_error',
        `Server ${server.id} privateKeyPath is required for private key auth`,
      );
    }

    try {
      const privateKey = await readFile(server.privateKeyPath, 'utf8');
      if (!privateKey.trim()) {
        throw new ServerServiceError(
          'validation_error',
          `Server ${server.id} private key file is empty`,
        );
      }

      return {
        method: 'privateKey',
        username: server.username,
        privateKey,
        passphrase: server.passphrase ?? undefined,
      };
    } catch (error) {
      if (error instanceof ServerServiceError) {
        throw error;
      }

      const detail = error instanceof Error ? error.message : String(error);
      throw new ServerServiceError(
        'io_error',
        `Failed to read private key from ${server.privateKeyPath}`,
        detail,
      );
    }
  }

  private assertSessionRequest(request: ServerSessionRequest): void {
    this.assertPositiveId(request.serverId, 'serverId');
    this.assertNonEmpty(request.sessionId, 'sessionId');
  }

  private assertPositiveId(value: number, field: string): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw new ServerServiceError(
        'validation_error',
        `${field} must be a positive integer`,
      );
    }
  }

  private assertNonEmpty(value: string, field: string): void {
    if (!value || !value.trim()) {
      throw new ServerServiceError('validation_error', `${field} is required`);
    }
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }
    if (typeof error === 'string' && error.trim()) {
      return error;
    }
    return 'Unknown server error';
  }

  private resolveServerIdForDirectoryRecord(request: ServerDirectoryRecordRequest): number {
    if (Number.isInteger(request.serverId) && Number(request.serverId) > 0) {
      return request.serverId as number;
    }

    const sessionId = typeof request.sessionId === 'string' ? request.sessionId.trim() : '';
    if (!sessionId) {
      throw new ServerServiceError('validation_error', 'serverId or sessionId is required');
    }

    const boundServerId = this.sessionServerBindings.get(sessionId);
    if (!boundServerId) {
      throw new ServerServiceError('validation_error', `No bound server found for session ${sessionId}`);
    }

    return boundServerId;
  }

  private findRecentDirectory(serverId: number, path: string) {
    return this.repositories.recentDirectories
      .findAll()
      .find((item) => item.serverId === serverId && item.path === path) ?? null;
  }

  private safeCreateConnectionRecord(input: {
    serverId: number;
    status: 'connected' | 'failed' | 'disconnected';
    startedAt: string;
    endedAt?: string;
    errorMessage?: string;
  }): void {
    try {
      const durationMs = this.toDurationMs(input.startedAt, input.endedAt);
      this.repositories.connectionRecords.create({
        serverId: input.serverId,
        status: input.status,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        durationMs,
        errorMessage: input.errorMessage,
      });
    } catch {
      // Best-effort logging must not break connect/disconnect flow.
    }
  }

  private safeFinalizeConnectionRecord(
    serverId: number,
    endedAt: string,
    status: 'disconnected' | 'failed',
  ): void {
    try {
      const activeRecord = this.repositories.connectionRecords
        .findAll()
        .find((item) => item.serverId === serverId && item.status === 'connected' && !item.endedAt);

      if (!activeRecord) {
        this.safeCreateConnectionRecord({
          serverId,
          status,
          startedAt: endedAt,
          endedAt,
        });
        return;
      }

      this.repositories.connectionRecords.update(activeRecord.id, {
        status,
        endedAt,
        durationMs: this.toDurationMs(activeRecord.startedAt, endedAt),
      });
    } catch {
      // Best-effort logging must not break connect/disconnect/status flow.
    }
  }

  private toDurationMs(startedAt: string, endedAt?: string): number | undefined {
    if (!endedAt) {
      return undefined;
    }

    const started = Date.parse(startedAt);
    const ended = Date.parse(endedAt);
    if (Number.isNaN(started) || Number.isNaN(ended)) {
      return undefined;
    }

    return Math.max(0, ended - started);
  }

  private getRuntimeSSHSettings(): RuntimeSSHSettings {
    const readyTimeoutMs = this.parseIntSetting(
      this.findSettingValue(RUNTIME_SETTING_KEYS.readyTimeoutMs),
      READY_TIMEOUT_RANGE.min,
      READY_TIMEOUT_RANGE.max,
      DEFAULT_READY_TIMEOUT_MS,
    );
    const reconnectEnabled = this.parseBooleanSetting(
      this.findSettingValue(RUNTIME_SETTING_KEYS.reconnectEnabled),
      DEFAULT_RECONNECT_ENABLED,
    );
    const reconnectMaxAttempts = this.parseIntSetting(
      this.findSettingValue(RUNTIME_SETTING_KEYS.reconnectMaxAttempts),
      RECONNECT_MAX_ATTEMPTS_RANGE.min,
      RECONNECT_MAX_ATTEMPTS_RANGE.max,
      DEFAULT_RECONNECT_MAX_ATTEMPTS,
    );
    const reconnectDelayMs = this.parseIntSetting(
      this.findSettingValue(RUNTIME_SETTING_KEYS.reconnectDelayMs),
      RECONNECT_DELAY_RANGE.min,
      RECONNECT_DELAY_RANGE.max,
      DEFAULT_RECONNECT_DELAY_MS,
    );

    return {
      readyTimeoutMs,
      reconnect: {
        enabled: reconnectEnabled,
        maxAttempts: reconnectMaxAttempts,
        delayMs: reconnectDelayMs,
      },
    };
  }

  private findSettingValue(keys: readonly string[]): string | null {
    for (const key of keys) {
      const entry = this.repositories.settings.findById(key);
      if (entry) {
        return entry.value;
      }
    }
    return null;
  }

  private parseIntSetting(value: string | null, min: number, max: number, fallback: number): number {
    if (typeof value !== 'string') {
      return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
  }

  private parseBooleanSetting(value: string | null, fallback: boolean): boolean {
    if (typeof value !== 'string') {
      return fallback;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
      return true;
    }

    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
      return false;
    }

    return fallback;
  }
}
