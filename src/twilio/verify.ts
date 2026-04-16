import type { ServiceInstance, ServicePage } from "twilio/lib/rest/verify/v2/service.js";
import type { VerificationAttemptInstance, VerificationAttemptPage } from "twilio/lib/rest/verify/v2/verificationAttempt.js";
import type {
  ServerConfig,
  VerifyAttemptChannel,
  VerifyAttemptRecord,
  VerifyAttemptStatus,
  VerifyServiceRecord
} from "../types.js";
import type { TwilioReadClient, VerifyAttemptPageParams, VerifyServicePageParams } from "./client.js";
import { decodeCursor, encodeCursor } from "../utils/cursor.js";
import { mapTwilioError } from "../utils/errors.js";
import { toIsoString } from "../utils/time.js";

interface VerifyAttemptPageState {
  currentPage:
    | {
        mode: "params";
        params: VerifyAttemptPageParams;
      }
    | {
        mode: "url";
        targetUrl: string;
      };
  offset: number;
  query: Record<string, unknown>;
  timeRange: {
    end: string;
    start: string;
  };
}

interface VerifyServicePageState {
  currentPage:
    | {
        mode: "params";
        params: VerifyServicePageParams;
      }
    | {
        mode: "url";
        targetUrl: string;
      };
  offset: number;
  query: Record<string, unknown>;
}

export interface SearchVerifyOptions {
  channel?: VerifyAttemptChannel;
  client: TwilioReadClient;
  config: ServerConfig;
  cursor?: string;
  includeRaw?: boolean;
  kind: string;
  limit: number;
  pageSize: number;
  phoneNumber?: string;
  query: Record<string, unknown>;
  status?: VerifyAttemptStatus;
  timeRange: {
    end: Date;
    start: Date;
  };
  verificationSid?: string;
  verifyServiceSid?: string;
}

export function normalizeVerifyAttempt(
  attempt: VerificationAttemptInstance,
  includeRaw: boolean,
): VerifyAttemptRecord {
  const channelData = (attempt.channelData ?? {}) as Record<string, unknown>;
  return {
    sid: attempt.sid,
    accountSid: attempt.accountSid,
    serviceSid: attempt.serviceSid,
    verificationSid: attempt.verificationSid,
    channel: attempt.channel,
    status: attempt.conversionStatus,
    phoneNumber: typeof channelData.to === "string" ? channelData.to : undefined,
    country: typeof channelData.country === "string" ? channelData.country : undefined,
    messageStatus: typeof channelData.message_status === "string" ? channelData.message_status : undefined,
    price: attempt.price ? (attempt.price as Record<string, unknown>) : null,
    channelData,
    dateCreated: toIsoString(attempt.dateCreated),
    dateUpdated: toIsoString(attempt.dateUpdated),
    url: attempt.url,
    raw: includeRaw ? (attempt.toJSON() as Record<string, unknown>) : undefined
  };
}

export function normalizeVerifyService(service: ServiceInstance, includeRaw: boolean): VerifyServiceRecord {
  return {
    sid: service.sid,
    accountSid: service.accountSid,
    friendlyName: service.friendlyName,
    codeLength: service.codeLength,
    lookupEnabled: service.lookupEnabled,
    psd2Enabled: service.psd2Enabled,
    skipSmsToLandlines: service.skipSmsToLandlines,
    dtmfInputRequired: service.dtmfInputRequired,
    doNotShareWarningEnabled: service.doNotShareWarningEnabled,
    customCodeEnabled: service.customCodeEnabled,
    verifyEventSubscriptionEnabled: service.verifyEventSubscriptionEnabled,
    defaultTemplateSid: service.defaultTemplateSid,
    url: service.url,
    dateCreated: toIsoString(service.dateCreated),
    dateUpdated: toIsoString(service.dateUpdated),
    raw: includeRaw ? (service.toJSON() as Record<string, unknown>) : undefined
  };
}

function buildInitialVerifyParams(options: SearchVerifyOptions): VerifyAttemptPageParams {
  return {
    "channelData.to": options.phoneNumber,
    channel: options.channel,
    dateCreatedAfter: options.timeRange.start,
    dateCreatedBefore: options.timeRange.end,
    pageSize: options.pageSize,
    status: options.status,
    verificationSid: options.verificationSid,
    verifyServiceSid: options.verifyServiceSid
  };
}

async function fetchVerifyAttemptPage(
  client: TwilioReadClient,
  state: VerifyAttemptPageState["currentPage"],
): Promise<VerificationAttemptPage> {
  if (state.mode === "params") {
    return client.pageVerifyAttempts(state.params);
  }

  return client.getVerifyAttemptPage(state.targetUrl);
}

async function fetchVerifyServicePage(
  client: TwilioReadClient,
  state: VerifyServicePageState["currentPage"],
): Promise<ServicePage> {
  if (state.mode === "params") {
    return client.pageVerifyServices(state.params);
  }

  return client.getVerifyServicePage(state.targetUrl);
}

