import type { SSHErrorCode, SSHErrorPayload } from "../../shared/types/ssh";

export class SSHServiceError extends Error {
  public readonly code: SSHErrorCode;
  public readonly causeValue?: unknown;

  constructor(code: SSHErrorCode, message: string, causeValue?: unknown) {
    super(message);
    this.name = "SSHServiceError";
    this.code = code;
    this.causeValue = causeValue;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function inferErrorCode(message: string): SSHErrorCode {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("authentication")) {
    return "auth_error";
  }

  if (lowerMessage.includes("timed out") || lowerMessage.includes("timeout")) {
    return "timeout_error";
  }

  if (lowerMessage.includes("not connected")) {
    return "not_connected";
  }

  if (lowerMessage.includes("sftp")) {
    return "sftp_error";
  }

  return "connection_error";
}

export function toSSHErrorPayload(
  error: unknown,
  fallbackCode: SSHErrorCode = "unknown_error",
): SSHErrorPayload {
  if (error instanceof SSHServiceError) {
    return {
      code: error.code,
      message: error.message,
      detail: error.causeValue instanceof Error ? error.causeValue.message : undefined,
    };
  }

  const message = getErrorMessage(error);
  const inferredCode = message ? inferErrorCode(message) : fallbackCode;

  return {
    code: inferredCode,
    message: message || "Unexpected SSH service error",
  };
}
