export type LogLevel = "debug" | "error" | "info" | "warn";

export function log(level: LogLevel, event: string, details: Record<string, unknown> = {}): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details
  };

  process.stderr.write(`${JSON.stringify(payload)}\n`);
}
