import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.ts";

test("loadConfig rejects mixed auth modes", () => {
  assert.throws(
    () =>
      loadConfig({
        TWILIO_ACCOUNT_SID: "AC11111111111111111111111111111111",
        TWILIO_AUTH_TOKEN: "auth-token",
        TWILIO_API_KEY: "SK11111111111111111111111111111111",
        TWILIO_API_SECRET: "api-secret"
      }),
    /either Account SID \+ Auth Token or API Key \+ API Secret, but not both/i,
  );
});

test("loadConfig rejects partial API key config", () => {
  assert.throws(
    () =>
      loadConfig({
        TWILIO_ACCOUNT_SID: "AC11111111111111111111111111111111",
        TWILIO_API_KEY: "SK11111111111111111111111111111111"
      }),
    /must be provided together/i,
  );
});

test("loadConfig accepts timeout configuration", () => {
  const config = loadConfig({
    TWILIO_ACCOUNT_SID: "AC11111111111111111111111111111111",
    TWILIO_API_KEY: "SK11111111111111111111111111111111",
    TWILIO_API_SECRET: "api-secret",
    TWILIO_REQUEST_TIMEOUT_MS: "3210"
  });

  assert.equal(config.requestTimeoutMs, 3210);
  assert.equal(config.authMode, "api_key");
});

test("loadConfig reads credentials from TWILIO_LOGS_MCP_ENV_FILE and allows direct overrides", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "twilio-logs-mcp-"));
  const envFilePath = path.join(tempDir, ".twilio-logs-mcp-env");

  try {
    writeFileSync(envFilePath, [
      "TWILIO_ACCOUNT_SID=AC11111111111111111111111111111111",
      "TWILIO_API_KEY=SK11111111111111111111111111111111",
      "TWILIO_API_SECRET=file-secret",
      "TWILIO_MAX_RETRIES=4",
      "TWILIO_LOG_LEVEL=error"
    ].join("\n"));

    const config = loadConfig({
      TWILIO_LOGS_MCP_ENV_FILE: envFilePath,
      TWILIO_API_SECRET: "env-secret"
    });

    assert.equal(config.authMode, "api_key");
    assert.equal(config.authPassword, "env-secret");
    assert.equal(config.maxRetries, 4);
    assert.equal(config.logLevel, "error");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
