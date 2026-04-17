import { readFileSync } from "node:fs";
import path from "node:path";
import * as z from "zod/v4";
import type { LogLevel, ServerConfig } from "./types.js";

const accountSidSchema = z.string().regex(/^AC[0-9a-fA-F]{32}$/, "must be a valid Twilio Account SID");
const apiKeySchema = z.string().regex(/^SK[0-9a-fA-F]{32}$/, "must be a valid Twilio API Key SID");

const logLevelSchema = z.enum(["debug", "error", "info", "warn"]);
const envSchema = z.object({
  TWILIO_ACCOUNT_SID: accountSidSchema,
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_API_KEY: apiKeySchema.optional(),
  TWILIO_API_SECRET: z.string().min(1).optional(),
  TWILIO_SUBACCOUNT_SID: accountSidSchema.optional(),
  TWILIO_DEFAULT_LOOKBACK_DAYS: z.coerce.number().int().positive().default(7),
  TWILIO_MAX_LIMIT: z.coerce.number().int().positive().default(200),
  TWILIO_MAX_PAGE_SIZE: z.coerce.number().int().positive().default(100),
  TWILIO_MAX_RETRIES: z.coerce.number().int().min(0).default(1),
  TWILIO_LOG_LEVEL: logLevelSchema.default("warn"),
  TWILIO_LOGS_MCP_ENV_FILE: z.string().min(1).optional(),
  TWILIO_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000)
});

function parseLineValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1);
    if (trimmed.startsWith("\"")) {
      return inner
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, "\"")
        .replace(/\\\\/g, "\\");
    }

    return inner;
  }

  const commentStart = trimmed.search(/\s#/);
  return commentStart >= 0 ? trimmed.slice(0, commentStart).trimEnd() : trimmed;
}

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/u);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(trimmed);
    if (!match) {
      throw new Error(`Invalid env file entry: "${line}".`);
    }

    const key = match[1];
    const rawValue = match[2];
    if (!key || rawValue === undefined) {
      throw new Error(`Invalid env file entry: "${line}".`);
    }

    result[key] = parseLineValue(rawValue);
  }

  return result;
}

function loadEnvFile(envFilePath: string): Record<string, string> {
  const resolvedPath = path.resolve(envFilePath);

  try {
    const content = readFileSync(resolvedPath, "utf8");
    return parseEnvFile(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load env file "${resolvedPath}": ${message}`);
  }
}

function resolveConfigEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const envFilePath = env.TWILIO_LOGS_MCP_ENV_FILE;
  if (!envFilePath) {
    return env;
  }

  return {
    ...loadEnvFile(envFilePath),
    ...env
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = envSchema.safeParse(resolveConfigEnv(env));
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const values = parsed.data;
  const hasAccountToken = Boolean(values.TWILIO_AUTH_TOKEN);
  const hasApiKey = Boolean(values.TWILIO_API_KEY && values.TWILIO_API_SECRET);
  const hasPartialApiKey = Boolean(values.TWILIO_API_KEY) !== Boolean(values.TWILIO_API_SECRET);

  if (hasPartialApiKey) {
    throw new Error("Invalid Twilio auth configuration: TWILIO_API_KEY and TWILIO_API_SECRET must be provided together.");
  }

  if (!hasAccountToken && !hasApiKey) {
    throw new Error(
      "Invalid Twilio auth configuration: provide TWILIO_ACCOUNT_SID plus either TWILIO_AUTH_TOKEN or TWILIO_API_KEY and TWILIO_API_SECRET.",
    );
  }

  if (hasAccountToken && hasApiKey) {
    throw new Error(
      "Invalid Twilio auth configuration: provide either Account SID + Auth Token or API Key + API Secret, but not both.",
    );
  }

  if (values.TWILIO_MAX_PAGE_SIZE > values.TWILIO_MAX_LIMIT) {
    throw new Error("TWILIO_MAX_PAGE_SIZE cannot be greater than TWILIO_MAX_LIMIT.");
  }

  if (hasApiKey) {
    return {
      accountSid: values.TWILIO_ACCOUNT_SID,
      subaccountSid: values.TWILIO_SUBACCOUNT_SID,
      effectiveAccountSid: values.TWILIO_SUBACCOUNT_SID ?? values.TWILIO_ACCOUNT_SID,
      authMode: "api_key",
      authUsername: values.TWILIO_API_KEY!,
      authPassword: values.TWILIO_API_SECRET!,
      defaultLookbackDays: values.TWILIO_DEFAULT_LOOKBACK_DAYS,
      maxLimit: values.TWILIO_MAX_LIMIT,
      maxPageSize: values.TWILIO_MAX_PAGE_SIZE,
      maxRetries: values.TWILIO_MAX_RETRIES,
      logLevel: values.TWILIO_LOG_LEVEL as LogLevel,
      requestTimeoutMs: values.TWILIO_REQUEST_TIMEOUT_MS
    };
  }

  return {
    accountSid: values.TWILIO_ACCOUNT_SID,
    subaccountSid: values.TWILIO_SUBACCOUNT_SID,
    effectiveAccountSid: values.TWILIO_SUBACCOUNT_SID ?? values.TWILIO_ACCOUNT_SID,
    authMode: "account_token",
    authUsername: values.TWILIO_ACCOUNT_SID,
    authPassword: values.TWILIO_AUTH_TOKEN!,
    defaultLookbackDays: values.TWILIO_DEFAULT_LOOKBACK_DAYS,
    maxLimit: values.TWILIO_MAX_LIMIT,
    maxPageSize: values.TWILIO_MAX_PAGE_SIZE,
    maxRetries: values.TWILIO_MAX_RETRIES,
    logLevel: values.TWILIO_LOG_LEVEL as LogLevel,
    requestTimeoutMs: values.TWILIO_REQUEST_TIMEOUT_MS
  };
}
