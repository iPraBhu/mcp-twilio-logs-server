#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./constants.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { log } from "./utils/logging.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("-v") || args.includes("--version")) {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    return;
  }

  const config = loadConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();

  log("info", "startup", {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    transport: "stdio",
    authMode: config.authMode,
    accountSid: config.accountSid,
    subaccountSid: config.subaccountSid,
    effectiveAccountSid: config.effectiveAccountSid,
    defaultLookbackDays: config.defaultLookbackDays,
    maxLimit: config.maxLimit,
    maxPageSize: config.maxPageSize,
    requestTimeoutMs: config.requestTimeoutMs
  });

  await server.connect(transport);
}

main().catch((error) => {
  log("error", "startup_failure", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
