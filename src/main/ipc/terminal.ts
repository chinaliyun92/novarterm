import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import {
  TERMINAL_IPC_CHANNELS,
  TERMINAL_IPC_EVENTS,
} from "../../shared/ipc/channels";
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
} from "../../shared/types/terminal";
import type { AppLogger } from "../logger";
import type { SettingsRepository } from "../repositories/settings-repository";
import { LocalTerminalPersistenceService } from "../services/local-terminal-persistence-service";
import { toSSHErrorPayload } from "../ssh/errors";
import { getSharedSSHService } from "./ssh";

type IpcMainLike = Pick<IpcMain, "handle" | "removeHandler">;

const sshService = getSharedSSHService();
let localTerminalPersistenceService: LocalTerminalPersistenceService | null = null;
const TERMINAL_TEMP_FILE_PREFIX = "novarterm-terminal-";
const TERMINAL_TEMP_FILE_MAX_BYTES = 25 * 1024 * 1024;
const TERMINAL_TEMP_FILE_DEFAULT_NAME = "pasted-file";
const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

function normalizeBase64Payload(rawValue: string): string {
  const trimmed = rawValue.trim();
  const withoutDataUrlPrefix = trimmed.replace(/^data:[^,]+,/, "");
  const compact = withoutDataUrlPrefix.replace(/\s+/g, "");
  if (!compact) {
    throw new Error("dataBase64 is empty");
  }
  if (compact.length % 4 === 1) {
    throw new Error("invalid base64 payload");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new Error("invalid base64 characters");
  }
  return compact;
}

function toSafeTempBaseName(fileName?: string): string {
  const baseName = path.basename((fileName ?? "").trim());
  const sanitized = baseName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  if (!sanitized || sanitized === "." || sanitized === "..") {
    return TERMINAL_TEMP_FILE_DEFAULT_NAME;
  }
  return sanitized;
}

function toExtensionFromMimeType(mimeType?: string): string | null {
  if (!mimeType) {
    return null;
  }
  const normalized = mimeType.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return MIME_EXTENSION_MAP[normalized] ?? null;
}

function withPreferredExtension(fileName: string, mimeType?: string): string {
  if (path.extname(fileName)) {
    return fileName;
  }
  const extension = toExtensionFromMimeType(mimeType);
  if (!extension) {
    return fileName;
  }
  return `${fileName}.${extension}`;
}

async function writeTempFile(request: TerminalWriteTempFileRequest): Promise<TerminalWriteTempFileResponse> {
  if (!request || typeof request !== "object") {
    throw new Error("request payload is required");
  }
  if (typeof request.dataBase64 !== "string") {
    throw new Error("dataBase64 must be a string");
  }

  const normalizedBase64 = normalizeBase64Payload(request.dataBase64);
  const decodedData = Buffer.from(normalizedBase64, "base64");
  if (!decodedData.length) {
    throw new Error("decoded data is empty");
  }
  if (decodedData.length > TERMINAL_TEMP_FILE_MAX_BYTES) {
    throw new Error(`payload too large (> ${TERMINAL_TEMP_FILE_MAX_BYTES} bytes)`);
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), TERMINAL_TEMP_FILE_PREFIX));
  const safeFileName = withPreferredExtension(toSafeTempBaseName(request.fileName), request.mimeType);
  const targetPath = path.join(tempDir, safeFileName);

  await writeFile(targetPath, decodedData, { mode: 0o600 });

  return {
    path: targetPath,
  } satisfies TerminalWriteTempFileResponse;
}

interface RegisterTerminalIPCOptions {
  settingsRepository?: SettingsRepository;
  userDataPath?: string;
  logger?: AppLogger;
}

