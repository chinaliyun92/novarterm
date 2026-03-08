import type { Client, ClientChannel, ExecOptions, PseudoTtyOptions, ShellOptions } from "ssh2";
import { spawn as spawnPty, type IDisposable, type IPty } from "node-pty";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type {
  TerminalDataEvent,
  TerminalErrorEvent,
  TerminalExitEvent,
  TerminalOpenOptions,
  TerminalResizeOptions,
} from "../../shared/types/terminal";
import type {
  SftpExtractZipResponse,
  SftpTransferProgress,
  SftpListItem,
  SftpReadFileMode,
  SftpReadFileResponse,
  SSHConnectionConfig,
  SSHConnectionSnapshot,
} from "../../shared/types/ssh";
import { SSHServiceError } from "./errors";
import { toSSHErrorPayload } from "./errors";
import { SftpService } from "./sftp-service";
import { SSHConnectionManager } from "./ssh-connection-manager";

interface TerminalEventCallbacks {
  onData: (event: TerminalDataEvent) => void;
  onExit: (event: TerminalExitEvent) => void;
  onError: (event: TerminalErrorEvent) => void;
}

interface SSHTerminalContext {
  write: (data: string) => void;
  resize: (options: TerminalResizeOptions) => void;
  close: () => Promise<void>;
}

interface LocalTerminalContext {
  process: IPty;
  cwd: string;
  shellName: string | null;
  resize: (options: TerminalResizeOptions) => void;
  close: () => Promise<void>;
}

interface SSHSessionContext {
  connectionManager: SSHConnectionManager;
  sftpService: SftpService;
  terminal?: SSHTerminalContext;
}

interface SSHCommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal?: string;
}

interface TerminalOpenResult {
  localShell: string | null;
}

interface TerminalCwdOptions {
  preferRemote?: boolean;
}

export class SSHService {
  private readonly sessions = new Map<string, SSHSessionContext>();
  private readonly localTerminals = new Map<string, LocalTerminalContext>();

