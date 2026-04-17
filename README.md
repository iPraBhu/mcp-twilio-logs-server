# mcp-twilio-logs-server

> ⚡ Vibe coded with [Claude Code](https://claude.ai/code) — reviewed and tightened for production use.

A **read-only** [Model Context Protocol](https://modelcontextprotocol.io) (MCP) `stdio` server for inspecting Twilio Messaging and Verify logs. Connect it to any MCP client and ask questions about SMS delivery failures, OTP attempt history, or phone-number activity — without leaving your AI assistant.

[![npm version](https://img.shields.io/npm/v/mcp-twilio-logs-server)](https://www.npmjs.com/package/mcp-twilio-logs-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js ≥ 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![Security Scan](https://mcpampel.com/badge/iPraBhu/mcp-twilio-logs-server.svg)](https://mcpampel.com/repo/iPraBhu/mcp-twilio-logs-server)

---

## Contents

- [Features](#features)
- [Tools](#tools)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [MCP client setup](#mcp-client-setup)
- [Tool reference](#tool-reference)
- [Response shape](#response-shape)
- [Pagination](#pagination)
- [Security](#security)
- [Known limitations](#known-limitations)

---

## Features

- **Strictly read-only** — no write, update, or delete operations; all mutation paths are absent from the codebase
- **Messaging** — search by sender, recipient, status, direction, error code, and time range; look up individual messages by SID
- **Verify** — search OTP attempt logs by phone, service, channel, and status; list and inspect Verify Services
- **Cursor pagination** — continue large result sets without re-fetching
- **Subaccount scoping** — hard-lock all queries to a specific subaccount SID
- **Flexible auth** — Account Auth Token or API Key + Secret
- **Env-file support** — load credentials from a file instead of inlining them in client config

---

## Tools

### Messaging

| Tool | Description |
|---|---|
| `search_message_logs` | Search messages by `from`, `to`, `phoneNumber`, `status`, `direction`, `errorCode`, and time range |
| `search_message_logs_by_phone` | Phone-number-focused search matching either `from` or `to` |
| `get_message_by_sid` | Fetch full details for a single Message SID (`SMxxxxxxxx…`) |

### Verify

| Tool | Description |
|---|---|
| `search_verify_logs` | Search Verify Attempts (last 30 days) by phone, service, channel, or status |
| `search_verify_logs_by_phone` | Primary phone-number-oriented Verify Attempt lookup |
| `get_verify_attempt_by_sid` | Fetch a single Verify Attempt by SID |
| `get_verify_service` | Fetch details for a Verify Service (`VAxxxxxxxx…`) |
| `list_verify_services` | List all Verify Services in the account scope |

All tools support `limit`, `pageSize`, `cursor` (continuation), and `includeRaw` (full Twilio payload).

---

## Requirements

- **Node.js** ≥ 20
- A Twilio account with Messaging and/or Verify enabled

---

## Quick start

```bash
# Run directly without installing
TWILIO_ACCOUNT_SID=ACxxx TWILIO_AUTH_TOKEN=your_token npx mcp-twilio-logs-server

# Or install globally
npm install -g mcp-twilio-logs-server
mcp-twilio-logs-server
```

---

## Configuration

All configuration is via environment variables.

### Authentication

Choose **one** of the following auth modes. Providing both, or neither, is a startup error.

**Option A — Account SID + Auth Token**

```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
```

**Option B — API Key + API Secret** *(recommended for production)*

```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_KEY=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_SECRET=your_api_secret
```

### All environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TWILIO_ACCOUNT_SID` | Yes | — | Your Twilio Account SID (`ACxxxxxxxx…`) |
| `TWILIO_AUTH_TOKEN` | Auth A | — | Account Auth Token |
| `TWILIO_API_KEY` | Auth B | — | API Key SID (`SKxxxxxxxx…`) |
| `TWILIO_API_SECRET` | Auth B | — | API Key Secret |
| `TWILIO_SUBACCOUNT_SID` | No | — | Scope all queries to this subaccount |
| `TWILIO_DEFAULT_LOOKBACK_DAYS` | No | `7` | Default lookback window when no `startTime` is given |
| `TWILIO_MAX_LIMIT` | No | `200` | Maximum records any tool call may return |
| `TWILIO_MAX_PAGE_SIZE` | No | `100` | Maximum Twilio page size per API request |
| `TWILIO_MAX_RETRIES` | No | `1` | Retry attempts on transient errors |
| `TWILIO_REQUEST_TIMEOUT_MS` | No | `15000` | Per-request timeout (ms) |
| `TWILIO_LOG_LEVEL` | No | `warn` | Log verbosity: `debug` \| `info` \| `warn` \| `error` |
| `TWILIO_LOGS_MCP_ENV_FILE` | No | — | Path to a `.env` file to load credentials from |

### Using an env file

Set `TWILIO_LOGS_MCP_ENV_FILE` to an absolute path. The server loads that file first; process environment variables override it.

```dotenv
# /path/to/.twilio-mcp-env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_KEY=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_SECRET=your_api_secret
TWILIO_DEFAULT_LOOKBACK_DAYS=14
```

Standard `.env` syntax is supported: quoted values, `export` prefix, and inline `#` comments.

---

## MCP client setup

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "twilio-logs": {
      "command": "npx",
      "args": ["-y", "mcp-twilio-logs-server"],
      "env": {
        "TWILIO_LOGS_MCP_ENV_FILE": "/absolute/path/to/.twilio-mcp-env"
      }
    }
  }
}
```

### Claude Code (CLI)

```bash
claude mcp add twilio-logs -- npx -y mcp-twilio-logs-server
```

Set `TWILIO_LOGS_MCP_ENV_FILE` or export credentials to your shell environment.

### VS Code

Add to `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "twilio-logs": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-twilio-logs-server"],
      "env": {
        "TWILIO_LOGS_MCP_ENV_FILE": "/absolute/path/to/.twilio-mcp-env"
      }
    }
  }
}
```

An example config file is also available at [examples/mcp-client-config.json](examples/mcp-client-config.json).

---

## Tool reference

### `search_message_logs`

Search Twilio Messaging logs.

| Parameter | Type | Description |
|---|---|---|
| `from` | string | Filter by sender |
| `to` | string | Filter by recipient |
| `phoneNumber` | string | Match either `from` or `to` |
| `status` | enum | `delivered`, `failed`, `sent`, `undelivered`, … |
| `direction` | enum | `inbound`, `outbound-api`, `outbound-call`, `outbound-reply` |
| `errorCode` | number | Twilio error code |
| `startTime` | ISO 8601 | Inclusive start (defaults to lookback window) |
| `endTime` | ISO 8601 | Inclusive end (defaults to now) |
| `limit` | number | Max records to return (default `50`, max `200`) |
| `pageSize` | number | Twilio page size |
| `cursor` | string | Continuation cursor from a previous response |
| `includeRaw` | boolean | Include raw Twilio payload (default `false`) |

### `search_message_logs_by_phone`

Same filters as above, but `phoneNumber` is required and the search runs parallel `from`/`to` queries when `direction` is omitted.

### `get_message_by_sid`

| Parameter | Type | Description |
|---|---|---|
| `sid` | string | Message SID (`SMxxxxxxxx…`) |
| `includeRaw` | boolean | Include raw Twilio payload |

### `search_verify_logs`

Search Twilio Verify Attempts. **Twilio documents this API as covering the last 30 days.**

| Parameter | Type | Description |
|---|---|---|
| `phoneNumber` | string | Filter by destination phone number |
| `verificationSid` | string | Filter by Verification SID (`VExxxxxxxx…`) |
| `serviceSid` | string | Filter by Verify Service SID (`VAxxxxxxxx…`) |
| `status` | enum | `converted` \| `unconverted` |
| `channel` | enum | `sms` \| `call` \| `email` \| `whatsapp` \| `rbm` |
| `startTime` | ISO 8601 | — |
| `endTime` | ISO 8601 | — |
| `limit` / `pageSize` / `cursor` / `includeRaw` | — | Same as messaging tools |

### `search_verify_logs_by_phone`

Same as `search_verify_logs` but `phoneNumber` is required.

### `get_verify_attempt_by_sid`

| Parameter | Type | Description |
|---|---|---|
| `sid` | string | Verify Attempt SID |
| `includeRaw` | boolean | Include raw payload |

### `get_verify_service`

| Parameter | Type | Description |
|---|---|---|
| `sid` | string | Verify Service SID (`VAxxxxxxxx…`) |
| `includeRaw` | boolean | Include raw payload |

### `list_verify_services`

| Parameter | Type | Description |
|---|---|---|
| `limit` / `pageSize` / `cursor` / `includeRaw` | — | Standard pagination controls |

---

## Response shape

All tools return a normalized structured object:

```json
{
  "accountSid": "ACxxx",
  "subaccountSid": "ACyyy",
  "query": { "...filters applied..." },
  "timeRange": { "start": "...", "end": "..." },
  "count": 12,
  "results": [ { "...record fields..." } ],
  "nextCursor": "...",
  "warnings": []
}
```

`nextCursor` is present when more pages are available. `warnings` surfaces partial failure messages when some data was collected before an error occurred. When `includeRaw: true`, each record includes a `raw` field with the full Twilio SDK payload.

---

## Pagination

| Control | Default | Max |
|---|---|---|
| `limit` | `50` | `TWILIO_MAX_LIMIT` (default `200`) |
| `pageSize` | `100` | `TWILIO_MAX_PAGE_SIZE` (default `100`) |

To continue a result set, pass the `nextCursor` value as `cursor` in the next call. Do not combine `cursor` with new filter parameters.

---

## Security

- **Read-only by design** — no write operations exist anywhere in the codebase
- **Credentials never logged** — auth tokens and secrets are explicitly excluded from all log output
- **Signed cursors** — pagination cursors are signed server-side; callers cannot forge or redirect follow-up requests
- **Cursor URL validation** — follow-on page URLs are validated to stay on Twilio HTTPS hosts within the expected read-only API paths
- **Subaccount lock** — when `TWILIO_SUBACCOUNT_SID` is set, Verify responses are checked against the configured scope; out-of-scope records fail closed rather than leaking data
- **Stdio transport only** — no HTTP or SSE surface

**Best practices:**
- Prefer API Keys over Account Auth Tokens in production
- Use the narrowest Twilio credentials practical
- Treat returned phone numbers and message bodies as sensitive data in downstream clients

---

## Development

```bash
npm install        # install dependencies
npm run build      # compile TypeScript to dist/
npm run dev        # run with tsx (no build needed)
npm run typecheck  # type-check without emitting
npm test           # run tests
npm run check      # build + typecheck + test
```

---

## Known limitations

- Twilio Verify Attempts are documented by Twilio as covering only the last 30 days
- Messaging search pushes only the filters Twilio's Messages API natively supports server-side; others require local filtering
- Cursor-based continuation cannot be mixed with new filter parameters
- `stdio` transport only — no HTTP or SSE
- No write or mutation capabilities

---

## License

[MIT](LICENSE)

> **Vibe coded** with AI Assistants — reviewed and tightened for production use.
