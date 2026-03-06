import { EventEmitter } from "node:events";
import { Client } from "ssh2";
import type {
  SSHConnectionConfig,
  SSHConnectionSnapshot,
  SSHConnectionState,
  SSHReconnectPolicy,
} from "../../shared/types/ssh";
import { normalizeReconnectPolicy, toSSH2ConnectConfig } from "./connect-config";
import { SSHServiceError } from "./errors";

const STATE_CHANGED_EVENT = "stateChanged";

type StateChangedListener = (snapshot: SSHConnectionSnapshot) => void;

interface ConnectOptions {
  reconnectAttempt?: number;
  reconnecting?: boolean;
}

export class SSHConnectionManager {
  private client: Client | null = null;
  private readonly emitter = new EventEmitter();
  private currentConfig: SSHConnectionConfig | null = null;
  private state: SSHConnectionState = "disconnected";
  private connectedAt?: string;
  private disconnectedAt?: string;
  private reconnectAttempt = 0;
  private lastError?: SSHConnectionSnapshot["lastError"];
  private reconnectGeneration = 0;
  private autoReconnectTask: Promise<void> | null = null;
  private userInitiatedDisconnect = false;

  public onStateChanged(listener: StateChangedListener): () => void {
    this.emitter.on(STATE_CHANGED_EVENT, listener);
    return () => this.emitter.off(STATE_CHANGED_EVENT, listener);
  }

  public getState(): SSHConnectionSnapshot {
    return {
      id: this.currentConfig?.id,
      state: this.state,
      connectedAt: this.connectedAt,
      disconnectedAt: this.disconnectedAt,
      reconnectAttempt: this.reconnectAttempt,
      lastError: this.lastError,
    };
  }

  public isConnected(): boolean {
    return this.state === "connected" && this.client !== null;
  }

  public getConfig(): SSHConnectionConfig | null {
    return this.currentConfig;
  }

  public getClient(): Client | null {
    return this.client;
  }

  public async connect(config: SSHConnectionConfig): Promise<SSHConnectionSnapshot> {
    if (!config.host) {
      throw new SSHServiceError("validation_error", "SSH host is required");
    }

    if (!config.port) {
      throw new SSHServiceError("validation_error", "SSH port is required");
    }

    this.bumpReconnectGeneration();
    this.userInitiatedDisconnect = false;

    if (this.client) {
      await this.disconnect();
      this.userInitiatedDisconnect = false;
    }

    this.currentConfig = config;
    await this.connectInternal(config, {
      reconnectAttempt: 0,
      reconnecting: false,
    });
    return this.getState();
  }

  public async disconnect(): Promise<SSHConnectionSnapshot> {
    this.userInitiatedDisconnect = true;
    this.bumpReconnectGeneration();

    if (!this.client) {
      this.setState("disconnected", {
        disconnectedAt: new Date().toISOString(),
      });
      return this.getState();
    }

    this.setState("disconnecting");
    const client = this.client;
    this.client = null;

    await new Promise<void>((resolve) => {
      client.once("close", () => resolve());
      client.end();
      setTimeout(resolve, 200);
    });

    this.setState("disconnected", {
      disconnectedAt: new Date().toISOString(),
    });
    return this.getState();
  }

  public async reconnect(): Promise<SSHConnectionSnapshot> {
    if (!this.currentConfig) {
      throw new SSHServiceError(
        "not_connected",
        "No previous SSH config found for reconnect",
      );
    }

    const reconnectPolicy = normalizeReconnectPolicy(this.currentConfig.reconnect);
    if (!reconnectPolicy.enabled) {
      throw new SSHServiceError("validation_error", "Reconnect is disabled");
    }

    this.bumpReconnectGeneration();
    this.userInitiatedDisconnect = false;

    await this.disconnect();
    this.userInitiatedDisconnect = false;

    const generation = this.reconnectGeneration;
    try {
      await this.runReconnectAttempts(this.currentConfig, reconnectPolicy, generation);
      return this.getState();
    } catch (error) {
      this.lastError = this.toConnectionErrorPayload(error, "SSH reconnect attempts exhausted");
      this.setState("failed", {
        disconnectedAt: new Date().toISOString(),
      });
      throw new SSHServiceError("connection_error", "SSH reconnect attempts exhausted", error);
    }
  }