  public isLocalTerminalSession(sessionId: string): boolean {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return false;
    }
    return this.localTerminals.has(normalizedSessionId);
  }

  public async connect(
    sessionId: string,
    config: SSHConnectionConfig,
  ): Promise<SSHConnectionSnapshot> {
    this.assertSessionId(sessionId);
    await this.closeTerminal(sessionId);
    const context = this.getOrCreateContext(sessionId);
    const snapshot = await context.connectionManager.connect(config);
    context.sftpService.bindConfig(config);
    return snapshot;
  }

  public async disconnect(sessionId: string): Promise<SSHConnectionSnapshot> {
    this.assertSessionId(sessionId);
    await this.closeTerminal(sessionId);
    const context = this.getOrCreateContext(sessionId);
    await context.sftpService.disconnect();
    return context.connectionManager.disconnect();
  }

  public async reconnect(sessionId: string): Promise<SSHConnectionSnapshot> {
    this.assertSessionId(sessionId);
    await this.closeTerminal(sessionId);
    const context = this.getOrCreateContext(sessionId);
    await context.sftpService.disconnect();
    const snapshot = await context.connectionManager.reconnect();

    const config = context.connectionManager.getConfig();
    if (config) {
      context.sftpService.bindConfig(config);
    }

    return snapshot;
  }

  public getStatus(sessionId: string): SSHConnectionSnapshot {
    this.assertSessionId(sessionId);
    const context = this.getOrCreateContext(sessionId);
    return context.connectionManager.getState();
  }

  public async list(sessionId: string, remotePath: string): Promise<SftpListItem[]> {
    const context = this.requireConnectedSession(sessionId);
    return context.sftpService.list(remotePath);
  }

  public async get(
    sessionId: string,
    remotePath: string,
    localPath: string,
    onProgress?: (progress: SftpTransferProgress) => void,
  ): Promise<void> {
    const context = this.requireConnectedSession(sessionId);
    await context.sftpService.get(remotePath, localPath, onProgress);
  }

  public async put(
    sessionId: string,
    localPath: string,
    remotePath: string,
    onProgress?: (progress: SftpTransferProgress) => void,
  ): Promise<void> {
    const context = this.requireConnectedSession(sessionId);
    await context.sftpService.putWithProgress(localPath, remotePath, onProgress);
  }

  public async readFile(
    sessionId: string,
    remotePath: string,
    mode: SftpReadFileMode = "text",
  ): Promise<SftpReadFileResponse> {
    if (mode !== "text" && mode !== "base64") {
      throw new SSHServiceError(
        "validation_error",
        `Unsupported read mode: ${mode as string}. Expected "text" or "base64".`,
      );
    }

    const context = this.requireConnectedSession(sessionId);
    return context.sftpService.readFile(remotePath, mode);
  }

  public async writeText(sessionId: string, remotePath: string, content = ""): Promise<void> {
    if (typeof content !== "string") {
      throw new SSHServiceError("validation_error", "SFTP write content must be a string");
    }

    const context = this.requireConnectedSession(sessionId);
    await context.sftpService.writeText(remotePath, content);
  }

  public async mkdir(sessionId: string, remotePath: string, recursive = true): Promise<void> {
    const context = this.requireConnectedSession(sessionId);
    await context.sftpService.mkdir(remotePath, recursive);
  }

  public async rm(
    sessionId: string,
    remotePath: string,
    recursive = false,
    isDirectory = false,
  ): Promise<void> {
    const context = this.requireConnectedSession(sessionId);
    await context.sftpService.rm(remotePath, recursive, isDirectory);
  }

  public async rename(sessionId: string, fromPath: string, toPath: string): Promise<void> {
    const context = this.requireConnectedSession(sessionId);
    await context.sftpService.rename(fromPath, toPath);
  }

  public async extractZip(
    sessionId: string,
    remoteZipPath: string,
    targetDirectoryPath?: string,
  ): Promise<SftpExtractZipResponse> {
    const normalizedZipPath = normalizeRemoteUnixPath(remoteZipPath);
    if (!isZipFilePath(normalizedZipPath)) {
      throw new SSHServiceError(
        "validation_error",
        `Only .zip files can be extracted: ${normalizedZipPath}`,
      );
    }

    const fallbackTargetPath = toDefaultZipExtractTargetPath(normalizedZipPath);
    const parentTargetPath = toRemoteParentPath(normalizedZipPath);
    const normalizedExplicitTargetPath = targetDirectoryPath?.trim()
      ? normalizeRemoteUnixPath(targetDirectoryPath)
      : null;

    const quotedZipPath = quoteShellArg(normalizedZipPath);
    const quotedFallbackTargetPath = quoteShellArg(fallbackTargetPath);
    const quotedParentTargetPath = quoteShellArg(parentTargetPath);
    const quotedExplicitTargetPath = normalizedExplicitTargetPath
      ? quoteShellArg(normalizedExplicitTargetPath)
      : null;
    const markerPrefix = "__NOVARTERM_EXTRACT_TARGET__:";
    const command = normalizedExplicitTargetPath
      ? [
          `command -v unzip >/dev/null 2>&1 || { echo 'unzip command not found on remote host' >&2; exit 127; }`,
          `TARGET_PATH=${quotedExplicitTargetPath}`,
          `mkdir -p "$TARGET_PATH"`,
          `unzip -o ${quotedZipPath} -d "$TARGET_PATH"`,
          `printf '\\n${markerPrefix}%s\\n' "$TARGET_PATH"`,
        ].join("\n")
      : [
          `command -v unzip >/dev/null 2>&1 || { echo 'unzip command not found on remote host' >&2; exit 127; }`,
          `ZIP_PATH=${quotedZipPath}`,
          `FALLBACK_TARGET=${quotedFallbackTargetPath}`,
          `PARENT_TARGET=${quotedParentTargetPath}`,
          `LIST_FILE="$(mktemp)"`,
          `trap 'rm -f "$LIST_FILE"' EXIT`,
          `unzip -Z1 "$ZIP_PATH" > "$LIST_FILE"`,
          `TOP_COUNT="$(awk -F/ 'NF{print $1}' "$LIST_FILE" | LC_ALL=C sort -u | sed '/^$/d' | wc -l | tr -d ' ')"`,
          `TARGET_PATH="$FALLBACK_TARGET"`,
          `if [ "$TOP_COUNT" = "1" ]; then`,
          `  TOP_NAME="$(awk -F/ 'NF{print $1}' "$LIST_FILE" | sed -n '1p')"`,
          `  if ! grep -Fx -- "$TOP_NAME" "$LIST_FILE" >/dev/null 2>&1 && grep -F -- "$TOP_NAME/" "$LIST_FILE" >/dev/null 2>&1; then`,
          `    TARGET_PATH="$PARENT_TARGET"`,
          `  fi`,
          `fi`,
          `mkdir -p "$TARGET_PATH"`,
          `unzip -o "$ZIP_PATH" -d "$TARGET_PATH"`,
          `printf '\\n${markerPrefix}%s\\n' "$TARGET_PATH"`,
        ].join("\n");
    const result = await this.execCommand(sessionId, command);

    if ((result.code !== null && result.code !== 0) || result.signal) {
      const detail = (result.stderr || result.stdout || "").trim() || `Exit code: ${result.code}`;
      throw new SSHServiceError(
        "connection_error",
        `Failed to extract zip file: ${normalizedZipPath}`,
        detail,
      );
    }
    const resolvedTargetPath = parseExtractTargetFromCommandOutput(
      result.stdout,
      fallbackTargetPath,
    );

    return {
      remoteZipPath: normalizedZipPath,
      targetDirectoryPath: resolvedTargetPath,
    };
  }

  public async getTerminalCwd(sessionId: string, options: TerminalCwdOptions = {}): Promise<string> {
    const localTerminal = this.localTerminals.get(sessionId);
    const context = this.getOrCreateContext(sessionId);
    const preferRemote = options.preferRemote === true;
    const canUseRemote = context.connectionManager.isConnected();

    if (localTerminal && (!preferRemote || !canUseRemote)) {
      return localTerminal.cwd;
    }

    const result = await this.execCommand(sessionId, "pwd");

    if (result.code !== null && result.code !== 0) {
      throw new SSHServiceError(
        "connection_error",
        `Failed to get current directory (exit code ${result.code})`,
        result.stderr || result.stdout,
      );
    }

    const lines = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const cwd = lines[lines.length - 1];

    if (!cwd) {
      throw new SSHServiceError(
        "connection_error",
        "Failed to get current directory",
        result.stderr || "pwd returned empty output",
      );
    }

    return cwd;
  }

  public async openTerminal(
    sessionId: string,
    options: TerminalOpenOptions,
    callbacks: TerminalEventCallbacks,
  ): Promise<TerminalOpenResult> {
    this.assertSessionId(sessionId);
    this.assertTerminalOpenOptions(options);
    const resizedOptions = toResizeOptionsIfProvided(options);

    const forceLocal = options.forceLocal === true;
    const existingLocalTerminal = this.localTerminals.get(sessionId);
    if (existingLocalTerminal && forceLocal) {
      if (resizedOptions) {
        existingLocalTerminal.resize(resizedOptions);
      }
      return {
        localShell: existingLocalTerminal.shellName,
      };
    }

    const context = this.getOrCreateContext(sessionId);
    if (forceLocal) {
      if (context.terminal) {
        await this.closeTerminalInContext(sessionId, context);
      }

      if (existingLocalTerminal) {
        if (resizedOptions) {
          existingLocalTerminal.resize(resizedOptions);
        }
        return {
          localShell: existingLocalTerminal.shellName,
        };
      }

      let localTerminal: LocalTerminalContext | undefined;
      localTerminal = this.createLocalTerminalContext(sessionId, options, callbacks, () => {
        const activeTerminal = this.localTerminals.get(sessionId);
        if (activeTerminal === localTerminal) {
          this.localTerminals.delete(sessionId);
        }
      });
      this.localTerminals.set(sessionId, localTerminal);
      return {
        localShell: localTerminal.shellName,
      };
    }

    if (existingLocalTerminal) {
      if (resizedOptions) {
        existingLocalTerminal.resize(resizedOptions);
      }
      return {
        localShell: existingLocalTerminal.shellName,
      };
    }

    if (context.terminal) {
      if (resizedOptions) {
        context.terminal.resize(resizedOptions);
      }
      return {
        localShell: null,
      };
    }

    if (!context.connectionManager.isConnected()) {
      let localTerminal: LocalTerminalContext | undefined;
      localTerminal = this.createLocalTerminalContext(sessionId, options, callbacks, () => {
        const activeTerminal = this.localTerminals.get(sessionId);
        if (activeTerminal === localTerminal) {
          this.localTerminals.delete(sessionId);
        }
      });
      this.localTerminals.set(sessionId, localTerminal);
      return {
        localShell: localTerminal.shellName,
      };
    }

    const client = context.connectionManager.getClient();
    if (!client) {
      throw new SSHServiceError("not_connected", `Session ${sessionId} has no SSH client`);
    }

    const channel = await openTerminalChannel(client, options);

    let terminalContext: SSHTerminalContext | undefined;
    terminalContext = this.createTerminalContext(sessionId, channel, callbacks, () => {
      if (context.terminal === terminalContext) {
        context.terminal = undefined;
      }
    });
    context.terminal = terminalContext;

    return {
      localShell: null,
    };
  }

  public writeTerminal(sessionId: string, data: string): void {
    this.assertSessionId(sessionId);
    if (typeof data !== "string") {
      throw new SSHServiceError("validation_error", "Terminal write data must be a string");
    }

    const localTerminal = this.localTerminals.get(sessionId);
    if (localTerminal) {
      try {
        localTerminal.process.write(data);
      } catch (error) {
        throw new SSHServiceError("connection_error", "Local terminal write failed", error);
      }
      return;
    }

    const terminal = this.requireOpenTerminal(sessionId);
    try {
      terminal.write(data);
    } catch (error) {
      throw new SSHServiceError("connection_error", "Terminal write failed", error);
    }
  }

  public resizeTerminal(sessionId: string, options: TerminalResizeOptions): void {
    this.assertSessionId(sessionId);
    this.assertTerminalResizeOptions(options);

    const localTerminal = this.localTerminals.get(sessionId);
    if (localTerminal) {
      localTerminal.resize(options);
      return;
    }

    const terminal = this.requireOpenTerminal(sessionId);
    try {
      terminal.resize(options);
    } catch (error) {
      throw new SSHServiceError("connection_error", "Terminal resize failed", error);
    }
  }

  public async closeTerminal(sessionId: string): Promise<void> {
    this.assertSessionId(sessionId);
    const localTerminal = this.localTerminals.get(sessionId);
    if (localTerminal) {
      this.localTerminals.delete(sessionId);
      await localTerminal.close();
    }

    const context = this.getOrCreateContext(sessionId);
    await this.closeTerminalInContext(sessionId, context);
  }

  public async closeAllTerminals(): Promise<void> {
    const closingTasks: Promise<void>[] = [];
    for (const [sessionId, localTerminal] of this.localTerminals) {
      this.localTerminals.delete(sessionId);
      closingTasks.push(localTerminal.close());
    }
    for (const [sessionId, context] of this.sessions) {
      closingTasks.push(this.closeTerminalInContext(sessionId, context));
    }
    await Promise.allSettled(closingTasks);
  }

  private requireConnectedSession(sessionId: string): SSHSessionContext {
    this.assertSessionId(sessionId);
    const context = this.getOrCreateContext(sessionId);

    if (!context.connectionManager.isConnected()) {
      throw new SSHServiceError("not_connected", `Session ${sessionId} is not connected`);
    }

    const config = context.connectionManager.getConfig();
    if (!config) {
      throw new SSHServiceError("not_connected", `Session ${sessionId} has no SSH config`);
    }

    context.sftpService.bindConfig(config);
    return context;
  }

  private requireOpenTerminal(sessionId: string): SSHTerminalContext {
    const context = this.requireConnectedSession(sessionId);
    if (!context.terminal) {
      throw new SSHServiceError("not_connected", `Terminal for session ${sessionId} is not open`);
    }
    return context.terminal;
  }

  private async execCommand(sessionId: string, command: string): Promise<SSHCommandResult> {
    this.assertSessionId(sessionId);
    if (!command.trim()) {
      throw new SSHServiceError("validation_error", "Command must not be empty");
    }

    const context = this.requireConnectedSession(sessionId);
    const client = context.connectionManager.getClient();
    if (!client) {
      throw new SSHServiceError("not_connected", `Session ${sessionId} has no SSH client`);
    }

    return execCommandOnClient(client, command);
  }

  private async closeTerminalInContext(sessionId: string, context: SSHSessionContext): Promise<void> {
    if (!context.terminal) {
      return;
    }

    const terminal = context.terminal;
    context.terminal = undefined;

    try {
      await terminal.close();
    } catch (error) {
      throw new SSHServiceError("connection_error", `Failed to close terminal for ${sessionId}`, error);
    }
  }

  private createTerminalContext(
    sessionId: string,
    channel: ClientChannel,
    callbacks: TerminalEventCallbacks,
    onDisposed: () => void,
  ): SSHTerminalContext {
    let disposed = false;
    let exitEmitted = false;
    let closePromise: Promise<void> | null = null;
    let resolveClosed: (() => void) | null = null;

    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    const emitExit = (event: TerminalExitEvent): void => {
      if (exitEmitted) {
        return;
      }
      exitEmitted = true;
      callbacks.onExit(event);
    };

    const dispose = () => {
      if (disposed) {
        return;
      }
      disposed = true;
      channel.off("data", onStdoutData);
      channel.stderr.off("data", onStderrData);
      channel.off("error", onChannelError);
      channel.off("close", onChannelClose);
      channel.off("exit", onChannelExit);
      onDisposed();
      resolveClosed?.();
      resolveClosed = null;
    };

    const onStdoutData = (chunk: Buffer | string) => {
      callbacks.onData({
        sessionId,
        stream: "stdout",
        data: toChunkString(chunk),
      });
    };

    const onStderrData = (chunk: Buffer | string) => {
      callbacks.onData({
        sessionId,
        stream: "stderr",
        data: toChunkString(chunk),
      });
    };

    const onChannelError = (error: Error) => {
      callbacks.onError({
        sessionId,
        error: toSSHErrorPayload(error, "connection_error"),
      });
    };

    const onChannelExit = (
      codeOrNull: number | null,
      signal?: string,
      dump?: string,
      description?: string,
    ) => {
      if (typeof codeOrNull === "number") {
        emitExit({
          sessionId,
          code: codeOrNull,
        });
        return;
      }

      emitExit({
        sessionId,
        code: null,
        signal,
        dump,
        description,
      });
    };

    const onChannelClose = () => {
      emitExit({
        sessionId,
      });
      dispose();
    };

    channel.on("data", onStdoutData);
    channel.stderr.on("data", onStderrData);
    channel.on("error", onChannelError);
    channel.on("exit", onChannelExit);
    channel.on("close", onChannelClose);

    return {
      write: (data: string) => {
        channel.write(data);
      },
      resize: (options: TerminalResizeOptions) => {
        channel.setWindow(options.rows, options.cols, options.height ?? 0, options.width ?? 0);
      },
      close: async () => {
        if (closePromise) {
          await closePromise;
          return;
        }

        closePromise = (async () => {
          try {
            channel.close();
          } catch {
            // Ignore close() errors because the SSH channel may already be closed.
          }

          await Promise.race([closed, sleep(200)]);
          emitExit({ sessionId });
          dispose();
        })();

        await closePromise;
      },
    };
  }

  private createLocalTerminalContext(
    sessionId: string,
    options: TerminalOpenOptions,
    callbacks: TerminalEventCallbacks,
    onDisposed: () => void,
  ): LocalTerminalContext {
    const initialCwd = resolveLocalStartupCwd(options.cwd);
    const { pty, shellName } = startLocalPtyWithFallback(options, initialCwd);

    let closePromise: Promise<void> | null = null;
    let disposed = false;
    let exitEmitted = false;
    let resolveClosed: (() => void) | null = null;
    let onDataDisposable: IDisposable | null = null;
    let onExitDisposable: IDisposable | null = null;

    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    const localTerminal: LocalTerminalContext = {
      process: pty,
      cwd: initialCwd,
      shellName,
      resize: (nextOptions: TerminalResizeOptions) => {
        try {
          pty.resize(nextOptions.cols, nextOptions.rows);
        } catch {
          // Ignore resize errors when process is exiting or already disposed.
        }
      },
      close: async () => {
        if (closePromise) {
          await closePromise;
          return;
        }

        closePromise = (async () => {
          if (disposed) {
            return;
          }

          try {
            pty.kill();
          } catch {
            // Ignore kill errors when process has already exited.
          }

          await Promise.race([closed, sleep(250)]);
          if (!disposed) {
            try {
              pty.kill("SIGKILL");
            } catch {
              // Ignore forced kill errors during shutdown.
            }
          }

          emitExit({ sessionId });
          dispose();
        })();

        await closePromise;
      },
    };

    const emitExit = (event: TerminalExitEvent): void => {
      if (exitEmitted) {
        return;
      }
      exitEmitted = true;
      callbacks.onExit(event);
    };

    const dispose = (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      onDataDisposable?.dispose();
      onDataDisposable = null;
      onExitDisposable?.dispose();
      onExitDisposable = null;
      onDisposed();
      resolveClosed?.();
      resolveClosed = null;
    };

    const onPtyData = (data: string): void => {
      callbacks.onData({
        sessionId,
        stream: "stdout",
        data,
      });
      const nextCwd = extractLatestCwdFromAnsiChunk(data);
      if (nextCwd) {
        localTerminal.cwd = nextCwd;
      }
    };

    const onPtyExit = (event: { exitCode: number; signal?: number }): void => {
      emitExit({
        sessionId,
        code: typeof event.exitCode === "number" ? event.exitCode : null,
        signal: typeof event.signal === "number" ? String(event.signal) : undefined,
      });
      dispose();
    };

    onDataDisposable = pty.onData(onPtyData);
    onExitDisposable = pty.onExit(onPtyExit);

    return localTerminal;
  }

  private getOrCreateContext(sessionId: string): SSHSessionContext {
    const existingContext = this.sessions.get(sessionId);
    if (existingContext) {
      return existingContext;
    }

    const context: SSHSessionContext = {
      connectionManager: new SSHConnectionManager(),
      sftpService: new SftpService(),
    };

    context.connectionManager.onStateChanged((snapshot) => {
      if (snapshot.state === "disconnected" || snapshot.state === "failed") {
        void this.closeTerminalInContext(sessionId, context).catch(() => {
          // Ignore close errors triggered from lifecycle cleanup path.
        });
      }
    });

    this.sessions.set(sessionId, context);
    return context;
  }

  private assertTerminalOpenOptions(options: TerminalOpenOptions): void {
    if (options.cols !== undefined && (!Number.isFinite(options.cols) || options.cols <= 0)) {
      throw new SSHServiceError("validation_error", "Terminal cols must be greater than 0");
    }

    if (options.rows !== undefined && (!Number.isFinite(options.rows) || options.rows <= 0)) {
      throw new SSHServiceError("validation_error", "Terminal rows must be greater than 0");
    }

    if (options.shellPath !== undefined && typeof options.shellPath !== "string") {
      throw new SSHServiceError("validation_error", "Terminal shellPath must be a string");
    }

    if (options.command !== undefined && typeof options.command !== "string") {
      throw new SSHServiceError("validation_error", "Terminal command must be a string");
    }

    if (options.cwd !== undefined && typeof options.cwd !== "string") {
      throw new SSHServiceError("validation_error", "Terminal cwd must be a string");
    }

    if (options.forceLocal !== undefined && typeof options.forceLocal !== "boolean") {
      throw new SSHServiceError("validation_error", "Terminal forceLocal must be a boolean");
    }
  }

  private assertTerminalResizeOptions(options: TerminalResizeOptions): void {
    if (!Number.isFinite(options.cols) || options.cols <= 0) {
      throw new SSHServiceError("validation_error", "Terminal cols must be greater than 0");
    }

    if (!Number.isFinite(options.rows) || options.rows <= 0) {
      throw new SSHServiceError("validation_error", "Terminal rows must be greater than 0");
    }
  }

  private assertSessionId(sessionId: string): void {
    if (!sessionId || !sessionId.trim()) {
      throw new SSHServiceError("validation_error", "sessionId is required");
    }
  }
}