export function registerTerminalIPCHandlers(
  ipcMain: IpcMainLike,
  options: RegisterTerminalIPCOptions = {},
): void {
  clearTerminalIPCHandlers(ipcMain);
  localTerminalPersistenceService = createPersistenceService(options);

  ipcMain.handle(
    TERMINAL_IPC_CHANNELS.open,
    async (event: IpcMainInvokeEvent, request: TerminalOpenRequest) =>
      toResult(async () => {
        const sender = event.sender;
        const openResult = await sshService.openTerminal(
          request.sessionId,
          {
            cols: request.cols,
            rows: request.rows,
            width: request.width,
            height: request.height,
            term: request.term,
            env: request.env,
            shellPath: request.shellPath,
            command: request.command,
            cwd: request.cwd,
            forceLocal: request.forceLocal,
          },
          {
            onData: (payload) => {
              if (
                payload.data &&
                payload.stream === "stdout" &&
                sshService.isLocalTerminalSession(payload.sessionId)
              ) {
                localTerminalPersistenceService?.appendLocalOutput(payload.sessionId, payload.data);
              }
              sendToSender(sender, TERMINAL_IPC_EVENTS.data, payload);
            },
            onExit: (payload) => {
              sendToSender(sender, TERMINAL_IPC_EVENTS.exit, payload);
            },
            onError: (payload) => {
              sendToSender(sender, TERMINAL_IPC_EVENTS.error, payload);
            },
          },
        );

        return {
          opened: true,
          localShell: openResult.localShell,
        } satisfies TerminalOpenResponse;
      }),
  );

  ipcMain.handle(
    TERMINAL_IPC_CHANNELS.loadPersisted,
    async (_event: IpcMainInvokeEvent, request: TerminalLoadPersistedRequest) =>
      toResult(async () => {
        const data =
          (await localTerminalPersistenceService?.loadState({
            sessionId: request.sessionId,
            maxBytes: request.maxBytes,
          })) ??
          ({
            transcript: "",
            history: [],
            loadedAt: new Date().toISOString(),
          } satisfies TerminalLoadPersistedResponse);

        return data;
      }),
  );

  ipcMain.handle(
    TERMINAL_IPC_CHANNELS.saveSnapshot,
    async (_event: IpcMainInvokeEvent, request: TerminalSaveSnapshotRequest) =>
      toResult(async () => {
        if (localTerminalPersistenceService) {
          await localTerminalPersistenceService.saveSnapshot({
            sessionId: request.sessionId,
            snapshot: request.snapshot,
            cols: request.cols,
            rows: request.rows,
            cwd: request.cwd,
          });
        }

        return {
          saved: true,
        } satisfies TerminalSaveSnapshotResponse;
      }),
  );

  ipcMain.handle(
    TERMINAL_IPC_CHANNELS.saveHistory,
    async (_event: IpcMainInvokeEvent, request: TerminalSaveHistoryRequest) =>
      toResult(async () => {
        if (localTerminalPersistenceService) {
          localTerminalPersistenceService.saveHistory({
            sessionId: request.sessionId,
            history: request.history,
          });
        }

        return {
          saved: true,
        } satisfies TerminalSaveHistoryResponse;
      }),
  );

  ipcMain.handle(
    TERMINAL_IPC_CHANNELS.writeTempFile,
    async (_event: IpcMainInvokeEvent, request: TerminalWriteTempFileRequest) =>
      toResult(async () => writeTempFile(request)),
  );

  ipcMain.handle(
    TERMINAL_IPC_CHANNELS.write,
    async (_event: IpcMainInvokeEvent, request: TerminalWriteRequest) =>
      toResult(async () => {
        sshService.writeTerminal(request.sessionId, request.data);
        return {
          written: true,
        } satisfies TerminalWriteResponse;
      }),
  );

  ipcMain.handle(
    TERMINAL_IPC_CHANNELS.resize,
    async (_event: IpcMainInvokeEvent, request: TerminalResizeRequest) =>
      toResult(async () => {
        sshService.resizeTerminal(request.sessionId, {
          cols: request.cols,
          rows: request.rows,
          width: request.width,
          height: request.height,
        });
        return {
          resized: true,
        } satisfies TerminalResizeResponse;
      }),
  );

  ipcMain.handle(
    TERMINAL_IPC_CHANNELS.close,
    async (_event: IpcMainInvokeEvent, request: TerminalCloseRequest) =>
      toResult(async () => {
        await sshService.closeTerminal(request.sessionId);
        return {
          closed: true,
        } satisfies TerminalCloseResponse;
      }),
  );

  ipcMain.handle(
    TERMINAL_IPC_CHANNELS.getCwd,
    async (_event: IpcMainInvokeEvent, request: TerminalGetCwdRequest) =>
      toResult(async () => {
        const preferredCwd = await sshService.getTerminalCwd(request.sessionId, {
          preferRemote: request.preferRemote === true,
        });
        return {
          cwd: preferredCwd,
        } satisfies TerminalGetCwdResponse;
      }),
  );
}

export function clearTerminalIPCHandlers(ipcMain: IpcMainLike): void {
  for (const channel of Object.values(TERMINAL_IPC_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }
  localTerminalPersistenceService = null;

  void sshService.closeAllTerminals().catch(() => {
    // Ignore close errors during app shutdown or handler replacement.
  });
}

async function toResult<T>(execute: () => Promise<T>): Promise<TerminalResult<T>> {
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

function sendToSender(
  sender: WebContents,
  channel: typeof TERMINAL_IPC_EVENTS.data,
  payload: TerminalDataEvent,
): void;
function sendToSender(
  sender: WebContents,
  channel: typeof TERMINAL_IPC_EVENTS.exit,
  payload: TerminalExitEvent,
): void;
function sendToSender(
  sender: WebContents,
  channel: typeof TERMINAL_IPC_EVENTS.error,
  payload: TerminalErrorEvent,
): void;
function sendToSender(
  sender: WebContents,
  channel: string,
  payload: TerminalDataEvent | TerminalExitEvent | TerminalErrorEvent,
): void {
  if (sender.isDestroyed()) {
    return;
  }

  sender.send(channel, payload);
}

function createPersistenceService(
  options: RegisterTerminalIPCOptions,
): LocalTerminalPersistenceService | null {
  if (!options.settingsRepository || !options.userDataPath) {
    return null;
  }

  const baseDir = path.join(options.userDataPath, "terminal-history");
  const service = new LocalTerminalPersistenceService(baseDir, options.settingsRepository);
  options.logger?.info("terminal-persistence", `local terminal persistence enabled at ${baseDir}`);
  return service;
}
