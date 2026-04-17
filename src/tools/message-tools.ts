import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import type { BaseToolResult, MessageRecord, ServerConfig } from "../types.js";
import type { TwilioReadClient } from "../twilio/client.js";
import { searchMessages, normalizeMessage } from "../twilio/messaging.js";
import { invalidParams, mapTwilioError, getErrorLogDetails } from "../utils/errors.js";
import { resolveTimeRange } from "../utils/time.js";
import { log } from "../utils/logging.js";
import { makeResultText } from "./content.js";
import { makeBaseResultSchema, messageRecordSchema } from "./output-schemas.js";

const messageDirectionSchema = z.enum(["inbound", "outbound-api", "outbound-call", "outbound-reply"]);
const messageStatusSchema = z.enum([
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
]);

const dateInputSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Must be a valid ISO 8601 date-time string.")
  .transform((value) => new Date(value));

function makeCommonSearchSchema(config: ServerConfig) {
  const defaultPageSize = Math.min(config.maxPageSize, config.maxLimit);

  return {
    startTime: dateInputSchema.optional().describe("Inclusive start time in ISO 8601 format. Defaults to the configured lookback window."),
    endTime: dateInputSchema.optional().describe("Inclusive end time in ISO 8601 format. Defaults to now."),
    limit: z
      .number()
      .int()
      .positive()
      .max(config.maxLimit)
      .default(Math.min(50, config.maxLimit))
      .describe(`Maximum number of records to return. Default 50. Maximum ${config.maxLimit}.`),
    pageSize: z
      .number()
      .int()
      .positive()
      .max(config.maxPageSize)
      .default(defaultPageSize)
      .describe(`Twilio page size. Default ${defaultPageSize}. Maximum ${config.maxPageSize}.`),
    cursor: z
      .string()
      .optional()
      .describe("Opaque continuation cursor returned by a previous search. Do not combine with new filters."),
    includeRaw: z.boolean().default(false).describe("Include raw Twilio payload objects in each record.")
  };
}

function ensureCursorOnlyRequest<T extends Record<string, unknown>>(args: T, allowed: string[]): void {
  if (!args.cursor) {
    return;
  }

  const disallowedKeys = Object.entries(args)
    .filter(([key, value]) => value !== undefined && value !== null && !allowed.includes(key))
    .map(([key]) => key);

  if (disallowedKeys.length > 0) {
    throw invalidParams(`When cursor is provided, do not pass new filters: ${disallowedKeys.join(", ")}.`);
  }
}

function buildMessageResult<TQuery>(
  config: ServerConfig,
  payload: {
    nextCursor?: string;
    results: MessageRecord[];
    warnings?: string[];
  },
  query: TQuery,
  timeRange: {
    end: string;
    start: string;
  },
): BaseToolResult<MessageRecord, TQuery> {
  return {
    accountSid: config.accountSid,
    subaccountSid: config.subaccountSid,
    query,
    timeRange,
    count: payload.results.length,
    results: payload.results,
    nextCursor: payload.nextCursor,
    warnings: payload.warnings
  };
}