function toPtyOptions(options: TerminalOpenOptions): PseudoTtyOptions {
  return {
    cols: options.cols,
    rows: options.rows,
    width: options.width,
    height: options.height,
    term: options.term ?? "xterm-256color",
  };
}

function toResizeOptionsIfProvided(options: TerminalOpenOptions): TerminalResizeOptions | null {
  if (
    !Number.isFinite(options.cols) ||
    !Number.isFinite(options.rows) ||
    (options.cols ?? 0) <= 0 ||
    (options.rows ?? 0) <= 0
  ) {
    return null;
  }

  return {
    cols: Math.max(1, Math.floor(options.cols as number)),
    rows: Math.max(1, Math.floor(options.rows as number)),
    width: options.width,
    height: options.height,
  };
}

function toShellOptions(options: TerminalOpenOptions): ShellOptions {
  return {
    env: options.env ? { ...options.env } : undefined,
  };
}

function toExecOptions(options: TerminalOpenOptions): ExecOptions {
  return {
    env: options.env ? { ...options.env } : undefined,
    pty: toPtyOptions(options),
  };
}

function resolveTerminalCommand(options: TerminalOpenOptions): string | null {
  const shellPath = options.shellPath?.trim();
  if (shellPath) {
    return shellPath;
  }

  const command = options.command?.trim();
  return command || null;
}

