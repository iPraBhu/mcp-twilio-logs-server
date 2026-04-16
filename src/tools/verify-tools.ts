import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import type {
  BaseToolResult,
  ServerConfig,
  VerifyAttemptRecord,
  VerifyAttemptStatus,
  VerifyServiceRecord
} from "../types.js";
import type { TwilioReadClient } from "../twilio/client.js";
import { fetchVerifyAttempt, listVerifyServices, normalizeVerifyService, searchVerifyAttempts } from "../twilio/verify.js";
import { invalidParams, mapTwilioError, getErrorLogDetails } from "../utils/errors.js";
import { log } from "../utils/logging.js";
import { resolveTimeRange } from "../utils/time.js";
import {
  makeBaseResultSchema,
  verifyAttemptRecordSchema,
  verifyServiceRecordSchema
} from "./output-schemas.js";

const verifyChannelSchema = z.enum(["call", "email", "rbm", "sms", "whatsapp"]);
const verifyStatusSchema = z.enum(["converted", "unconverted"]);
const dateInputSchema = z
  .union([z.date(), z.string()])
  .transform((value) => (value instanceof Date ? value : new Date(value)));

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

function buildVerifyResult<TQuery>(
  config: ServerConfig,
  payload: {
    nextCursor?: string;
    results: VerifyAttemptRecord[];
    warnings?: string[];
  },
  query: TQuery,
  timeRange: {
    end: string;
    start: string;
  },
): BaseToolResult<VerifyAttemptRecord, TQuery> {
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

function buildVerifyServiceResult<TQuery>(
  config: ServerConfig,
  payload: {
    nextCursor?: string;
    results: VerifyServiceRecord[];
    warnings?: string[];
  },
  query: TQuery,
): BaseToolResult<VerifyServiceRecord, TQuery> {
  return {
    accountSid: config.accountSid,
    subaccountSid: config.subaccountSid,
    query,
    count: payload.results.length,
    results: payload.results,
    nextCursor: payload.nextCursor,
    warnings: payload.warnings
  };
}

function buildVerifyAttemptSingleResult(
  config: ServerConfig,
  result: VerifyAttemptRecord,
  query: { sid: string },
): BaseToolResult<VerifyAttemptRecord, { sid: string }> {
  return {
    accountSid: config.accountSid,
    subaccountSid: config.subaccountSid,
    query,
    count: 1,
    results: [result]
  };
}

export function registerVerifyTools(server: McpServer, client: TwilioReadClient, config: ServerConfig): void {
  const commonSearchSchema = {
    startTime: dateInputSchema
      .optional()
      .describe("Inclusive start time in ISO 8601 format. Defaults to the configured lookback window."),
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
      .default(Math.min(50, config.maxPageSize))
      .describe(`Twilio page size. Default 50. Maximum ${config.maxPageSize}.`),
    cursor: z
      .string()
      .optional()
      .describe("Opaque continuation cursor returned by a previous search. Do not combine with new filters."),
    includeRaw: z.boolean().default(false).describe("Include raw Twilio payload objects in each record.")
  };
  const searchVerifyLogsOutputSchema = makeBaseResultSchema(
    z.object({
      phoneNumber: z.string().optional(),
      verificationSid: z.string().optional(),
      serviceSid: z.string().optional(),
      status: verifyStatusSchema.optional(),
      channel: verifyChannelSchema.optional(),
      limit: z.number().int().positive(),
      pageSize: z.number().int().positive()
    }),
    verifyAttemptRecordSchema,
    { includeTimeRange: true },
  );
  const listVerifyServicesOutputSchema = makeBaseResultSchema(
    z.object({
      limit: z.number().int().positive(),
      pageSize: z.number().int().positive()
    }),
    verifyServiceRecordSchema,
  );

  server.registerTool(
    "search_verify_logs",
    {
      description:
        "Search Twilio Verify Attempts in read-only mode. This uses Twilio Verify Attempts, which Twilio documents as covering the last 30 days.",
      outputSchema: searchVerifyLogsOutputSchema,
      inputSchema: {
        phoneNumber: z.string().optional().describe("Filter by destination phone number in channelData.to."),
        verificationSid: z
          .string()
          .regex(/^VE[0-9a-fA-F]{32}$/, "Must be a valid Twilio Verification SID.")
          .optional(),
        serviceSid: z.string().regex(/^VA[0-9a-fA-F]{32}$/, "Must be a valid Twilio Verify Service SID.").optional(),
        status: verifyStatusSchema.optional().describe("Filter by Verify Attempt conversion status."),
        channel: verifyChannelSchema.optional().describe("Filter by Verify Attempt channel."),
        ...commonSearchSchema
      }
    },
    async (args) => {
      log("info", "tool_invocation", { tool: "search_verify_logs" });

      ensureCursorOnlyRequest(args, ["cursor", "includeRaw", "limit", "pageSize"]);

      try {
        const { start, end, timeRange } = resolveTimeRange(
          { startTime: args.startTime, endTime: args.endTime },
          config,
          { maxLookbackDays: 30 },
        );

        const query = {
          phoneNumber: args.phoneNumber,
          verificationSid: args.verificationSid,
          serviceSid: args.serviceSid,
          status: args.status,
          channel: args.channel,
          limit: args.limit,
          pageSize: args.pageSize
        };

        const searchResult = await searchVerifyAttempts({
          client,
          config,
          cursor: args.cursor,
          includeRaw: args.includeRaw,
          kind: "search_verify_logs",
          limit: args.limit,
          pageSize: args.pageSize,
          phoneNumber: args.phoneNumber,
          query,
          status: args.status,
          timeRange: { start, end },
          verificationSid: args.verificationSid,
          verifyServiceSid: args.serviceSid,
          channel: args.channel
        });

        const structuredContent = buildVerifyResult(config, searchResult, query, timeRange);
        log("info", "tool_success", {
          tool: "search_verify_logs",
          count: structuredContent.count,
          nextCursor: Boolean(structuredContent.nextCursor)
        });

        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent
        };
      } catch (error) {
        log("error", "tool_failure", {
          tool: "search_verify_logs",
          ...getErrorLogDetails(error)
        });
        throw error instanceof McpError ? error : mapTwilioError(error);
      }
    },
  );

  server.registerTool(
    "search_verify_logs_by_phone",
    {
      description:
        "Search Twilio Verify Attempts by destination phone number in read-only mode. This is the primary phone-number-oriented Verify lookup tool.",
      outputSchema: makeBaseResultSchema(
        z.object({
          phoneNumber: z.string(),
          serviceSid: z.string().optional(),
          status: verifyStatusSchema.optional(),
          channel: verifyChannelSchema.optional(),
          limit: z.number().int().positive(),
          pageSize: z.number().int().positive()
        }),
        verifyAttemptRecordSchema,
        { includeTimeRange: true },
      ),
      inputSchema: {
        phoneNumber: z.string().min(1).describe("Destination phone number, typically in E.164 format."),
        serviceSid: z.string().regex(/^VA[0-9a-fA-F]{32}$/, "Must be a valid Twilio Verify Service SID.").optional(),
        status: verifyStatusSchema.optional().describe("Filter by Verify Attempt conversion status."),
        channel: verifyChannelSchema.optional().describe("Filter by Verify Attempt channel."),
        ...commonSearchSchema
      }
    },
    async (args) => {
      log("info", "tool_invocation", { tool: "search_verify_logs_by_phone" });

      ensureCursorOnlyRequest(args, ["cursor", "includeRaw", "limit", "pageSize"]);

      try {
        const { start, end, timeRange } = resolveTimeRange(
          { startTime: args.startTime, endTime: args.endTime },
          config,
          { maxLookbackDays: 30 },
        );

        const query = {
          phoneNumber: args.phoneNumber,
          serviceSid: args.serviceSid,
          status: args.status,
          channel: args.channel,
          limit: args.limit,
          pageSize: args.pageSize
        };

        const searchResult = await searchVerifyAttempts({
          client,
          config,
          cursor: args.cursor,
          includeRaw: args.includeRaw,
          kind: "search_verify_logs_by_phone",
          limit: args.limit,
          pageSize: args.pageSize,
          phoneNumber: args.phoneNumber,
          query,
          status: args.status,
          timeRange: { start, end },
          verifyServiceSid: args.serviceSid,
          channel: args.channel
        });

        const structuredContent = buildVerifyResult(config, searchResult, query, timeRange);
        log("info", "tool_success", {
          tool: "search_verify_logs_by_phone",
          count: structuredContent.count,
          nextCursor: Boolean(structuredContent.nextCursor)
        });

        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent
        };
      } catch (error) {
        log("error", "tool_failure", {
          tool: "search_verify_logs_by_phone",
          ...getErrorLogDetails(error)
        });
        throw error instanceof McpError ? error : mapTwilioError(error);
      }
    },
  );

  server.registerTool(
    "get_verify_attempt_by_sid",
    {
      description: "Fetch read-only details for a specific Twilio Verify Attempt SID.",
      outputSchema: makeBaseResultSchema(
        z.object({ sid: z.string() }),
        verifyAttemptRecordSchema,
      ),
      inputSchema: {
        sid: z.string().describe("Twilio Verify Attempt SID."),
        includeRaw: z.boolean().default(false).describe("Include the raw Twilio Verify Attempt payload.")
      }
    },
    async ({ includeRaw, sid }) => {
      log("info", "tool_invocation", { tool: "get_verify_attempt_by_sid" });

      try {
        const result = await fetchVerifyAttempt({ client, includeRaw, sid });
        const structuredContent = buildVerifyAttemptSingleResult(config, result, { sid });

        log("info", "tool_success", { tool: "get_verify_attempt_by_sid", count: 1 });
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent
        };
      } catch (error) {
        log("error", "tool_failure", {
          tool: "get_verify_attempt_by_sid",
          ...getErrorLogDetails(error)
        });
        throw error instanceof McpError ? error : mapTwilioError(error);
      }
    },
  );

  server.registerTool(
    "get_verify_service",
    {
      description: "Fetch read-only details for a specific Twilio Verify Service SID.",
      outputSchema: makeBaseResultSchema(
        z.object({ sid: z.string() }),
        verifyServiceRecordSchema,
      ),
      inputSchema: {
        sid: z.string().regex(/^VA[0-9a-fA-F]{32}$/, "Must be a valid Twilio Verify Service SID."),
        includeRaw: z.boolean().default(false).describe("Include the raw Twilio Verify Service payload.")
      }
    },
    async ({ includeRaw, sid }) => {
      log("info", "tool_invocation", { tool: "get_verify_service" });

      try {
        const service = await client.fetchVerifyService(sid);
        const result = normalizeVerifyService(service, includeRaw);
        const structuredContent = buildVerifyServiceResult(
          config,
          { results: [result] },
          { sid },
        );

        log("info", "tool_success", { tool: "get_verify_service", count: 1 });
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent
        };
      } catch (error) {
        log("error", "tool_failure", {
          tool: "get_verify_service",
          ...getErrorLogDetails(error)
        });
        throw error instanceof McpError ? error : mapTwilioError(error);
      }
    },
  );

  server.registerTool(
    "list_verify_services",
    {
      description: "List Twilio Verify Services in the configured account scope, with pagination and optional raw payloads.",
      outputSchema: listVerifyServicesOutputSchema,
      inputSchema: {
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
          .default(Math.min(50, config.maxPageSize))
          .describe(`Twilio page size. Default 50. Maximum ${config.maxPageSize}.`),
        cursor: z
          .string()
          .optional()
          .describe("Opaque continuation cursor returned by a previous list operation."),
        includeRaw: z.boolean().default(false).describe("Include raw Twilio payload objects in each record.")
      }
    },
    async (args) => {
      log("info", "tool_invocation", { tool: "list_verify_services" });

      try {
        const listResult = await listVerifyServices({
          client,
          config,
          cursor: args.cursor,
          includeRaw: args.includeRaw,
          kind: "list_verify_services",
          limit: args.limit,
          pageSize: args.pageSize,
          query: {
            limit: args.limit,
            pageSize: args.pageSize
          }
        });

        const structuredContent = buildVerifyServiceResult(
          config,
          listResult,
          { limit: args.limit, pageSize: args.pageSize },
        );

        log("info", "tool_success", {
          tool: "list_verify_services",
          count: structuredContent.count,
          nextCursor: Boolean(structuredContent.nextCursor)
        });

        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent
        };
      } catch (error) {
        log("error", "tool_failure", {
          tool: "list_verify_services",
          ...getErrorLogDetails(error)
        });
        throw error instanceof McpError ? error : mapTwilioError(error);
      }
    },
  );
}