  private async connectInternal(
    config: SSHConnectionConfig,
    options: ConnectOptions,
  ): Promise<void> {
    const client = new Client();
    this.client = client;
    this.reconnectAttempt = options.reconnectAttempt ?? 0;
    this.setState(options.reconnecting ? "reconnecting" : "connecting");

    client.on("error", (error) => {
      if (this.client !== client) {
        return;
      }

      if (this.state === "disconnecting") {
        return;
      }

      this.lastError = {
        code: "connection_error",
        message: error.message,
      };

      if (this.userInitiatedDisconnect) {
        return;
      }

      if (this.state === "connected") {
        this.triggerAutoReconnect(this.lastError);
      }
    });

    client.on("close", () => {
      if (this.client !== client) {
        return;
      }

      this.client = null;

      if (this.state === "disconnecting") {
        return;
      }

      if (this.userInitiatedDisconnect) {
        this.setState("disconnected", {
          disconnectedAt: new Date().toISOString(),
        });
        return;
      }

      if (this.state === "connected") {
        if (!this.lastError) {
          this.lastError = {
            code: "connection_error",
            message: "SSH connection closed unexpectedly",
          };
        }
        this.triggerAutoReconnect(this.lastError);
        return;
      }

      this.setState("disconnected", {
        disconnectedAt: new Date().toISOString(),
      });
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const onReady = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve();
      };

      const onError = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      const onTimeout = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new Error("SSH connection timeout"));
      };

      const cleanup = () => {
        client.off("ready", onReady);
        client.off("error", onError);
        client.off("timeout", onTimeout);
      };

      client.once("ready", onReady);
      client.once("error", onError);
      client.once("timeout", onTimeout);
      client.connect(toSSH2ConnectConfig(config));
    }).catch((error: unknown) => {
      this.lastError = {
        code: "connection_error",
        message: error instanceof Error ? error.message : "SSH connect failed",
      };
      this.client = null;

      if (!options.reconnecting) {
        this.setState("failed", {
          disconnectedAt: new Date().toISOString(),
        });
      }

      throw new SSHServiceError("connection_error", "SSH connect failed", error);
    });

    this.lastError = undefined;
    this.connectedAt = new Date().toISOString();
    this.disconnectedAt = undefined;
    this.setState("connected");
  }

  private triggerAutoReconnect(lastError?: SSHConnectionSnapshot["lastError"]): void {
    if (!this.currentConfig || this.userInitiatedDisconnect) {
      return;
    }

    if (this.autoReconnectTask) {
      return;
    }

    const reconnectPolicy = normalizeReconnectPolicy(this.currentConfig.reconnect);
    if (!reconnectPolicy.enabled) {
      if (lastError) {
        this.lastError = lastError;
      }
      this.setState("failed", {
        disconnectedAt: new Date().toISOString(),
      });
      return;
    }

    const generation = this.reconnectGeneration;
    const reconnectTask = this.runReconnectAttempts(
      this.currentConfig,
      reconnectPolicy,
      generation,
    )
      .catch((error) => {
        if (!this.isReconnectGenerationActive(generation) || this.userInitiatedDisconnect) {
          return;
        }

        this.lastError = this.toConnectionErrorPayload(error, "SSH reconnect attempts exhausted");
        this.setState("failed", {
          disconnectedAt: new Date().toISOString(),
        });
      })
      .finally(() => {
        if (this.autoReconnectTask === reconnectTask) {
          this.autoReconnectTask = null;
        }
      });

    this.autoReconnectTask = reconnectTask;
  }

  private async runReconnectAttempts(
    config: SSHConnectionConfig,
    reconnectPolicy: SSHReconnectPolicy,
    generation: number,
  ): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= reconnectPolicy.maxAttempts; attempt += 1) {
      if (!this.isReconnectGenerationActive(generation) || this.userInitiatedDisconnect) {
        return;
      }

      try {
        await this.connectInternal(config, {
          reconnecting: true,
          reconnectAttempt: attempt,
        });
        return;
      } catch (error) {
        lastError = error;

        if (attempt >= reconnectPolicy.maxAttempts) {
          break;
        }

        await sleep(reconnectPolicy.delayMs);
      }
    }

    throw new SSHServiceError("connection_error", "SSH reconnect attempts exhausted", lastError);
  }

  private bumpReconnectGeneration(): void {
    this.reconnectGeneration += 1;
  }

  private isReconnectGenerationActive(generation: number): boolean {
    return generation === this.reconnectGeneration;
  }

  private toConnectionErrorPayload(
    error: unknown,
    fallbackMessage: string,
  ): SSHConnectionSnapshot["lastError"] {
    if (error instanceof SSHServiceError) {
      return {
        code: error.code,
        message: error.message,
      };
    }

    if (error instanceof Error) {
      return {
        code: "connection_error",
        message: error.message,
      };
    }

    return {
      code: "connection_error",
      message: fallbackMessage,
    };
  }

  private setState(
    nextState: SSHConnectionState,
    patch?: Partial<Pick<SSHConnectionSnapshot, "connectedAt" | "disconnectedAt" | "lastError">>,
  ): void {
    this.state = nextState;

    if (patch?.connectedAt !== undefined) {
      this.connectedAt = patch.connectedAt;
    }

    if (patch?.disconnectedAt !== undefined) {
      this.disconnectedAt = patch.disconnectedAt;
    }

    if (patch?.lastError !== undefined) {
      this.lastError = patch.lastError;
    }

    this.emitter.emit(STATE_CHANGED_EVENT, this.getState());
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