function openTerminalChannel(client: Client, options: TerminalOpenOptions): Promise<ClientChannel> {
  const command = resolveTerminalCommand(options);

  return new Promise<ClientChannel>((resolve, reject) => {
    if (command) {
      client.exec(command, toExecOptions(options), (error, stream) => {
        if (error) {
          reject(new SSHServiceError("connection_error", "Failed to open SSH exec terminal", error));
          return;
        }

        resolve(stream);
      });
      return;
    }

    client.shell(
      toPtyOptions(options),
      toShellOptions(options),
      (error, stream) => {
        if (error) {
          reject(new SSHServiceError("connection_error", "Failed to open SSH shell", error));
          return;
        }

        resolve(stream);
      },
    );
  });
}

function toChunkString(chunk: Buffer | string): string {
  return typeof chunk === "string" ? chunk : chunk.toString("utf8");
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function normalizeRemoteUnixPath(input: string): string {
  const replaced = input.replaceAll("\\", "/").trim();
  if (!replaced) {
    throw new SSHServiceError("validation_error", "Path must not be empty");
  }

  const collapsed = replaced.replace(/\/{2,}/g, "/");
  const normalized = collapsed.startsWith("/") ? collapsed : `/${collapsed}`;
  return normalized.length > 1 && normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
}

function isZipFilePath(remotePath: string): boolean {
  const baseName = path.posix.basename(remotePath);
  return /\.zip$/i.test(baseName);
}

function toDefaultZipExtractTargetPath(remoteZipPath: string): string {
  const baseName = path.posix.basename(remoteZipPath);
  const targetNameCandidate = baseName.replace(/\.zip$/i, "").trim();
  const targetName = targetNameCandidate || "archive";
  const parentPath = path.posix.dirname(remoteZipPath);
  return path.posix.join(parentPath || "/", targetName);
}

function toRemoteParentPath(remotePath: string): string {
  const parentPath = path.posix.dirname(remotePath);
  return parentPath && parentPath !== "." ? parentPath : "/";
}

function parseExtractTargetFromCommandOutput(stdout: string, fallbackPath: string): string {
  const markerPrefix = "__NOVARTERM_EXTRACT_TARGET__:";
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith(markerPrefix)) {
      continue;
    }
    const value = line.slice(markerPrefix.length).trim();
    if (value) {
      return value;
    }
  }

  return fallbackPath;
}