export function registerMessageTools(server: McpServer, client: TwilioReadClient, config: ServerConfig): void {
  const commonSchema = makeCommonSearchSchema(config);
  const searchMessageLogsQuerySchema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    phoneNumber: z.string().optional(),
    status: messageStatusSchema.optional(),
    direction: messageDirectionSchema.optional(),
    errorCode: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive(),
    pageSize: z.number().int().positive()
  });
  const searchMessageLogsOutputSchema = makeBaseResultSchema(
    searchMessageLogsQuerySchema,
    messageRecordSchema,
    { includeTimeRange: true },
  );
  const getMessageBySidOutputSchema = makeBaseResultSchema(
    z.object({ sid: z.string() }),
    messageRecordSchema,
  );

  server.registerTool(
    "search_message_logs",
    {
      description:
        "Search read-only Twilio Messaging logs. Uses Twilio Messages and supports phone-focused filtering, time ranges, pagination, and optional raw payloads.",
      outputSchema: searchMessageLogsOutputSchema,
      inputSchema: {
        from: z.string().optional().describe("Filter by sender address or phone number."),
        to: z.string().optional().describe("Filter by recipient address or phone number."),
        phoneNumber: z
          .string()
          .optional()
          .describe("Filter by phone number appearing in either from or to. Best results come from using from/to or the by-phone tool."),
        status: messageStatusSchema.optional().describe("Filter by Twilio Message status."),
        direction: messageDirectionSchema.optional().describe("Filter by Twilio Message direction."),
        errorCode: z.number().int().nonnegative().optional().describe("Filter by Twilio Message error code."),
        ...commonSchema
      }
    },
    async (args) => {
      log("info", "tool_invocation", { tool: "search_message_logs" });

      ensureCursorOnlyRequest(args, ["cursor", "includeRaw", "limit", "pageSize"]);

      try {
        const pageSize = Math.min(args.pageSize, args.limit);
        const { start, end, timeRange } = resolveTimeRange(
          { startTime: args.startTime, endTime: args.endTime },
          config,
        );

        const query = {
          from: args.from,
          to: args.to,
          phoneNumber: args.phoneNumber,
          status: args.status,
          direction: args.direction,
          errorCode: args.errorCode,
          limit: args.limit,
          pageSize
        };

        const searchResult = await searchMessages({
          client,
          config,
          cursor: args.cursor,
          direction: args.direction,
          errorCode: args.errorCode,
          from: args.from,
          includeRaw: args.includeRaw,
          kind: "search_message_logs",
          limit: args.limit,
          pageSize,
          phoneNumber: args.phoneNumber,
          query,
          status: args.status,
          timeRange: { start, end },
          to: args.to
        });

        const structuredContent = buildMessageResult(config, searchResult, query, timeRange);
        log("info", "tool_success", {
          tool: "search_message_logs",
          count: structuredContent.count,
          nextCursor: Boolean(structuredContent.nextCursor)
        });

        return {
          content: [{ type: "text", text: makeResultText("search_message_logs", structuredContent.count, { nextCursor: structuredContent.nextCursor }) }],
          structuredContent
        };
      } catch (error) {
        log("error", "tool_failure", {
          tool: "search_message_logs",
          ...getErrorLogDetails(error)
        });
        throw error instanceof McpError ? error : mapTwilioError(error);
      }
    },
  );

  server.registerTool(
    "get_message_by_sid",
    {
      description: "Fetch detailed read-only information for a single Twilio Message SID.",
      outputSchema: getMessageBySidOutputSchema,
      inputSchema: {
        sid: z.string().regex(/^SM[0-9a-fA-F]{32}$/, "Must be a valid Twilio Message SID."),
        includeRaw: z.boolean().default(false).describe("Include the raw Twilio Message payload.")
      }
    },
    async ({ includeRaw, sid }) => {
      log("info", "tool_invocation", { tool: "get_message_by_sid" });

      try {
        const message = await client.fetchMessage(sid);
        const result = normalizeMessage(message, includeRaw);
        const structuredContent = {
          accountSid: config.accountSid,
          subaccountSid: config.subaccountSid,
          query: { sid },
          count: 1,
          results: [result]
        };

        log("info", "tool_success", { tool: "get_message_by_sid", count: 1 });
        return {
          content: [{ type: "text", text: makeResultText("get_message_by_sid", structuredContent.count) }],
          structuredContent
        };
      } catch (error) {
        log("error", "tool_failure", {
          tool: "get_message_by_sid",
          ...getErrorLogDetails(error)
        });
        throw error instanceof McpError ? error : mapTwilioError(error);
      }
    },
  );

  server.registerTool(
    "search_message_logs_by_phone",
    {
      description:
        "Search read-only Twilio Messaging logs centered on a single phone number. If direction is omitted, the search matches either from or to within the selected time window.",
      outputSchema: makeBaseResultSchema(
        z.object({
          phoneNumber: z.string(),
          direction: messageDirectionSchema.optional(),
          status: messageStatusSchema.optional(),
          errorCode: z.number().int().nonnegative().optional(),
          limit: z.number().int().positive(),
          pageSize: z.number().int().positive()
        }),
        messageRecordSchema,
        { includeTimeRange: true },
      ),
      inputSchema: {
        phoneNumber: z.string().min(1).describe("Phone number to search for, typically in E.164 format."),
        direction: messageDirectionSchema
          .optional()
          .describe("Optional Twilio Message direction. Supplying a direction improves query efficiency."),
        status: messageStatusSchema.optional().describe("Filter by Twilio Message status."),
        errorCode: z.number().int().nonnegative().optional().describe("Filter by Twilio Message error code."),
        ...commonSchema
      }
    },
    async (args) => {
      log("info", "tool_invocation", { tool: "search_message_logs_by_phone" });

      ensureCursorOnlyRequest(args, ["cursor", "includeRaw", "limit", "pageSize"]);

      try {
        const pageSize = Math.min(args.pageSize, args.limit);
        const { start, end, timeRange } = resolveTimeRange(
          { startTime: args.startTime, endTime: args.endTime },
          config,
        );

        const query = {
          phoneNumber: args.phoneNumber,
          direction: args.direction,
          status: args.status,
          errorCode: args.errorCode,
          limit: args.limit,
          pageSize
        };

        const searchResult = await searchMessages({
          client,
          config,
          cursor: args.cursor,
          direction: args.direction,
          errorCode: args.errorCode,
          includeRaw: args.includeRaw,
          kind: "search_message_logs_by_phone",
          limit: args.limit,
          pageSize,
          phoneNumber: args.phoneNumber,
          query,
          status: args.status,
          timeRange: { start, end }
        });

        const structuredContent = buildMessageResult(config, searchResult, query, timeRange);
        log("info", "tool_success", {
          tool: "search_message_logs_by_phone",
          count: structuredContent.count,
          nextCursor: Boolean(structuredContent.nextCursor)
        });

        return {
          content: [{ type: "text", text: makeResultText("search_message_logs_by_phone", structuredContent.count, { nextCursor: structuredContent.nextCursor }) }],
          structuredContent
        };
      } catch (error) {
        log("error", "tool_failure", {
          tool: "search_message_logs_by_phone",
          ...getErrorLogDetails(error)
        });
        throw error instanceof McpError ? error : mapTwilioError(error);
      }
    },
  );
}
