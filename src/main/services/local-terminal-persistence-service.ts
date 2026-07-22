import fs from "node:fs/promises";
import path from "node:path";

import type { AppLogger } from "../logger";
import type { SettingsRepository } from "../repositories/settings-repository";

const SNAPSHOT_KEY_PREFIX = "terminal.local.snapshot.";
const META_KEY_PREFIX = "terminal.local.meta.";
const SESSION_LOG_FILE_NAME = "term.log";
const MAX_SNAPSHOT_CHARS = 320_000;
const MAX_TRANSCRIPT_CHARS = 420_000;
const DEFAULT_MAX_DELTA_BYTES = 600_000;
const MAX_DELTA_BYTES_LIMIT = 2_000_000;

interface SessionPersistMeta {
  version: 1;
  logOffset: number;
  cols: number | null;
  rows: number | null;
  cwd: string | null;
  updatedAt: string;
}

export interface LoadPersistedTerminalStateResult {
  transcript: string;
  cwd: string | null;
  loadedAt: string;
}

export interface SaveTerminalSnapshotInput {
  sessionId: string;
  snapshot: string;
  cols?: number;
  rows?: number;
  cwd?: string;
}

export interface SaveTerminalCwdInput {
  sessionId: string;
  cwd: string;
}

export interface LoadTerminalStateInput {
  sessionId: string;
  maxBytes?: number;
}

export class LocalTerminalPersistenceService {
  private readonly baseDir: string;
  private readonly settings: SettingsRepository;
  private readonly logger?: AppLogger;
  private readonly appendQueueBySession = new Map<string, Promise<void>>();

  constructor(baseDir: string, settings: SettingsRepository, logger?: AppLogger) {
    this.baseDir = baseDir;
    this.settings = settings;
    this.logger = logger;
  }

  public appendLocalOutput(sessionId: string, data: string): void {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId || !data) {
      return;
    }

