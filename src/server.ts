import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerConfig } from "./types.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./constants.js";
import { registerMessageTools } from "./tools/message-tools.js";
import { registerVerifyTools } from "./tools/verify-tools.js";
import { TwilioReadClient, READ_ONLY_TWILIO_OPERATIONS } from "./twilio/client.js";

export function createServer(config: ServerConfig): McpServer {
  const server = new McpServer({
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION
  });

  const twilioClient = new TwilioReadClient(config);
  void READ_ONLY_TWILIO_OPERATIONS;

  registerMessageTools(server, twilioClient, config);
  registerVerifyTools(server, twilioClient, config);

  return server;
}
