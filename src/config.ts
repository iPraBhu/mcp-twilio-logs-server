import * as z from "zod/v4";
import type { ServerConfig } from "./types.js";

const accountSidSchema = z.string().regex(/^AC[0-9a-fA-F]{32}$/, "must be a valid Twilio Account SID");
const apiKeySchema = z.string().regex(/^SK[0-9a-fA-F]{32}$/, "must be a valid Twilio API Key SID");

const envSchema = z.object({
  TWILIO_ACCOUNT_SID: accountSidSchema,
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_API_KEY: apiKeySchema.optional(),
  TWILIO_API_SECRET: z.string().min(1).optional(),
  TWILIO_SUBACCOUNT_SID: accountSidSchema.optional(),
  TWILIO_DEFAULT_LOOKBACK_DAYS: z.coerce.number().int().positive().default(7),
  TWILIO_MAX_LIMIT: z.coerce.number().int().positive().default(200),
  TWILIO_MAX_PAGE_SIZE: z.coerce.number().int().positive().default(100),
  TWILIO_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000)
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = envSchema.safeParse(env);
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
    requestTimeoutMs: values.TWILIO_REQUEST_TIMEOUT_MS
  };
}