    const previous = this.appendQueueBySession.get(normalizedSessionId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        const logPath = this.resolveSessionLogPath(normalizedSessionId);
        await fs.mkdir(path.dirname(logPath), { recursive: true });
        await fs.appendFile(logPath, data, "utf8");
      });

    this.appendQueueBySession.set(normalizedSessionId, current);
    void current.finally(() => {
      if (this.appendQueueBySession.get(normalizedSessionId) === current) {
        this.appendQueueBySession.delete(normalizedSessionId);
      }
    });
  }

  public async loadState(input: LoadTerminalStateInput): Promise<LoadPersistedTerminalStateResult> {
    const sessionId = normalizeSessionId(input.sessionId);
    if (!sessionId) {
      throw new Error("sessionId is required");
    }

    await this.waitForQueuedAppends(sessionId);
    const maxDeltaBytes = normalizeMaxDeltaBytes(input.maxBytes);
    const snapshot = this.readSnapshot(sessionId);
    const meta = this.readMeta(sessionId);
    const delta = await this.readLogDelta(sessionId, meta?.logOffset ?? 0, maxDeltaBytes);
    const transcript = `${snapshot}${delta}`.slice(-MAX_TRANSCRIPT_CHARS);
    this.logger?.info(
      "terminal-replay",
      `loadState session=${sessionId} snapshotChars=${snapshot.length} deltaChars=${delta.length} transcriptChars=${transcript.length} maxDeltaBytes=${maxDeltaBytes} logOffset=${meta?.logOffset ?? 0}`,
    );

    return {
      transcript,
      cwd: meta?.cwd ?? null,
      loadedAt: new Date().toISOString(),
    };
  }

  public async saveSnapshot(input: SaveTerminalSnapshotInput): Promise<void> {
    const sessionId = normalizeSessionId(input.sessionId);
    if (!sessionId) {
      throw new Error("sessionId is required");
    }

    await this.waitForQueuedAppends(sessionId);
    const snapshot = normalizeSnapshot(input.snapshot);
    const logSize = await this.getSessionLogSize(sessionId);

    const meta: SessionPersistMeta = {
      version: 1,
      logOffset: Math.max(0, logSize),
      cols: normalizeTerminalDimension(input.cols),
      rows: normalizeTerminalDimension(input.rows),
      cwd: normalizePersistedCwd(input.cwd),
      updatedAt: new Date().toISOString(),
    };

    this.upsertSetting(this.snapshotSettingKey(sessionId), snapshot);
    this.upsertSetting(this.metaSettingKey(sessionId), JSON.stringify(meta));
  }

  public saveCwd(input: SaveTerminalCwdInput): void {
    const sessionId = normalizeSessionId(input.sessionId);
    if (!sessionId) {
      throw new Error("sessionId is required");
    }

    const cwd = normalizePersistedCwd(input.cwd);
    if (!cwd) {
      return;
    }

    const existingMeta = this.readMeta(sessionId);
    const nextMeta: SessionPersistMeta = {
      version: 1,
      logOffset: existingMeta?.logOffset ?? 0,
      cols: existingMeta?.cols ?? null,
      rows: existingMeta?.rows ?? null,
      cwd,
      updatedAt: new Date().toISOString(),
    };

    this.upsertSetting(this.metaSettingKey(sessionId), JSON.stringify(nextMeta));
  }

  public async cleanupUnusedSessionLogs(keepSessionIds: string[]): Promise<number> {
    const keepSet = new Set(
      (Array.isArray(keepSessionIds) ? keepSessionIds : [])
        .map((sessionId) => normalizeSessionId(sessionId))
        .filter(Boolean)
        .map((sessionId) => encodeURIComponent(sessionId)),
    );

    let entries;
    try {
      entries = await fs.readdir(this.baseDir, { withFileTypes: true, encoding: "utf8" });
    } catch (error) {
      if (isNotFoundError(error)) {
        return 0;
      }
      throw error;
    }

    let removedCount = 0;
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory() || keepSet.has(entry.name)) {
        return;
      }
      const logPath = path.join(this.baseDir, entry.name, SESSION_LOG_FILE_NAME);
      try {
        await fs.unlink(logPath);
        removedCount += 1;
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }
      }
    }));

    return removedCount;
  }

  private async waitForQueuedAppends(sessionId: string): Promise<void> {
    const queued = this.appendQueueBySession.get(sessionId);
    if (!queued) {
      return;
    }

    try {
      await queued;
    } catch {
      // Persistence write failures should not block terminal UI flow.
    }
  }

  private async readLogDelta(sessionId: string, offset: number, maxBytes: number): Promise<string> {
    const logPath = this.resolveSessionLogPath(sessionId);
    let logBuffer: Buffer;
    try {
      logBuffer = await fs.readFile(logPath);
    } catch (error) {
      if (isNotFoundError(error)) {
        return "";
      }
      throw error;
    }

    if (logBuffer.length === 0) {
      return "";
    }

    let start = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
    if (start > logBuffer.length) {
      start = 0;
    }

    if (logBuffer.length - start > maxBytes) {
      start = Math.max(0, logBuffer.length - maxBytes);
    }

    return logBuffer.subarray(start).toString("utf8");
  }

  private async getSessionLogSize(sessionId: string): Promise<number> {
    const logPath = this.resolveSessionLogPath(sessionId);
    try {
      const stats = await fs.stat(logPath);
      return Math.max(0, Math.floor(stats.size));
    } catch (error) {
      if (isNotFoundError(error)) {
        return 0;
      }
      throw error;
    }
  }

  private readSnapshot(sessionId: string): string {
    const setting = this.settings.findById(this.snapshotSettingKey(sessionId));
    return normalizeSnapshot(setting?.value ?? "");
  }

  private readMeta(sessionId: string): SessionPersistMeta | null {
    const setting = this.settings.findById(this.metaSettingKey(sessionId));
    if (!setting) {
      return null;
    }

    try {
      const parsed = JSON.parse(setting.value) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      const candidate = parsed as Partial<SessionPersistMeta>;
      return {
        version: 1,
        logOffset: Number.isFinite(candidate.logOffset) ? Math.max(0, Math.floor(candidate.logOffset ?? 0)) : 0,
        cols: normalizeTerminalDimension(candidate.cols),
        rows: normalizeTerminalDimension(candidate.rows),
        cwd: normalizePersistedCwd(candidate.cwd),
        updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  private upsertSetting(key: string, value: string): void {
    const existing = this.settings.findById(key);
    if (!existing) {
      this.settings.create({ key, value });
      return;
    }

    this.settings.update(key, { value });
  }

  private snapshotSettingKey(sessionId: string): string {
    return `${SNAPSHOT_KEY_PREFIX}${sessionId}`;
  }

  private metaSettingKey(sessionId: string): string {
    return `${META_KEY_PREFIX}${sessionId}`;
  }

  private resolveSessionLogPath(sessionId: string): string {
    const encodedSessionId = encodeURIComponent(sessionId);
    return path.join(this.baseDir, encodedSessionId, SESSION_LOG_FILE_NAME);
  }
}

function normalizeSessionId(sessionId: string): string {
  if (typeof sessionId !== "string") {
    return "";
  }
  return sessionId.trim().slice(0, 256);
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT",
  );
}

function normalizeMaxDeltaBytes(value: unknown): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_DELTA_BYTES;
  }

  const candidate = Math.floor(value as number);
  if (candidate <= 0) {
    return DEFAULT_MAX_DELTA_BYTES;
  }

  return Math.min(MAX_DELTA_BYTES_LIMIT, candidate);
}

function normalizeSnapshot(snapshot: unknown): string {
  if (typeof snapshot !== "string") {
    return "";
  }
  return snapshot.slice(-MAX_SNAPSHOT_CHARS);
}

function normalizeTerminalDimension(value: unknown): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.floor(value as number);
  return normalized > 0 ? normalized : null;
}

function normalizePersistedCwd(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (normalized === "~" || normalized.startsWith("~/")) {
    return normalized;
  }

  if (normalized.startsWith("/")) {
    return normalized;
  }

  if (/^[A-Za-z]:[\\/]/.test(normalized) || normalized.startsWith("\\\\")) {
    return normalized;
  }

  return null;
}
