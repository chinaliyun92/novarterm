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

function toErrorDetail(causeValue: unknown): string | undefined {
  if (causeValue == null) {
    return undefined;
  }

  if (causeValue instanceof Error) {
    const message = causeValue.message.trim();
    return message || undefined;
  }

  if (typeof causeValue === "string") {
    const normalized = causeValue.trim();
    return normalized || undefined;
  }

  try {
    const serialized = JSON.stringify(causeValue);
    if (typeof serialized === "string" && serialized.trim()) {
      return serialized;
    }
  } catch {
    // ignore JSON stringify failures and fallback to String conversion.
  }

  const fallback = String(causeValue).trim();
  return fallback || undefined;
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
    const detail = toErrorDetail(error.causeValue);
    return {
      code: error.code,
      message: error.message,
      detail,
    };
  }

  const message = getErrorMessage(error);
  const inferredCode = message ? inferErrorCode(message) : fallbackCode;

  return {
    code: inferredCode,
    message: message || "Unexpected SSH service error",
  };
}
