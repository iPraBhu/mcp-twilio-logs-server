export type AuthMode = "account_token" | "api_key";

export interface ServerConfig {
  accountSid: string;
  subaccountSid?: string;
  effectiveAccountSid: string;
  authMode: AuthMode;
  authUsername: string;
  authPassword: string;
  defaultLookbackDays: number;
  maxLimit: number;
  maxPageSize: number;
  requestTimeoutMs: number;
}

export interface TimeRange {
  start: string;
  end: string;
}

export interface CursorEnvelope<TState> {
  kind: string;
  scopeAccountSid: string;
  state: TState;
}

export interface BaseToolResult<TResult, TQuery> extends Record<string, unknown> {
  accountSid: string;
  subaccountSid?: string;
  query: TQuery;
  timeRange?: TimeRange;
  count: number;
  results: TResult[];
  nextCursor?: string;
  warnings?: string[];
}

export type MessageDirection =
  | "inbound"
  | "outbound-api"
  | "outbound-call"
  | "outbound-reply";

export type MessageStatus =
  | "accepted"
  | "canceled"
  | "delivered"
  | "failed"
  | "partially_delivered"
  | "queued"
  | "read"
  | "received"
  | "receiving"
  | "scheduled"
  | "sending"
  | "sent"
  | "undelivered";

export interface MessageRecord {
  sid: string;
  accountSid: string;
  direction: MessageDirection;
  status: MessageStatus;
  from: string;
  to: string;
  body: string;
  bodyPreview: string;
  messagingServiceSid: string;
  errorCode: number | null;
  errorMessage: string | null;
  numSegments: string;
  numMedia: string;
  price: string;
  priceUnit: string;
  apiVersion: string;
  dateCreated: string | null;
  dateUpdated: string | null;
  dateSent: string | null;
  uri: string;
  raw?: Record<string, unknown>;
}

export type VerifyAttemptChannel = "call" | "email" | "rbm" | "sms" | "whatsapp";
export type VerifyAttemptStatus = "converted" | "unconverted";

export interface VerifyAttemptRecord {
  sid: string;
  accountSid: string;
  serviceSid: string;
  verificationSid: string;
  channel: VerifyAttemptChannel;
  status: VerifyAttemptStatus;
  phoneNumber?: string;
  country?: string;
  messageStatus?: string;
  price?: Record<string, unknown> | null;
  channelData?: Record<string, unknown>;
  dateCreated: string | null;
  dateUpdated: string | null;
  url: string;
  raw?: Record<string, unknown>;
}

export interface VerifyServiceRecord {
  sid: string;
  accountSid: string;
  friendlyName: string;
  codeLength: number;
  lookupEnabled: boolean;
  psd2Enabled: boolean;
  skipSmsToLandlines: boolean;
  dtmfInputRequired: boolean;
  doNotShareWarningEnabled: boolean;
  customCodeEnabled: boolean;
  verifyEventSubscriptionEnabled: boolean;
  defaultTemplateSid: string;
  url: string;
  dateCreated: string | null;
  dateUpdated: string | null;
  raw?: Record<string, unknown>;
}
