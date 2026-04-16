import { createHmac, timingSafeEqual } from "node:crypto";
import type { CursorEnvelope } from "../types.js";
import { invalidParams } from "./errors.js";

interface SignedCursorPayload<TState> {
  payload: CursorEnvelope<TState>;
  signature: string;
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encodeCursor<TState>(payload: CursorEnvelope<TState>, secret: string): string {
  const serializedPayload = JSON.stringify(payload);
  const envelope: SignedCursorPayload<TState> = {
    payload,
    signature: signPayload(serializedPayload, secret)
  };

  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

export function decodeCursor<TState>(
  cursor: string,
  expectedKind: string,
  scopeAccountSid: string,
  secret: string,
): TState {
  let parsed: SignedCursorPayload<TState>;

  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as SignedCursorPayload<TState>;
  } catch {
    throw invalidParams("Invalid cursor: unable to decode cursor payload.");
  }

  if (!parsed || typeof parsed !== "object" || !("payload" in parsed) || !("signature" in parsed)) {
    throw invalidParams("Invalid cursor: malformed cursor envelope.");
  }

  const serializedPayload = JSON.stringify(parsed.payload);
  const expectedSignature = signPayload(serializedPayload, secret);
  const actualSignature = parsed.signature;

  if (
    typeof actualSignature !== "string" ||
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(Buffer.from(actualSignature), Buffer.from(expectedSignature))
  ) {
    throw invalidParams("Invalid cursor: signature check failed.");
  }

  if (parsed.payload.kind !== expectedKind) {
    throw invalidParams(`Invalid cursor: expected cursor kind "${expectedKind}".`);
  }

  if (parsed.payload.scopeAccountSid !== scopeAccountSid) {
    throw invalidParams("Invalid cursor: cursor scope does not match the configured account scope.");
  }

  return parsed.payload.state;
}
