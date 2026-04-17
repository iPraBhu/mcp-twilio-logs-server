import test from "node:test";
import assert from "node:assert/strict";
import { searchMessages } from "../src/twilio/messaging.ts";
import type { MessagePageParams } from "../src/twilio/client.ts";
import { TwilioReadClient } from "../src/twilio/client.ts";

function createMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sid: "SM11111111111111111111111111111111",
    accountSid: "AC11111111111111111111111111111111",
    direction: "inbound",
    status: "received",
    from: "+14155550100",
    to: "+14155550200",
    body: "hello",
    messagingServiceSid: "MG11111111111111111111111111111111",
    errorCode: null,
    errorMessage: null,
    numSegments: "1",
    numMedia: "0",
    price: "0.00",
    priceUnit: "usd",
    apiVersion: "2010-04-01",
    dateCreated: new Date("2026-04-01T00:00:00Z"),
    dateUpdated: new Date("2026-04-01T00:00:00Z"),
    dateSent: new Date("2026-04-01T00:00:00Z"),
    uri: "/2010-04-01/Accounts/AC.../Messages/SM....json",
    toJSON() {
      return this;
    },
    ...overrides
  };
}

test("searchMessages filters by phone number locally", async () => {
  const fakeClient = {
    async pageMessages() {
      return {
        instances: [
          createMessage({ sid: "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", from: "+14155550100", to: "+14155550200" }),
          createMessage({ sid: "SMbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", from: "+14155550300", to: "+14155550400" })
        ],
        nextPageUrl: undefined
      };
    }
  } as unknown as TwilioReadClient;

  const result = await searchMessages({
    client: fakeClient,
    config: {
      accountSid: "AC11111111111111111111111111111111",
      effectiveAccountSid: "AC11111111111111111111111111111111",
      authMode: "api_key",
      authPassword: "secret",
      authUsername: "SK11111111111111111111111111111111",
      defaultLookbackDays: 7,
      maxLimit: 200,
      maxPageSize: 100,
      maxRetries: 1,
      logLevel: "warn" as const,
      requestTimeoutMs: 15000
    },
    kind: "search_message_logs_by_phone",
    limit: 50,
    pageSize: 50,
    phoneNumber: "+14155550100",
    query: {},
    timeRange: {
      start: new Date("2026-04-01T00:00:00Z"),
      end: new Date("2026-04-02T00:00:00Z")
    }
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0]?.sid, "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test("searchMessages searches from and to in parallel for phone-only lookups", async () => {
  const calls: MessagePageParams[] = [];
  const fakeClient = {
    async pageMessages(params: MessagePageParams) {
      calls.push(params);

      if (params.from === "+14155550100") {
        return {
          instances: [
            createMessage({
              sid: "SMfrom111111111111111111111111111111",
              direction: "inbound",
              from: "+14155550100",
              to: "+14155550200",
              dateSent: new Date("2026-04-02T00:00:00Z")
            })
          ],
          nextPageUrl: undefined
        };
      }

      return {
        instances: [
          createMessage({
            sid: "SMto11111111111111111111111111111111",
            direction: "outbound-api",
            from: "+14155550200",
            to: "+14155550100",
            dateSent: new Date("2026-04-03T00:00:00Z")
          })
        ],
        nextPageUrl: undefined
      };
    }
  } as unknown as TwilioReadClient;

  const result = await searchMessages({
    client: fakeClient,
    config: {
      accountSid: "AC11111111111111111111111111111111",
      effectiveAccountSid: "AC11111111111111111111111111111111",
      authMode: "api_key",
      authPassword: "secret",
      authUsername: "SK11111111111111111111111111111111",
      defaultLookbackDays: 7,
      maxLimit: 200,
      maxPageSize: 100,
      maxRetries: 1,
      logLevel: "warn" as const,
      requestTimeoutMs: 15000
    },
    kind: "search_message_logs_by_phone",
    limit: 10,
    pageSize: 10,
    phoneNumber: "+14155550100",
    query: {},
    timeRange: {
      start: new Date("2026-04-01T00:00:00Z"),
      end: new Date("2026-04-04T00:00:00Z")
    }
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.from, "+14155550100");
  assert.equal(calls[1]?.to, "+14155550100");
  assert.deepEqual(
    result.results.map((record) => record.sid),
    ["SMto11111111111111111111111111111111", "SMfrom111111111111111111111111111111"],
  );
});
