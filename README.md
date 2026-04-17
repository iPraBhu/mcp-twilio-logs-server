# mcp-twilio-logs-server

`mcp-twilio-logs-server` is a production-oriented, read-only Model Context Protocol (MCP) server for inspecting Twilio logs over `stdio`.

This project is vibe coded, then manually reviewed and tightened for packaging, safety, and Twilio API correctness.

It supports only these Twilio product areas:

- Messaging
- Verify

It exposes MCP tools only. It does not expose MCP resources or prompts.

## What It Does

This server gives MCP clients a safe, read-only way to inspect:

- Twilio Messaging logs and message details
- Twilio Verify attempts and Verify service details

It is built for operator workflows like debugging delivery issues, support lookups, incident response, and account-scoped log inspection.

## Read-only guarantee

This server is intentionally architected to be read-only:

- No create, update, delete, or mutation tools are implemented.
- The internal Twilio wrapper only exposes read methods used by this package.
- The code uses an explicit, documented allowlist of Twilio read operations.
- No hidden write paths are used.

## Security Notes

This package is intended to be safe to run as a local MCP stdio server and includes a few practical guardrails:

- Credentials are loaded from environment variables only.
- Credentials can be supplied directly through environment variables or through a local env file referenced by one environment variable.
- Secrets are never logged.
- The transport is `stdio` only.
- Pagination cursors are signed server-side, so callers cannot tamper with them to redirect follow-up requests.
- Cursor-followed page URLs are validated to stay on Twilio HTTPS hosts and inside the expected read-only API paths.
- Verify responses are account-scope checked so subaccount lock behavior fails closed.

You should still:

- Prefer Twilio API Keys over account auth tokens.
- Use the narrowest practical Twilio credentials.
- Treat returned phone numbers and message bodies as sensitive data in downstream MCP clients.

## Supported Twilio scope

### Messaging

The server uses the Twilio Messages API for log inspection.

Supported focus:

- Message search and lookup
- Phone-number-oriented searches
- Status, direction, time-range, and error-code filtering

Messaging support is focused on SMS-oriented operational log inspection. The implementation does not claim channel-specific support beyond what is actually queried through the Twilio Messages API.

### Verify

The server uses these read-only Twilio Verify APIs:

- Verify Services
- Verify Attempts

Important limitation:

- `search_verify_logs` and `search_verify_logs_by_phone` use Twilio Verify Attempts.
- Twilio documents Verify Attempts as covering the last 30 days.
- This server validates that limit and returns a clear error if an older range is requested.

## Installation

```bash
npm install mcp-twilio-logs-server
```

For local development in this repo:

```bash
npm install
npm run build
```

## Configuration

Configuration is environment-variable driven.

Required base variable:

- `TWILIO_ACCOUNT_SID`

Choose one auth mode:

1. Account SID + Auth Token
2. API Key + API Secret

