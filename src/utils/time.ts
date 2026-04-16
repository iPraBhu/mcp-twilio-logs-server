import { invalidParams } from "./errors.js";
import type { ServerConfig, TimeRange } from "../types.js";

export interface RangeInput {
  startTime?: Date;
  endTime?: Date;
}

export function resolveTimeRange(
  input: RangeInput,
  config: ServerConfig,
  options: {
    maxLookbackDays?: number;
  } = {},
): { end: Date; start: Date; timeRange: TimeRange } {
  const now = new Date();
  const end = input.endTime ?? now;
  const start =
    input.startTime ?? new Date(end.getTime() - config.defaultLookbackDays * 24 * 60 * 60 * 1000);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw invalidParams("Invalid time range: startTime and endTime must be valid ISO 8601 timestamps.");
  }

  if (start > end) {
    throw invalidParams("Invalid time range: startTime must be before or equal to endTime.");
  }

  if (options.maxLookbackDays !== undefined) {
    const oldestAllowed = new Date(now.getTime() - options.maxLookbackDays * 24 * 60 * 60 * 1000);
    if (start < oldestAllowed) {
      throw invalidParams(
        `Requested time range exceeds Twilio support for this API. The earliest supported start time is ${oldestAllowed.toISOString()}.`,
      );
    }
  }

  return {
    start,
    end,
    timeRange: {
      start: start.toISOString(),
      end: end.toISOString()
    }
  };
}

export function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}