export async function searchVerifyAttempts(options: SearchVerifyOptions): Promise<{
  nextCursor?: string;
  results: VerifyAttemptRecord[];
  warnings?: string[];
}> {
  const warnings: string[] = [];
  const state = options.cursor
    ? decodeCursor<VerifyAttemptPageState>(
        options.cursor,
        options.kind,
        options.config.effectiveAccountSid,
        options.config.authPassword,
      )
    : {
        currentPage: {
          mode: "params" as const,
          params: buildInitialVerifyParams(options)
        },
        offset: 0,
        query: options.query,
        timeRange: {
          start: options.timeRange.start.toISOString(),
          end: options.timeRange.end.toISOString()
        }
      };

  const results: VerifyAttemptRecord[] = [];
  let currentState = state;

  while (results.length < options.limit) {
    let page: VerificationAttemptPage;
    try {
      page = await fetchVerifyAttemptPage(options.client, currentState.currentPage);
    } catch (error) {
      if (results.length > 0) {
        warnings.push(`Stopped early after a pagination failure: ${mapTwilioError(error).message}`);
        break;
      }

      throw mapTwilioError(error);
    }

    const instances = page.instances.slice(currentState.offset);
    let nextOffset = 0;

    for (const attempt of instances) {
      nextOffset += 1;
      results.push(normalizeVerifyAttempt(attempt, Boolean(options.includeRaw)));
      if (results.length >= options.limit) {
        break;
      }
    }

    if (results.length >= options.limit && nextOffset < instances.length) {
      return {
        results,
        warnings: warnings.length > 0 ? warnings : undefined,
        nextCursor: encodeCursor<VerifyAttemptPageState>({
          kind: options.kind,
          scopeAccountSid: options.config.effectiveAccountSid,
          state: {
            ...currentState,
            offset: currentState.offset + nextOffset
          }
        }, options.config.authPassword)
      };
    }

    if (!page.nextPageUrl) {
      return {
        results,
        warnings: warnings.length > 0 ? warnings : undefined
      };
    }

    currentState = {
      ...currentState,
      currentPage: {
        mode: "url",
        targetUrl: page.nextPageUrl
      },
      offset: 0
    };
  }

  return {
    results,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

export async function fetchVerifyAttempt(options: {
  client: TwilioReadClient;
  includeRaw?: boolean;
  sid: string;
}): Promise<VerifyAttemptRecord> {
  const attempt = await options.client.fetchVerifyAttempt(options.sid);
  return normalizeVerifyAttempt(attempt, Boolean(options.includeRaw));
}

export async function listVerifyServices(options: {
  client: TwilioReadClient;
  config: ServerConfig;
  cursor?: string;
  includeRaw?: boolean;
  kind: string;
  limit: number;
  pageSize: number;
  query: Record<string, unknown>;
}): Promise<{
  nextCursor?: string;
  results: VerifyServiceRecord[];
  warnings?: string[];
}> {
  const warnings: string[] = [];
  const state = options.cursor
    ? decodeCursor<VerifyServicePageState>(
        options.cursor,
        options.kind,
        options.config.effectiveAccountSid,
        options.config.authPassword,
      )
    : {
        currentPage: {
          mode: "params" as const,
          params: {
            pageSize: options.pageSize
          }
        },
        offset: 0,
        query: options.query
      };

  const results: VerifyServiceRecord[] = [];
  let currentState = state;

  while (results.length < options.limit) {
    let page: ServicePage;
    try {
      page = await fetchVerifyServicePage(options.client, currentState.currentPage);
    } catch (error) {
      if (results.length > 0) {
        warnings.push(`Stopped early after a pagination failure: ${mapTwilioError(error).message}`);
        break;
      }

      throw mapTwilioError(error);
    }

    const instances = page.instances.slice(currentState.offset);
    let nextOffset = 0;

    for (const service of instances) {
      nextOffset += 1;
      results.push(normalizeVerifyService(service, Boolean(options.includeRaw)));
      if (results.length >= options.limit) {
        break;
      }
    }

    if (results.length >= options.limit && nextOffset < instances.length) {
      return {
        results,
        warnings: warnings.length > 0 ? warnings : undefined,
        nextCursor: encodeCursor<VerifyServicePageState>({
          kind: options.kind,
          scopeAccountSid: options.config.effectiveAccountSid,
          state: {
            ...currentState,
            offset: currentState.offset + nextOffset
          }
        }, options.config.authPassword)
      };
    }

    if (!page.nextPageUrl) {
      return {
        results,
        warnings: warnings.length > 0 ? warnings : undefined
      };
    }

    currentState = {
      ...currentState,
      currentPage: {
        mode: "url",
        targetUrl: page.nextPageUrl
      },
      offset: 0
    };
  }

  return {
    results,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}