Supported environment variables:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_API_KEY`
- `TWILIO_API_SECRET`
- `TWILIO_SUBACCOUNT_SID` optional
- `TWILIO_DEFAULT_LOOKBACK_DAYS` optional, default `7`
- `TWILIO_MAX_LIMIT` optional, default `200`
- `TWILIO_MAX_PAGE_SIZE` optional, default `100`
- `TWILIO_MAX_RETRIES` optional, default `1`
- `TWILIO_LOG_LEVEL` optional, default `warn`
- `TWILIO_LOGS_MCP_ENV_FILE` optional path to a dotenv-style env file
- `TWILIO_REQUEST_TIMEOUT_MS` optional, default `15000`

Direct environment variables override values loaded from `TWILIO_LOGS_MCP_ENV_FILE`.

### MCP env file option

If you do not want to inline Twilio credentials in your MCP client config, point the server at a local env file:

```dotenv
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_KEY=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_SECRET=your_api_secret
TWILIO_DEFAULT_LOOKBACK_DAYS=7
TWILIO_MAX_LIMIT=200
TWILIO_MAX_PAGE_SIZE=100
TWILIO_MAX_RETRIES=1
TWILIO_LOG_LEVEL=warn
```

Then set this in your MCP client config `env` block:

```json
{
  "TWILIO_LOGS_MCP_ENV_FILE": "/absolute/path/to/.twilio-logs-mcp-env"
}
```

### Recommended auth mode: API Key + API Secret

Twilio recommends API keys for production use, and this server README does too.

Example:

```bash
export TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export TWILIO_API_KEY=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export TWILIO_API_SECRET=your_api_secret
```

### Alternate auth mode: Account SID + Auth Token

Example:

```bash
export TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export TWILIO_AUTH_TOKEN=your_auth_token
```

### If both auth modes are present

The server now fails fast if both auth modes are configured at once. This avoids ambiguous startup behavior.

## Subaccount hard-lock behavior

If `TWILIO_SUBACCOUNT_SID` is set, the server hard-locks operations to that subaccount scope.

Behavior:

- Messaging queries are executed against the configured subaccount path.
- Verify responses are validated so records cannot escape the configured scope.
- If Twilio returns a Verify record outside the configured scope, the server fails the request rather than leaking data.

This is especially important when parent-account credentials are used with a configured subaccount scope.

Example:

```bash
export TWILIO_ACCOUNT_SID=AC_parent_account_sid_here
export TWILIO_API_KEY=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export TWILIO_API_SECRET=your_api_secret
export TWILIO_SUBACCOUNT_SID=AC_subaccount_sid_here
```

## Running the server

After installing from npm:

```bash
npx mcp-twilio-logs-server
```

After building locally from this repo:

```bash
node dist/index.js
```

Print the package version:

```bash
node dist/index.js -v
```

The server writes structured operational logs to `stderr` and speaks MCP over `stdio`.

## MCP client config example

An example config file is also included at [examples/mcp-client-config.json](examples/mcp-client-config.json).

Example `stdio` client configuration:

```json
{
  "mcpServers": {
    "twilio-logs": {
      "command": "node",
      "args": [
        "/absolute/path/to/node_modules/mcp-twilio-logs-server/dist/index.js"
      ],
      "env": {
        "TWILIO_LOGS_MCP_ENV_FILE": "/absolute/path/to/.twilio-logs-mcp-env"
      }
    }
  }
}
```

If you prefer `npx`:

```json
{
  "mcpServers": {
    "twilio-logs": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-twilio-logs-server"
      ],
      "env": {
        "TWILIO_LOGS_MCP_ENV_FILE": "/absolute/path/to/.twilio-logs-mcp-env"
      }
    }
  }
}
```

If you prefer inline values, direct environment variables still work and override env-file values when both are present.

## Tools

### `search_message_logs`

Search Twilio Messaging logs with these filters:

- `from`
- `to`
- `phoneNumber`
- `status`
- `direction`
- `errorCode`
- `startTime`
- `endTime`
- `limit`
- `pageSize`
- `cursor`
- `includeRaw`

Notes:

- If no time range is provided, the server defaults to the last 7 days or `TWILIO_DEFAULT_LOOKBACK_DAYS`.
- `from`, `to`, and time-range filters are pushed down to Twilio where possible.
- `status`, `direction`, and `errorCode` may require additional local filtering depending on the query shape.
- `phoneNumber` without an explicit `direction` now runs parallel `from` and `to` searches and merges the results.

### `get_message_by_sid`

Parameters:

- `sid`
- `includeRaw`

### `search_message_logs_by_phone`

Parameters:

- `phoneNumber`
- `direction`
- `status`
- `errorCode`
- `startTime`
- `endTime`
- `limit`
- `pageSize`
- `cursor`
- `includeRaw`

Notes:

- Supplying `direction` still helps, but when omitted the server now queries both `from` and `to` in parallel instead of scanning a broader message set locally.

### `search_verify_logs`

Search Twilio Verify Attempts with these filters:

- `phoneNumber`
- `verificationSid`
- `serviceSid`
- `status`
- `channel`
- `startTime`
- `endTime`
- `limit`
- `pageSize`
- `cursor`
- `includeRaw`

### `search_verify_logs_by_phone`

Parameters:

- `phoneNumber`
- `serviceSid`
- `status`
- `channel`
- `startTime`
- `endTime`
- `limit`
- `pageSize`
- `cursor`
- `includeRaw`

### `get_verify_attempt_by_sid`

Parameters:

- `sid`
- `includeRaw`

### `get_verify_service`

Parameters:

- `sid`
- `includeRaw`

### `list_verify_services`

Parameters:

- `limit`
- `pageSize`
- `cursor`
- `includeRaw`

## Example tool invocations

### Search recent SMS logs for a phone number

```json
{
  "phoneNumber": "+14155550100",
  "limit": 25
}
```

Tool: `search_message_logs_by_phone`

### Search failed outbound messages in a time window

```json
{
  "direction": "outbound-api",
  "status": "failed",
  "startTime": "2026-04-01T00:00:00Z",
  "endTime": "2026-04-16T00:00:00Z",
  "limit": 50
}
```

Tool: `search_message_logs`

### Fetch one message by SID

```json
{
  "sid": "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

Tool: `get_message_by_sid`

### Search Verify attempts by phone number

```json
{
  "phoneNumber": "+14155550100",
  "channel": "sms",
  "limit": 25
}
```

Tool: `search_verify_logs_by_phone`

### Fetch a Verify service

```json
{
  "sid": "VAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

Tool: `get_verify_service`

## Response shape

Tool responses are normalized structured objects with these top-level fields:

- `accountSid`
- `subaccountSid` when configured
- `query`
- `timeRange` when applicable
- `count`
- `results`
- `nextCursor` when more data is available
- `warnings` when partial pagination failures occurred after some data had already been collected

When `includeRaw: true` is used, individual records include a `raw` object from the Twilio SDK payload for debugging.

Phone numbers and message bodies are returned in full. This server does not mask phone numbers by default.

## Pagination behavior

Pagination is intentionally conservative and operator-friendly.

Defaults:

- `limit`: `50`
- `pageSize`: `100` by default, capped by `limit` and `TWILIO_MAX_PAGE_SIZE`

Maximums by default:

- `limit`: `200`
- `pageSize`: `100`

These defaults can be changed with:

- `TWILIO_MAX_LIMIT`
- `TWILIO_MAX_PAGE_SIZE`
- `TWILIO_MAX_RETRIES`

Cursor behavior:

- The server returns an opaque `nextCursor` when more data is available.
- Pass `cursor` back to the same tool to continue.
- When `cursor` is provided, do not send new filters in the same request.
- `limit` and `pageSize` remain per-call controls on the MCP side.

## Logging and observability

The server writes minimal structured logs to `stderr` only.

It logs:

- warnings and errors by default
- debug/info logs when `TWILIO_LOG_LEVEL` is lowered to `debug` or `info`

It never logs:

- auth tokens
- API secrets
- full credentials

## Known limitations

- Messaging log search is backed by the Twilio Messages API and only pushes down the filters that Twilio actually supports server-side.
- Verify log search is backed by Twilio Verify Attempts, which Twilio documents as covering the last 30 days.
- When using cursors, do not mix the cursor with new filters.
- This package is `stdio` only and does not implement HTTP or SSE transport.
- This package intentionally does not expose any write or mutation capabilities.
- This package is vibe coded, but the shipped code path has been manually tightened and should still be reviewed by humans before use in high-sensitivity environments.

## npm publishing readiness notes

This package is set up for eventual npm publication:

- Package name: `mcp-twilio-logs-server`
- Version: `0.1.0`
- ESM package with a `bin` entry
- Build output in `dist`
- `prepack` builds automatically
- Example client config included
- README examples match the implemented tools

Suggested publish flow:

```bash
npm test
npm run build
npm publish --access public
```
