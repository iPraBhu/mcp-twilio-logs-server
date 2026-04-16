import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

interface TwilioLikeError {
  code?: number;
  message?: string;
  moreInfo?: string;
  name?: string;
  status?: number;
}

function isTwilioLikeError(error: unknown): error is TwilioLikeError {
  return error !== null && typeof error === "object" && ("status" in error || "code" in error);
}

export function toMcpError(error: unknown): McpError {
  if (error instanceof McpError) {
    return error;
  }

  if (error instanceof Error) {
    return new McpError(ErrorCode.InternalError, error.message);
  }

  return new McpError(ErrorCode.InternalError, String(error));
}

export function mapTwilioError(error: unknown): McpError {
  if (!isTwilioLikeError(error)) {
    return toMcpError(error);
  }

  const message = error.message ?? "Unknown Twilio API error";

  if (error.status === 401 || error.status === 403) {
    return new McpError(
      ErrorCode.InvalidRequest,
      `Twilio authentication or authorization failed: ${message}`,
    );
  }

  if (error.status === 404) {
    return new McpError(ErrorCode.InvalidParams, `Twilio resource not found: ${message}`);
  }

  if (error.status === 400 || error.status === 422) {
    return new McpError(ErrorCode.InvalidParams, `Twilio rejected the request: ${message}`);
  }

  if (error.status === 429) {
    return new McpError(ErrorCode.InternalError, `Twilio rate limit exceeded: ${message}`);
  }

  return new McpError(ErrorCode.InternalError, `Twilio API error: ${message}`);
}

export function invalidParams(message: string): McpError {
  return new McpError(ErrorCode.InvalidParams, message);
}

function sanitizeForLog(message: string): string {
  return message
    .replace(/\b(AC|SK|SM|VA|VE)[0-9a-fA-F]{32}\b/g, "$1[redacted]")
    .replace(/\+\d{7,15}\b/g, "[redacted-phone]")
    .slice(0, 240);
}

export function getErrorLogDetails(error: unknown): Record<string, unknown> {
  if (isTwilioLikeError(error)) {
    return {
      errorType: "twilio",
      errorName: typeof error.name === "string" ? error.name : "TwilioError",
      status: error.status,
      code: error.code,
      message: sanitizeForLog(error.message ?? "Unknown Twilio API error")
    };
  }

  if (error instanceof Error) {
    return {
      errorType: "generic",
      errorName: error.name,
      message: sanitizeForLog(error.message)
    };
  }

  return {
    errorType: "unknown",
    message: sanitizeForLog(String(error))
  };
}
