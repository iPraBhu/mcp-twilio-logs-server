import test from "node:test";
import assert from "node:assert/strict";
import { TwilioReadClient } from "../src/twilio/client.ts";

const baseConfig = {
  accountSid: "AC11111111111111111111111111111111",
  effectiveAccountSid: "AC11111111111111111111111111111111",
  authMode: "api_key" as const,
  authPassword: "secret",
  authUsername: "SK11111111111111111111111111111111",
  defaultLookbackDays: 7,
  maxLimit: 200,
  maxPageSize: 100,
  requestTimeoutMs: 15000
};

test("TwilioReadClient rejects non-Twilio pagination URLs", () => {
  const client = new TwilioReadClient(baseConfig);
  assert.throws(
    () => (client as unknown as { validateTwilioPageUrl: (url: string, options: { pathPrefixes: string[] }) => void }).validateTwilioPageUrl(
      "https://evil.example.com/v2/Attempts?PageToken=abc",
      { pathPrefixes: ["/v2/Attempts"] },
    ),
    /Twilio API domain/i,
  );
});

test("TwilioReadClient rejects unexpected pagination paths", () => {
  const client = new TwilioReadClient(baseConfig);
  assert.throws(
    () => (client as unknown as { validateTwilioPageUrl: (url: string, options: { pathPrefixes: string[] }) => void }).validateTwilioPageUrl(
      "https://verify.twilio.com/v2/Services/VA123",
      { pathPrefixes: ["/v2/Attempts"] },
    ),
    /outside the allowed read-only Twilio resources/i,
  );
});
