import type { LogLevel } from "../types.js";

const logPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

let minimumLogLevel: LogLevel = "warn";

export function configureLogging(level: LogLevel): void {
  minimumLogLevel = level;
}

export function log(level: LogLevel, event: string, details: Record<string, unknown> = {}): void {
  if (logPriority[level] < logPriority[minimumLogLevel]) {
    return;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details
  };

  process.stderr.write(`${JSON.stringify(payload)}\n`);
}
