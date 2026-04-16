import test from "node:test";
import assert from "node:assert/strict";
import { decodeCursor, encodeCursor } from "../src/utils/cursor.ts";

test("cursor round-trips when signature is valid", () => {
  const secret = "super-secret";
  const encoded = encodeCursor(
    {
      kind: "messages",
      scopeAccountSid: "AC11111111111111111111111111111111",
      state: { offset: 10 }
    },
    secret,
  );

  const decoded = decodeCursor<{ offset: number }>(
    encoded,
    "messages",
    "AC11111111111111111111111111111111",
    secret,
  );

  assert.deepEqual(decoded, { offset: 10 });
});

test("cursor tampering is rejected", () => {
  const secret = "super-secret";
  const encoded = encodeCursor(
    {
      kind: "messages",
      scopeAccountSid: "AC11111111111111111111111111111111",
      state: { offset: 10 }
    },
    secret,
  );

  const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
    payload: { state: { offset: number } };
    signature: string;
  };
  parsed.payload.state.offset = 11;
  const tampered = Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url");

  assert.throws(
    () =>
      decodeCursor(
        tampered,
        "messages",
        "AC11111111111111111111111111111111",
        secret,
      ),
    /signature check failed/i,
  );
});
