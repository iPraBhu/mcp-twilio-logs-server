import type { MessageInstance, MessagePage } from "twilio/lib/rest/api/v2010/account/message.js";
import type { MessageDirection, MessageRecord, MessageStatus, ServerConfig } from "../types.js";
import type { TwilioReadClient, MessagePageParams } from "./client.js";
import { encodeCursor, decodeCursor } from "../utils/cursor.js";
import { mapTwilioError } from "../utils/errors.js";
import { toIsoString } from "../utils/time.js";

interface MessagePageCursor {
  currentPage:
    | {
        mode: "params";
        params: MessagePageParams;
      }
    | {
        mode: "url";
        targetUrl: string;
      };
  exhausted?: boolean;
  offset: number;
}

interface SingleMessagePageState {
  mode: "single";
  page: MessagePageCursor;
  query: Record<string, unknown>;
  timeRange: {
    end: string;
    start: string;
  };
}

interface PhoneUnionMessagePageState {
  mode: "phone_union";
  fromPage: MessagePageCursor;
  query: Record<string, unknown>;
  seenSids: string[];
  timeRange: {
    end: string;
    start: string;
  };
  toPage: MessagePageCursor;
}

type MessageSearchState = PhoneUnionMessagePageState | SingleMessagePageState;

interface LoadedMessagePage {
  key: string;
  page: MessagePage;
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

function buildMessagePageCursor(params: MessagePageParams): MessagePageCursor {
  return {
    currentPage: {
      mode: "params",
      params
    },
    offset: 0
  };
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

function shouldUsePhoneUnionSearch(options: SearchMessagesOptions): boolean {
  return Boolean(options.phoneNumber && !options.from && !options.to && !options.direction);
}

function buildInitialState(options: SearchMessagesOptions): MessageSearchState {
  const timeRange = {
    start: options.timeRange.start.toISOString(),
    end: options.timeRange.end.toISOString()
  };

  if (shouldUsePhoneUnionSearch(options)) {
    return {
      mode: "phone_union",
      fromPage: buildMessagePageCursor({
        from: options.phoneNumber,
        dateSentAfter: options.timeRange.start,
        dateSentBefore: options.timeRange.end,
        pageSize: options.pageSize
      }),
      toPage: buildMessagePageCursor({
        to: options.phoneNumber,
        dateSentAfter: options.timeRange.start,
        dateSentBefore: options.timeRange.end,
        pageSize: options.pageSize
      }),
      query: options.query,
      seenSids: [],
      timeRange
    };
  }

  return {
    mode: "single",
    page: buildMessagePageCursor(buildInitialMessageParams(options)),
    query: options.query,
    timeRange
  };
}

function getCurrentPageKey(pageCursor: MessagePageCursor): string {
  if (pageCursor.currentPage.mode === "url") {
    return pageCursor.currentPage.targetUrl;
  }

  return JSON.stringify(pageCursor.currentPage.params);
}

async function fetchPage(client: TwilioReadClient, state: MessagePageCursor["currentPage"]): Promise<MessagePage> {
  if (state.mode === "params") {
    return client.pageMessages(state.params);
  }

  return client.getMessagePage(state.targetUrl);
}

async function ensureLoadedPage(
  client: TwilioReadClient,
  pageCursor: MessagePageCursor,
  cachedPage?: LoadedMessagePage,
): Promise<LoadedMessagePage | undefined> {
  if (pageCursor.exhausted) {
    return undefined;
  }

  const key = getCurrentPageKey(pageCursor);
  if (cachedPage && cachedPage.key === key) {
    return cachedPage;
  }

  return {
    key,
    page: await fetchPage(client, pageCursor.currentPage)
  };
}

function moveToNextPage(pageCursor: MessagePageCursor, page: MessagePage): boolean {
  if (!page.nextPageUrl) {
    pageCursor.exhausted = true;
    return false;
  }

  pageCursor.currentPage = {
    mode: "url",
    targetUrl: page.nextPageUrl
  };
  pageCursor.offset = 0;
  return true;
}

function streamHasMore(pageCursor: MessagePageCursor, cachedPage?: LoadedMessagePage): boolean {
  if (pageCursor.exhausted) {
    return false;
  }

  if (!cachedPage || cachedPage.key !== getCurrentPageKey(pageCursor)) {
    return true;
  }

  return pageCursor.offset < cachedPage.page.instances.length || Boolean(cachedPage.page.nextPageUrl);
}

function getMessageSortTime(message: MessageInstance): number {
  return (
    message.dateSent?.getTime() ??
    message.dateCreated?.getTime() ??
    message.dateUpdated?.getTime() ??
    0
  );
}

function pickMostRecentCandidate(fromCandidate?: MessageInstance, toCandidate?: MessageInstance): "from" | "to" | undefined {
  if (!fromCandidate && !toCandidate) {
    return undefined;
  }

  if (!fromCandidate) {
    return "to";
  }

  if (!toCandidate) {
    return "from";
  }

  const fromTime = getMessageSortTime(fromCandidate);
  const toTime = getMessageSortTime(toCandidate);

  if (fromTime === toTime) {
    return fromCandidate.sid <= toCandidate.sid ? "from" : "to";
  }

  return fromTime > toTime ? "from" : "to";
}

async function findNextCandidate(
  options: SearchMessagesOptions,
  pageCursor: MessagePageCursor,
  seenSids: Set<string>,
  cachedPage?: LoadedMessagePage,
): Promise<{ candidate?: MessageInstance; cachedPage?: LoadedMessagePage }> {
  let localCache = cachedPage;

  while (!pageCursor.exhausted) {
    localCache = await ensureLoadedPage(options.client, pageCursor, localCache);
    if (!localCache) {
      return { cachedPage: undefined };
    }

    const instances = localCache.page.instances;
    while (pageCursor.offset < instances.length) {
      const message = instances[pageCursor.offset];
      if (!message) {
        pageCursor.offset += 1;
        continue;
      }

      if (seenSids.has(message.sid) || !matchesMessageFilters(message, options)) {
        pageCursor.offset += 1;
        continue;
      }

      return {
        candidate: message,
        cachedPage: localCache
      };
    }

    if (!moveToNextPage(pageCursor, localCache.page)) {
      return { cachedPage: undefined };
    }

    localCache = undefined;
  }

  return { cachedPage: undefined };
}

async function searchMessagesSingle(options: SearchMessagesOptions, state: SingleMessagePageState): Promise<{
  nextCursor?: string;
  results: MessageRecord[];
  warnings?: string[];
}> {
  const warnings: string[] = [];
  const results: MessageRecord[] = [];
  let currentPage = state.page;
  let cachedPage: LoadedMessagePage | undefined;

  while (results.length < options.limit) {
    let page: MessagePage;
    try {
      const loadedPage = await ensureLoadedPage(options.client, currentPage, cachedPage);
      if (!loadedPage) {
        return {
          results,
          warnings: warnings.length > 0 ? warnings : undefined
        };
      }

      cachedPage = loadedPage;
      page = loadedPage.page;
    } catch (error) {
      if (results.length > 0) {
        warnings.push(`Stopped early after a pagination failure: ${mapTwilioError(error).message}`);
        break;
      }

      throw mapTwilioError(error);
    }

    while (currentPage.offset < page.instances.length && results.length < options.limit) {
      const message = page.instances[currentPage.offset];
      currentPage.offset += 1;
      if (!message) {
        continue;
      }

      if (!matchesMessageFilters(message, options)) {
        continue;
      }

      results.push(normalizeMessage(message, Boolean(options.includeRaw)));
    }

    if (results.length >= options.limit) {
      const hasMore =
        currentPage.offset < page.instances.length ||
        Boolean(page.nextPageUrl);

      return {
        results,
        warnings: warnings.length > 0 ? warnings : undefined,
        nextCursor: hasMore
          ? encodeCursor<MessageSearchState>({
              kind: options.kind,
              scopeAccountSid: options.config.effectiveAccountSid,
              state: {
                ...state,
                page: currentPage
              }
            }, options.config.authPassword)
          : undefined
      };
    }

    if (!moveToNextPage(currentPage, page)) {
      return {
        results,
        warnings: warnings.length > 0 ? warnings : undefined
      };
    }

    cachedPage = undefined;
  }

  return {
    results,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

async function searchMessagesByPhoneUnion(options: SearchMessagesOptions, state: PhoneUnionMessagePageState): Promise<{
  nextCursor?: string;
  results: MessageRecord[];
  warnings?: string[];
}> {
  const warnings: string[] = [];
  const results: MessageRecord[] = [];
  const seenSids = new Set(state.seenSids);
  let fromCache: LoadedMessagePage | undefined;
  let toCache: LoadedMessagePage | undefined;

  while (results.length < options.limit) {
    let fromCandidate: MessageInstance | undefined;
    let toCandidate: MessageInstance | undefined;

    try {
      [
        { candidate: fromCandidate, cachedPage: fromCache },
        { candidate: toCandidate, cachedPage: toCache }
      ] = await Promise.all([
        findNextCandidate(options, state.fromPage, seenSids, fromCache),
        findNextCandidate(options, state.toPage, seenSids, toCache)
      ]);
    } catch (error) {
      if (results.length > 0) {
        warnings.push(`Stopped early after a pagination failure: ${mapTwilioError(error).message}`);
        break;
      }

      throw mapTwilioError(error);
    }

    const chosenStream = pickMostRecentCandidate(fromCandidate, toCandidate);
    if (!chosenStream) {
      return {
        results,
        warnings: warnings.length > 0 ? warnings : undefined
      };
    }

    const selectedMessage = chosenStream === "from" ? fromCandidate! : toCandidate!;
    const selectedPage = chosenStream === "from" ? state.fromPage : state.toPage;

    results.push(normalizeMessage(selectedMessage, Boolean(options.includeRaw)));
    seenSids.add(selectedMessage.sid);
    selectedPage.offset += 1;
  }

  const hasMore =
    streamHasMore(state.fromPage, fromCache) ||
    streamHasMore(state.toPage, toCache);

  return {
    results,
    warnings: warnings.length > 0 ? warnings : undefined,
    nextCursor: hasMore
      ? encodeCursor<MessageSearchState>({
          kind: options.kind,
          scopeAccountSid: options.config.effectiveAccountSid,
          state: {
            ...state,
            seenSids: Array.from(seenSids)
          }
        }, options.config.authPassword)
      : undefined
  };
}

export async function searchMessages(options: SearchMessagesOptions): Promise<{
  nextCursor?: string;
  results: MessageRecord[];
  warnings?: string[];
}> {
  const state = options.cursor
    ? decodeCursor<MessageSearchState>(
        options.cursor,
        options.kind,
        options.config.effectiveAccountSid,
        options.config.authPassword,
      )
    : buildInitialState(options);

  if (state.mode === "phone_union") {
    return searchMessagesByPhoneUnion(options, state);
  }

  return searchMessagesSingle(options, state);
}
