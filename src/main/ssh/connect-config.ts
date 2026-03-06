import type { ConnectConfig } from "ssh2";
import type { SSHConnectionConfig, SSHReconnectPolicy } from "../../shared/types/ssh";

const DEFAULT_READY_TIMEOUT_MS = 15_000;
const DEFAULT_RECONNECT_POLICY: SSHReconnectPolicy = {
  enabled: true,
  maxAttempts: 3,
  delayMs: 1_500,
};

export function normalizeReconnectPolicy(
  policy?: Partial<SSHReconnectPolicy>,
): SSHReconnectPolicy {
  return {
    enabled: policy?.enabled ?? DEFAULT_RECONNECT_POLICY.enabled,
    maxAttempts: policy?.maxAttempts ?? DEFAULT_RECONNECT_POLICY.maxAttempts,
    delayMs: policy?.delayMs ?? DEFAULT_RECONNECT_POLICY.delayMs,
  };
}

export function toSSH2ConnectConfig(config: SSHConnectionConfig): ConnectConfig {
  const baseConfig: ConnectConfig = {
    host: config.host,
    port: config.port,
    username: config.auth.username,
    readyTimeout: config.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
  };

  if (config.auth.method === "password") {
    return {
      ...baseConfig,
      password: config.auth.password,
    };
  }

  return {
    ...baseConfig,
    privateKey: config.auth.privateKey,
    passphrase: config.auth.passphrase,
  };
}

export function toSftpConnectConfig(config: SSHConnectionConfig): Record<string, unknown> {
  const baseConfig: Record<string, unknown> = {
    host: config.host,
    port: config.port,
    username: config.auth.username,
    readyTimeout: config.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
  };

  if (config.auth.method === "password") {
    return {
      ...baseConfig,
      password: config.auth.password,
    };
  }

  return {
    ...baseConfig,
    privateKey: config.auth.privateKey,
    passphrase: config.auth.passphrase,
  };
}
