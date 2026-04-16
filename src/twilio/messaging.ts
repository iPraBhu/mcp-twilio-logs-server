import type { MessageInstance, MessagePage } from "twilio/lib/rest/api/v2010/account/message.js";
import type { MessageDirection, MessageRecord, MessageStatus, ServerConfig } from "../types.js";
import type { TwilioReadClient, MessagePageParams } from "./client.js";
import { encodeCursor, decodeCursor } from "../utils/cursor.js";
import { mapTwilioError } from "../utils/errors.js";
import { toIsoString } from "../utils/time.js";

interface MessagePageState {
  currentPage:
    | {
        mode: "params";
        params: MessagePageParams;
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

export interface SearchMessagesOptions {
  client: TwilioReadClient;
  config: ServerConfig;
  cursor?: string;
  direction?: MessageDirection;
  errorCode?: number;
  from?: string;
  includeRaw?: boolean;
  kind: string;
  limit: number;
  pageSize: number;
  phoneNumber?: string;
  status?: MessageStatus;
  timeRange: {
    end: Date;
    start: Date;
  };
  query: Record<string, unknown>;
  to?: string;
}

export function normalizeMessage(message: MessageInstance, includeRaw: boolean): MessageRecord {
  return {
    sid: message.sid,
    accountSid: message.accountSid,
    direction: message.direction,
    status: message.status,
    from: message.from,
    to: message.to,
    body: message.body,
    bodyPreview: message.body.length > 160 ? `${message.body.slice(0, 157)}...` : message.body,
    messagingServiceSid: message.messagingServiceSid,
    errorCode: Number.isFinite(message.errorCode) ? message.errorCode : null,
    errorMessage: message.errorMessage || null,
    numSegments: message.numSegments,
    numMedia: message.numMedia,
    price: message.price,
    priceUnit: message.priceUnit,
    apiVersion: message.apiVersion,
    dateCreated: toIsoString(message.dateCreated),
    dateUpdated: toIsoString(message.dateUpdated),
    dateSent: toIsoString(message.dateSent),
    uri: message.uri,
    raw: includeRaw ? (message.toJSON() as Record<string, unknown>) : undefined
  };
}

function matchesMessageFilters(message: MessageInstance, filters: SearchMessagesOptions): boolean {
  if (filters.status && message.status !== filters.status) {
    return false;
  }

  if (filters.direction && message.direction !== filters.direction) {
    return false;
  }

  if (filters.errorCode !== undefined && message.errorCode !== filters.errorCode) {
    return false;
  }

  if (filters.phoneNumber && message.from !== filters.phoneNumber && message.to !== filters.phoneNumber) {
    return false;
  }

  return true;
}

function buildInitialMessageParams(options: SearchMessagesOptions): MessagePageParams {
  const direction = options.direction;
  const serverSideFrom =
    options.from ??
    (options.phoneNumber && direction === "inbound" ? options.phoneNumber : undefined);
  const serverSideTo =
    options.to ??
    (options.phoneNumber && direction && direction !== "inbound" ? options.phoneNumber : undefined);

  return {
    from: serverSideFrom,
    to: serverSideTo,
    dateSentAfter: options.timeRange.start,
    dateSentBefore: options.timeRange.end,
    pageSize: options.pageSize
  };
}

async function fetchPage(client: TwilioReadClient, state: MessagePageState["currentPage"]): Promise<MessagePage> {
  if (state.mode === "params") {
    return client.pageMessages(state.params);
  }

  return client.getMessagePage(state.targetUrl);
}

export async function searchMessages(options: SearchMessagesOptions): Promise<{
  nextCursor?: string;
  results: MessageRecord[];
  warnings?: string[];
}> {
  const warnings: string[] = [];
  const state = options.cursor
    ? decodeCursor<MessagePageState>(
        options.cursor,
        options.kind,
        options.config.effectiveAccountSid,
        options.config.authPassword,
      )
    : {
        currentPage: {
          mode: "params" as const,
          params: buildInitialMessageParams(options)
        },
        offset: 0,
        query: options.query,
        timeRange: {
          start: options.timeRange.start.toISOString(),
          end: options.timeRange.end.toISOString()
        }
      };

  const results: MessageRecord[] = [];
  let currentState = state;

  while (results.length < options.limit) {
    let page: MessagePage;
    try {
      page = await fetchPage(options.client, currentState.currentPage);
    } catch (error) {
      if (results.length > 0) {
        warnings.push(`Stopped early after a pagination failure: ${mapTwilioError(error).message}`);
        break;
      }

      throw mapTwilioError(error);
    }

    const instances = page.instances.slice(currentState.offset);
    let nextOffset = 0;

    for (const message of instances) {
      nextOffset += 1;
      if (!matchesMessageFilters(message, options)) {
        continue;
      }

      results.push(normalizeMessage(message, Boolean(options.includeRaw)));
      if (results.length >= options.limit) {
        break;
      }
    }

    if (results.length >= options.limit && nextOffset < instances.length) {
      return {
        results,
        warnings: warnings.length > 0 ? warnings : undefined,
        nextCursor: encodeCursor<MessagePageState>({
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