function execCommandOnClient(client: Client, command: string): Promise<SSHCommandResult> {
  return new Promise<SSHCommandResult>((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(
          new SSHServiceError(
            "connection_error",
            `Failed to execute SSH command: ${command}`,
            error,
          ),
        );
        return;
      }

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      let settled = false;

      const cleanup = () => {
        stream.off("data", onStdoutData);
        stream.stderr.off("data", onStderrData);
        stream.off("error", onStreamError);
        stream.off("close", onStreamClose);
      };

      const settleResolve = (result: SSHCommandResult) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(result);
      };

      const settleReject = (execError: SSHServiceError) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(execError);
      };

      const onStdoutData = (chunk: Buffer | string) => {
        stdoutChunks.push(toChunkString(chunk));
      };

      const onStderrData = (chunk: Buffer | string) => {
        stderrChunks.push(toChunkString(chunk));
      };

      const onStreamError = (streamError: Error) => {
        settleReject(
          new SSHServiceError(
            "connection_error",
            `Failed to execute SSH command: ${command}`,
            streamError,
          ),
        );
      };

      const onStreamClose = (code?: number, signal?: string) => {
        settleResolve({
          stdout: stdoutChunks.join(""),
          stderr: stderrChunks.join(""),
          code: typeof code === "number" ? code : null,
          signal,
        });
      };

      stream.on("data", onStdoutData);
      stream.stderr.on("data", onStderrData);
      stream.on("error", onStreamError);
      stream.on("close", onStreamClose);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface LocalShellLaunchSpec {
  command: string;
  args: string[];
}

