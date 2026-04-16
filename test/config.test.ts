import test from "node:test";
import assert from "node:assert/strict";
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
