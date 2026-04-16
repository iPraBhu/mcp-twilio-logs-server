import * as z from "zod/v4";

export const rawObjectSchema = z.record(z.string(), z.unknown());

export const timeRangeSchema = z.object({
  start: z.string(),
  end: z.string()
});

export const messageRecordSchema = z.object({
  sid: z.string(),
  accountSid: z.string(),
  direction: z.enum(["inbound", "outbound-api", "outbound-call", "outbound-reply"]),
  status: z.enum([
    "accepted",
    "canceled",
    "delivered",
    "failed",
    "partially_delivered",
    "queued",
    "read",
    "received",
    "receiving",
    "scheduled",
    "sending",
    "sent",
    "undelivered"
  ]),
  from: z.string(),
  to: z.string(),
  body: z.string(),
  bodyPreview: z.string(),
  messagingServiceSid: z.string(),
  errorCode: z.number().nullable(),
  errorMessage: z.string().nullable(),
  numSegments: z.string(),
  numMedia: z.string(),
  price: z.string(),
  priceUnit: z.string(),
  apiVersion: z.string(),
  dateCreated: z.string().nullable(),
  dateUpdated: z.string().nullable(),
  dateSent: z.string().nullable(),
  uri: z.string(),
  raw: rawObjectSchema.optional()
});

export const verifyAttemptRecordSchema = z.object({
  sid: z.string(),
  accountSid: z.string(),
  serviceSid: z.string(),
  verificationSid: z.string(),
  channel: z.enum(["call", "email", "rbm", "sms", "whatsapp"]),
  status: z.enum(["converted", "unconverted"]),
  phoneNumber: z.string().optional(),
  country: z.string().optional(),
  messageStatus: z.string().optional(),
  price: rawObjectSchema.nullable().optional(),
  channelData: rawObjectSchema.optional(),
  dateCreated: z.string().nullable(),
  dateUpdated: z.string().nullable(),
  url: z.string(),
  raw: rawObjectSchema.optional()
});

export const verifyServiceRecordSchema = z.object({
  sid: z.string(),
  accountSid: z.string(),
  friendlyName: z.string(),
  codeLength: z.number(),
  lookupEnabled: z.boolean(),
  psd2Enabled: z.boolean(),
  skipSmsToLandlines: z.boolean(),
  dtmfInputRequired: z.boolean(),
  doNotShareWarningEnabled: z.boolean(),
  customCodeEnabled: z.boolean(),
  verifyEventSubscriptionEnabled: z.boolean(),
  defaultTemplateSid: z.string(),
  url: z.string(),
  dateCreated: z.string().nullable(),
  dateUpdated: z.string().nullable(),
  raw: rawObjectSchema.optional()
});

export function makeBaseResultSchema<TQuery extends z.ZodTypeAny, TResult extends z.ZodTypeAny>(
  querySchema: TQuery,
  resultSchema: TResult,
  options: { includeTimeRange?: boolean } = {},
) {
  return z.object({
    accountSid: z.string(),
    subaccountSid: z.string().optional(),
    query: querySchema,
    timeRange: options.includeTimeRange ? timeRangeSchema : timeRangeSchema.optional(),
    count: z.number().int().nonnegative(),
    results: z.array(resultSchema),
    nextCursor: z.string().optional(),
    warnings: z.array(z.string()).optional()
  });
}