const nodeRequire = createRequire(__filename);
let nodePtyHelperPermissionChecked = false;

function normalizeLocalShellName(command: string): string | null {
  const basename = path.basename(command.trim()).toLowerCase();
  if (!basename) {
    return null;
  }

  if (basename === "zsh" || basename.endsWith("/zsh")) {
    return "zsh";
  }

  if (basename === "bash" || basename.endsWith("/bash")) {
    return "bash";
  }

  if (basename === "pwsh" || basename === "pwsh.exe") {
    return "pwsh";
  }

  if (basename === "powershell" || basename === "powershell.exe") {
    return "powershell";
  }

  if (basename === "cmd" || basename === "cmd.exe") {
    return "cmd";
  }

  if (basename === "sh" || basename.endsWith("/sh")) {
    return "sh";
  }

  return basename;
}

function startLocalPtyWithFallback(
  options: TerminalOpenOptions,
  cwd: string,
): { pty: IPty; shellName: string | null } {
  ensureNodePtySpawnHelperExecutable();

  const termName = options.term ?? process.env.TERM ?? "xterm-256color";
  const cols = Math.max(1, Math.floor(options.cols ?? 120));
  const rows = Math.max(1, Math.floor(options.rows ?? 36));
  const env = {
    ...process.env,
    PWD: cwd,
    TERM: termName,
    // Avoid zsh rendering a standalone "%" end-of-line marker after command output.
    PROMPT_EOL_MARK: "",
    ...(options.env ?? {}),
  };
  const launchSpecs = resolveLocalShellLaunchCandidates(options);
  let lastError: unknown = null;

  for (const launchSpec of launchSpecs) {
    try {
      const pty = spawnPty(launchSpec.command, launchSpec.args, {
        name: termName,
        cols,
        rows,
        cwd,
        env,
      });
      return {
        pty,
        shellName: normalizeLocalShellName(launchSpec.command),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new SSHServiceError(
    "connection_error",
    "Failed to start local shell (all candidate shell commands failed)",
    lastError,
  );
}

function ensureNodePtySpawnHelperExecutable(): void {
  if (nodePtyHelperPermissionChecked) {
    return;
  }
  nodePtyHelperPermissionChecked = true;

  if (process.platform === "win32") {
    return;
  }

  let packageDir: string;
  try {
    const packageJsonPath = nodeRequire.resolve("node-pty/package.json");
    packageDir = path.dirname(packageJsonPath);
  } catch {
    return;
  }

  const candidates = [
    path.join(packageDir, "build", "Release", "spawn-helper"),
    path.join(packageDir, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    path.join(packageDir, "prebuilds", "darwin-arm64", "spawn-helper"),
    path.join(packageDir, "prebuilds", "darwin-x64", "spawn-helper"),
    path.join(packageDir, "prebuilds", "linux-x64", "spawn-helper"),
    path.join(packageDir, "prebuilds", "linux-arm64", "spawn-helper"),
  ];

  for (const helperPath of candidates) {
    try {
      const stats = fs.statSync(helperPath);
      if (!stats.isFile()) {
        continue;
      }
      if ((stats.mode & 0o111) !== 0) {
        continue;
      }
      fs.chmodSync(helperPath, 0o755);
    } catch {
      // Best effort: permission fix should never block terminal startup.
    }
  }
}

function resolveLocalShellLaunchCandidates(options: TerminalOpenOptions): LocalShellLaunchSpec[] {
  const candidates: LocalShellLaunchSpec[] = [resolveLocalShellLaunchSpec(options)];
  const command = options.command?.trim();
  const fallbackShells = resolveLocalShellFallbackCommands();

  if (command) {
    for (const fallbackShell of fallbackShells) {
      if (process.platform === "win32") {
        candidates.push({
          command: fallbackShell,
          args: isPowerShellPath(fallbackShell)
            ? ["-NoLogo", "-Command", command]
            : ["/c", command],
        });
      } else {
        candidates.push({
          command: fallbackShell,
          args: ["-lc", command],
        });
      }
    }
  } else {
    for (const fallbackShell of fallbackShells) {
      candidates.push(toInteractiveLaunchSpec(fallbackShell));
    }
  }

  return dedupeLocalShellLaunchSpecs(candidates);
}

function dedupeLocalShellLaunchSpecs(specs: LocalShellLaunchSpec[]): LocalShellLaunchSpec[] {
  const seen = new Set<string>();
  const result: LocalShellLaunchSpec[] = [];

  for (const spec of specs) {
    const key = `${spec.command}\u0000${spec.args.join("\u0000")}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(spec);
  }

  return result;
}

function resolveLocalShellFallbackCommands(): string[] {
  const defaults =
    process.platform === "win32"
      ? [resolveDefaultLocalShellPath(), "powershell.exe", "pwsh.exe", "cmd.exe"]
      : [resolveDefaultLocalShellPath(), "/bin/zsh", "/bin/bash", "/bin/sh"];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of defaults) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function toInteractiveLaunchSpec(command: string): LocalShellLaunchSpec {
  if (isPowerShellPath(command)) {
    return {
      command,
      args: ["-NoLogo"],
    };
  }

  const unixInteractiveArgs = resolveUnixInteractiveArgs(command);

  return {
    command,
    args: process.platform === "win32" ? [] : unixInteractiveArgs,
  };
}

function resolveLocalShellLaunchSpec(options: TerminalOpenOptions): LocalShellLaunchSpec {
  const explicitShellSpec = resolveExplicitShellLaunchSpec(options.shellPath);
  const defaultShellPath = resolveDefaultLocalShellPath();

  if (explicitShellSpec) {
    return explicitShellSpec;
  }

  const command = options.command?.trim();
  if (command) {
    if (process.platform === "win32") {
      return {
        command: defaultShellPath,
        args: isPowerShellPath(defaultShellPath)
          ? ["-NoLogo", "-Command", command]
          : ["/c", command],
      };
    }

    return {
      command: defaultShellPath,
      args: ["-lc", command],
    };
  }

  if (isPowerShellPath(defaultShellPath)) {
    return {
      command: defaultShellPath,
      args: ["-NoLogo"],
    };
  }

  const unixInteractiveArgs = resolveUnixInteractiveArgs(defaultShellPath);

  return {
    command: defaultShellPath,
    args: process.platform === "win32" ? [] : unixInteractiveArgs,
  };
}

function resolveUnixInteractiveArgs(commandPath: string): string[] {
  if (process.platform === "win32") {
    return [];
  }

  const basename = path.basename(commandPath.trim()).toLowerCase();
  const baseArgs = shouldUseLoginInteractiveShell(commandPath) ? ["-il"] : ["-i"];

  // zsh may print a standalone "%" line when prompt spacing is enabled and
  // the previous command output/newline state is ambiguous after resize/attach.
  // Disable prompt spacing at startup for a stable terminal transcript.
  if (basename === "zsh") {
    return [...baseArgs, "-o", "no_prompt_sp"];
  }

  return baseArgs;
}

function shouldUseLoginInteractiveShell(commandPath: string): boolean {
  if (process.platform === "win32") {
    return false;
  }

  const normalized = path.basename(commandPath.trim()).toLowerCase();
  return normalized === "zsh" || normalized === "bash";
}

function resolveExplicitShellLaunchSpec(shellPath: string | undefined): LocalShellLaunchSpec | null {
  const shellPathValue = shellPath?.trim();
  if (!shellPathValue) {
    return null;
  }

  const tokens = splitShellWords(shellPathValue);
  if (!tokens.length) {
    return null;
  }

  const command = tokens[0];
  const args = tokens.slice(1);
  if (args.length > 0) {
    return { command, args };
  }

  return toInteractiveLaunchSpec(command);
}

function splitShellWords(input: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        result.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += "\\";
  }

  if (current) {
    result.push(current);
  }

  return result;
}

function resolveDefaultLocalShellPath(): string {
  if (process.platform === "win32") {
    return "powershell.exe";
  }

  return process.env.SHELL?.trim() || "/bin/zsh";
}

function resolveDefaultLocalCwd(): string {
  const fromHome = process.env.HOME?.trim();
  if (fromHome && path.isAbsolute(fromHome)) {
    return fromHome;
  }

  const fromUserProfile = process.env.USERPROFILE?.trim();
  if (fromUserProfile && path.isAbsolute(fromUserProfile)) {
    return fromUserProfile;
  }

  const osHome = os.homedir().trim();
  if (osHome && path.isAbsolute(osHome)) {
    return osHome;
  }

  return process.cwd();
}

function resolveLocalStartupCwd(requestedCwd: string | undefined): string {
  const defaultCwd = resolveDefaultLocalCwd();
  const normalizedRequested = normalizeRequestedLocalCwd(requestedCwd, defaultCwd);
  if (!normalizedRequested) {
    return defaultCwd;
  }

  try {
    if (fs.statSync(normalizedRequested).isDirectory()) {
      return normalizedRequested;
    }
  } catch {
    // Ignore invalid persisted cwd and fallback to default home cwd.
  }

  return defaultCwd;
}

function normalizeRequestedLocalCwd(requestedCwd: string | undefined, defaultCwd: string): string | null {
  if (typeof requestedCwd !== "string") {
    return null;
  }

  const raw = requestedCwd.trim();
  if (!raw) {
    return null;
  }

  if (raw === "~") {
    return defaultCwd;
  }

  if (raw.startsWith("~/")) {
    const suffix = raw.slice(2).trim();
    if (!suffix) {
      return defaultCwd;
    }
    return path.join(defaultCwd, suffix);
  }

  if (!path.isAbsolute(raw)) {
    return null;
  }

  return raw;
}

function isPowerShellPath(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return (
    normalized.endsWith("pwsh") ||
    normalized.endsWith("pwsh.exe") ||
    normalized.endsWith("powershell") ||
    normalized.endsWith("powershell.exe")
  );
}

function extractLatestCwdFromAnsiChunk(chunk: string): string | null {
  const marker = "\u001b]7;file://";
  let cursor = 0;
  let latestPath: string | null = null;

  while (true) {
    const start = chunk.indexOf(marker, cursor);
    if (start < 0) {
      break;
    }

    const payloadStart = start + marker.length;
    const bellTerminator = chunk.indexOf("\u0007", payloadStart);
    const stTerminator = chunk.indexOf("\u001b\\", payloadStart);

    let end = bellTerminator;
    let terminatorLength = 1;
    if (end < 0 || (stTerminator >= 0 && stTerminator < end)) {
      end = stTerminator;
      terminatorLength = 2;
    }

    if (end < 0) {
      break;
    }

    const rawBody = chunk.slice(payloadStart, end);
    const slashIndex = rawBody.indexOf("/");
    if (slashIndex >= 0) {
      const rawPath = rawBody.slice(slashIndex);
      try {
        latestPath = decodeURIComponent(rawPath);
      } catch {
        latestPath = rawPath;
      }
    }

    cursor = end + terminatorLength;
  }

  return latestPath;
}
